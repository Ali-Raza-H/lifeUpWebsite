const TaskUI = {
    tasks: [],
    projects: [],
    goals: [],
    filters: {
        query: '',
        sort: 'default',
        project: 'all',
        goal: 'all',
        due: 'all',
        status: 'all'
    },

    init() {
        const bind = (id, key) => {
            document.getElementById(id)?.addEventListener('input', (event) => {
                this.filters[key] = event.target.value.trim().toLowerCase();
                this.renderTasks();
            });
            document.getElementById(id)?.addEventListener('change', (event) => {
                this.filters[key] = event.target.value;
                this.renderTasks();
            });
        };

        bind('task-search', 'query');
        bind('task-sort', 'sort');
        bind('task-project-filter', 'project');
        bind('task-goal-filter', 'goal');
        bind('task-due-filter', 'due');
        bind('task-status-filter', 'status');
        CoreUI.initStatusRowLimitControls(() => this.renderTasks());

        document.getElementById('task-reset-filters')?.addEventListener('click', () => {
            this.filters = { query: '', sort: 'default', project: 'all', goal: 'all', due: 'all', status: 'all' };
            document.getElementById('task-search').value = '';
            document.getElementById('task-sort').value = 'default';
            document.getElementById('task-project-filter').value = 'all';
            document.getElementById('task-goal-filter').value = 'all';
            document.getElementById('task-due-filter').value = 'all';
            document.getElementById('task-status-filter').value = 'all';
            this.renderTasks();
        });
    },

    async loadTasks() {
        try {
            const [tasks, projects, goals] = await Promise.all([
                API.get('/api/tasks/'),
                API.get('/api/projects/'),
                API.get('/api/goals/')
            ]);

            this.tasks = tasks;
            this.projects = projects;
            this.goals = goals;
            this.populateRelationOptions();
            this.renderTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load tasks.');
        }
    },

    populateRelationOptions() {
        const projectFilter = document.getElementById('task-project-filter');
        const goalFilter = document.getElementById('task-goal-filter');
        const projectSelect = document.getElementById('task-project');
        const goalSelect = document.getElementById('task-goal');

        const renderOptions = (items, target, emptyLabel) => {
            if (!target) return;
            target.innerHTML = emptyLabel;
            items.forEach((item) => {
                const label = item.name || item.title;
                target.innerHTML += `<option value="${item.id}">${CoreUI.escapeHtml(label)}</option>`;
            });
        };

        renderOptions(this.projects, projectFilter, '<option value="all">All projects</option><option value="none">Unlinked only</option>');
        renderOptions(this.goals, goalFilter, '<option value="all">All goals</option><option value="none">Unlinked only</option>');
        renderOptions(this.projects, projectSelect, '<option value="">No project</option>');
        renderOptions(this.goals, goalSelect, '<option value="">No goal</option>');
        if (projectFilter) projectFilter.value = this.filters.project;
        if (goalFilter) goalFilter.value = this.filters.goal;
    },

    getFilteredTasks() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        const filtered = this.tasks.filter((task) => {
            const haystack = `${task.title} ${task.description || ''}`.toLowerCase();
            if (this.filters.query && !haystack.includes(this.filters.query)) return false;
            if (this.filters.status !== 'all' && task.status !== this.filters.status) return false;

            if (this.filters.project === 'none' && task.project_id) return false;
            if (this.filters.project !== 'all' && this.filters.project !== 'none' && String(task.project_id || '') !== this.filters.project) return false;

            if (this.filters.goal === 'none' && task.goal_id) return false;
            if (this.filters.goal !== 'all' && this.filters.goal !== 'none' && String(task.goal_id || '') !== this.filters.goal) return false;

            if (this.filters.due !== 'all') {
                if (!task.due_date) return false;
                const due = new Date(task.due_date);
                due.setHours(0, 0, 0, 0);
                if (this.filters.due === 'overdue' && !(due < today && task.status !== 'completed')) return false;
                if (this.filters.due === 'today' && due.getTime() !== today.getTime()) return false;
                if (this.filters.due === 'upcoming' && !(due >= today && due <= nextWeek)) return false;
            }
            return true;
        });

        filtered.sort((left, right) => {
            if (this.filters.sort === 'priority') return left.priority - right.priority;
            if (this.filters.sort === 'due') {
                const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER;
                const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER;
                return leftDue - rightDue;
            }
            if (this.filters.sort === 'recent') {
                return new Date(right.created_at || 0) - new Date(left.created_at || 0);
            }

            const order = { pending: 0, in_progress: 1, on_hold: 2, completed: 3 };
            const statusDelta = (order[left.status] ?? 99) - (order[right.status] ?? 99);
            if (statusDelta !== 0) return statusDelta;
            const priorityDelta = left.priority - right.priority;
            if (priorityDelta !== 0) return priorityDelta;
            const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER;
            const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER;
            return leftDue - rightDue;
        });

        return filtered;
    },

    renderTasks() {
        const tasks = this.getFilteredTasks();
        this.renderSummary(tasks);
        const rowLimit = CoreUI.getStatusColumnRowLimit();

        const countEl = document.getElementById('task-results-count');
        if (countEl) countEl.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;

        const columns = {
            pending: document.getElementById('tasks-pending'),
            in_progress: document.getElementById('tasks-in-progress'),
            on_hold: document.getElementById('tasks-on-hold'),
            completed: document.getElementById('tasks-completed')
        };
        const counts = { pending: 0, in_progress: 0, on_hold: 0, completed: 0 };

        Object.values(columns).forEach((column) => {
            if (column) column.innerHTML = '';
        });

        tasks.forEach((task) => {
            counts[task.status] += 1;
            if (counts[task.status] <= rowLimit) {
                columns[task.status]?.appendChild(this.createTaskElement(task));
            }
        });

        Object.keys(columns).forEach((status) => {
            document.getElementById(`tasks-${status.replace('_', '-')}-count`).textContent = counts[status];
            if (counts[status] === 0) {
                CoreUI.setEmptyState(columns[status], 'No tasks');
            } else if (counts[status] > rowLimit) {
                columns[status]?.appendChild(CoreUI.createRowLimitNotice(counts[status] - rowLimit, 'tasks'));
            }
        });
    },

    renderSummary(tasks) {
        const grid = document.getElementById('task-summary-grid');
        if (!grid) return;
        const overdue = tasks.filter((task) => this.getDueState(task) === 'overdue').length;
        const dueToday = tasks.filter((task) => this.getDueState(task) === 'today').length;
        const linked = tasks.filter((task) => task.project_id || task.goal_id).length;
        const completed = tasks.filter((task) => task.status === 'completed').length;
        grid.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Overdue</span>
                <span class="stat-value">${overdue}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Due Today</span>
                <span class="stat-value">${dueToday}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Linked</span>
                <span class="stat-value">${linked}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Completed</span>
                <span class="stat-value">${completed}</span>
            </div>
        `;
    },

    createTaskElement(task) {
        const div = document.createElement('div');
        div.className = 'compact-item';
        div.style.flexDirection = 'column';
        div.style.gap = '10px';

        const project = this.projects.find((item) => item.id === task.project_id);
        const goal = this.goals.find((item) => item.id === task.goal_id);
        const dueState = this.getDueState(task);
        const dueLabel = this.getDueLabel(task, dueState);

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                <div style="display:flex; flex-direction:column; gap:6px; min-width:0;">
                    <div class="item-title" style="${task.status === 'completed' ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${CoreUI.escapeHtml(task.title)}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${CoreUI.getStatusBadge(task.status)}
                        ${project ? `<span class="badge"><i class="ph ph-kanban"></i>${CoreUI.escapeHtml(project.name)}</span>` : ''}
                        ${goal ? `<span class="badge"><i class="ph ph-target"></i>${CoreUI.escapeHtml(goal.title)}</span>` : ''}
                        ${task.linkedin_post_enabled ? '<span class="badge"><i class="ph ph-linkedin-logo"></i>LinkedIn</span>' : ''}
                    </div>
                </div>
                ${CoreUI.getPriorityLabel(task.priority)}
            </div>
            ${task.description ? `<div class="item-desc" style="white-space:pre-wrap;">${CoreUI.escapeHtml(task.description)}</div>` : ''}
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; width:100%;">
                <span class="item-desc" style="${dueState === 'overdue' ? 'color: var(--text-error);' : dueState === 'today' ? 'color: var(--text-warning);' : ''}">${CoreUI.escapeHtml(dueLabel)}</span>
                <span class="item-desc">${task.estimated_minutes ? `${task.estimated_minutes}m` : 'No estimate'}</span>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:4px; width:100%;">
                <button class="btn btn-icon" onclick="TaskUI.openCreateModal(${task.id})" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                ${task.status !== 'pending' ? `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'pending')" title="Move to pending"><i class="ph ph-arrow-counter-clockwise"></i></button>` : ''}
                ${task.status === 'pending' ? `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'in_progress')" title="Start"><i class="ph ph-play"></i></button>` : ''}
                ${task.status === 'in_progress' ? `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'on_hold')" title="Pause"><i class="ph ph-pause"></i></button>` : ''}
                ${task.status === 'on_hold' ? `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'in_progress')" title="Resume"><i class="ph ph-play"></i></button>` : ''}
                ${task.status !== 'completed' ? `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'completed')" title="Complete"><i class="ph ph-check"></i></button>` : ''}
                <button class="btn btn-icon btn-danger" onclick="TaskUI.deleteTask(${task.id})" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
        `;
        return div;
    },

    getDueState(task) {
        if (!task.due_date || task.status === 'completed') return 'none';
        const due = new Date(task.due_date);
        due.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (due < today) return 'overdue';
        if (due.getTime() === today.getTime()) return 'today';
        return 'upcoming';
    },

    getDueLabel(task, dueState) {
        if (task.status === 'completed') {
            return `Completed ${task.completed_at ? CoreUI.formatDate(task.completed_at) : ''}`.trim();
        }
        if (!task.due_date) return 'No due date';
        if (dueState === 'overdue') return `Overdue - ${CoreUI.formatDate(task.due_date)}`;
        if (dueState === 'today') return `Due today - ${CoreUI.formatDate(task.due_date)}`;
        return `Due ${CoreUI.formatDate(task.due_date)}`;
    },

    openCreateModal(taskId = null) {
        const modal = document.getElementById('task-modal');
        const title = document.getElementById('task-modal-title');
        const form = document.getElementById('task-form');
        const deleteBtn = document.getElementById('task-delete-btn');

        form.reset();
        document.getElementById('task-id').value = '';
        document.getElementById('task-status').value = 'pending';
        document.getElementById('task-linkedin-enabled').checked = false;
        deleteBtn.style.display = 'none';
        this.populateRelationOptions();

        if (taskId) {
            const task = this.tasks.find((item) => item.id === taskId);
            if (task) {
                title.textContent = 'Edit Task';
                document.getElementById('task-id').value = task.id;
                document.getElementById('task-title').value = task.title;
                document.getElementById('task-desc').value = task.description || '';
                document.getElementById('task-priority').value = task.priority;
                document.getElementById('task-status').value = task.status;
                document.getElementById('task-est').value = task.estimated_minutes || '';
                document.getElementById('task-project').value = task.project_id || '';
                document.getElementById('task-goal').value = task.goal_id || '';
                document.getElementById('task-linkedin-enabled').checked = Boolean(task.linkedin_post_enabled);
                if (task.due_date) {
                    document.getElementById('task-due-date').value = task.due_date.replace(' ', 'T').substring(0, 16);
                }
                deleteBtn.style.display = 'inline-flex';
            }
        } else {
            title.textContent = 'Create Task';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('task-modal').style.display = 'none';
        document.getElementById('task-form').reset();
    },

    openQuickAdd() {
        this.openCreateModal();
    },

    async submitTask(event) {
        event.preventDefault();
        const taskId = document.getElementById('task-id').value;
        const payload = {
            title: document.getElementById('task-title').value,
            description: document.getElementById('task-desc').value,
            priority: parseInt(document.getElementById('task-priority').value, 10),
            status: document.getElementById('task-status').value,
            estimated_minutes: parseInt(document.getElementById('task-est').value, 10) || null,
            due_date: document.getElementById('task-due-date').value || null,
            project_id: document.getElementById('task-project').value ? parseInt(document.getElementById('task-project').value, 10) : null,
            goal_id: document.getElementById('task-goal').value ? parseInt(document.getElementById('task-goal').value, 10) : null,
            linkedin_post_enabled: document.getElementById('task-linkedin-enabled').checked
        };

        try {
            if (taskId) {
                await API.put(`/api/tasks/${taskId}`, payload);
            } else {
                await API.post('/api/tasks/', payload);
            }
            this.closeModal();
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save task.');
        }
    },

    async updateStatus(id, newStatus) {
        try {
            await API.put(`/api/tasks/${id}`, { status: newStatus });
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update task.');
        }
    },

    async deleteCurrentTask() {
        const id = document.getElementById('task-id').value;
        if (id) {
            await this.deleteTask(parseInt(id, 10));
            this.closeModal();
        }
    },

    async deleteTask(id) {
        if (!(await CoreUI.confirm({
            title: 'Delete task?',
            message: 'This task will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/tasks/${id}`);
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete task.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    TaskUI.init();
    TaskUI.loadTasks();
});
