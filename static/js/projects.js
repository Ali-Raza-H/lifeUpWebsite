const ProjectUI = {
    projects: [],
    goals: [],
    allHabits: [],
    currentView: 'kanban',
    filters: {
        query: '',
        status: 'all',
        goal: 'all',
        sort: 'deadline'
    },

    async loadData() {
        try {
            const isGuest = Boolean(window.LifeOSSession?.is_guest);
            const requests = isGuest
                ? [API.get('/api/projects/')]
                : [API.get('/api/projects/'), API.get('/api/goals/'), API.get('/api/habits/')];
            const [projects, goals = [], habits = []] = await Promise.all(requests);
            this.projects = projects;
            this.goals = goals;
            this.allHabits = habits;
            this.populateFilterOptions();
            this.renderView();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load project data.');
        }
    },

    init() {
        document.getElementById('view-toggle-btn')?.addEventListener('click', () => this.toggleView());
        document.getElementById('project-search')?.addEventListener('input', (event) => {
            this.filters.query = event.target.value.trim().toLowerCase();
            this.renderView();
        });
        document.getElementById('project-status-filter')?.addEventListener('change', (event) => {
            this.filters.status = event.target.value;
            this.renderView();
        });
        document.getElementById('project-goal-filter')?.addEventListener('change', (event) => {
            this.filters.goal = event.target.value;
            this.renderView();
        });
        document.getElementById('project-sort')?.addEventListener('change', (event) => {
            this.filters.sort = event.target.value;
            this.renderView();
        });
        CoreUI.initStatusRowLimitControls(() => this.renderView());
        document.getElementById('project-clear-filters')?.addEventListener('click', () => {
            this.filters = { query: '', status: 'all', goal: 'all', sort: 'deadline' };
            document.getElementById('project-search').value = '';
            document.getElementById('project-status-filter').value = 'all';
            document.getElementById('project-goal-filter').value = 'all';
            document.getElementById('project-sort').value = 'deadline';
            this.renderView();
        });
    },

    populateFilterOptions() {
        const goalFilter = document.getElementById('project-goal-filter');
        const goalSelect = document.getElementById('project-goal');
        if (goalFilter) {
            goalFilter.innerHTML = '<option value="all">All goals</option><option value="none">Unlinked only</option>';
            this.goals.forEach((goal) => {
                goalFilter.innerHTML += `<option value="${goal.id}">${CoreUI.escapeHtml(goal.title)}</option>`;
            });
            goalFilter.value = this.filters.goal;
        }
        if (goalSelect) {
            goalSelect.innerHTML = '<option value="">No linked goal</option>';
            this.goals.forEach((goal) => {
                goalSelect.innerHTML += `<option value="${goal.id}">${CoreUI.escapeHtml(goal.title)}</option>`;
            });
        }
    },

    toggleView() {
        this.currentView = this.currentView === 'kanban' ? 'timeline' : 'kanban';
        document.getElementById('projects-kanban').style.display = this.currentView === 'kanban' ? 'grid' : 'none';
        document.getElementById('projects-timeline').style.display = this.currentView === 'timeline' ? 'block' : 'none';
        const toggleButton = document.getElementById('view-toggle-btn');
        if (toggleButton) {
            toggleButton.innerHTML = this.currentView === 'kanban'
                ? '<i class="ph ph-chart-gantt"></i> Timeline View'
                : '<i class="ph ph-kanban"></i> Board View';
        }
        this.renderView();
    },

    getFilteredProjects() {
        const filtered = this.projects.filter((project) => {
            const haystack = `${project.name} ${project.description || ''} ${project.notes || ''}`.toLowerCase();
            if (this.filters.query && !haystack.includes(this.filters.query)) {
                return false;
            }
            if (this.filters.status !== 'all' && project.status !== this.filters.status) {
                return false;
            }
            if (this.filters.goal === 'none' && project.goal_id) {
                return false;
            }
            if (this.filters.goal !== 'all' && this.filters.goal !== 'none' && String(project.goal_id || '') !== this.filters.goal) {
                return false;
            }
            return true;
        });

        filtered.sort((left, right) => {
            switch (this.filters.sort) {
                case 'progress':
                    return right.progress - left.progress;
                case 'recent':
                    return new Date(right.created_at || 0) - new Date(left.created_at || 0);
                case 'name':
                    return left.name.localeCompare(right.name);
                case 'deadline':
                default: {
                    const leftTime = left.deadline ? new Date(left.deadline).getTime() : Number.MAX_SAFE_INTEGER;
                    const rightTime = right.deadline ? new Date(right.deadline).getTime() : Number.MAX_SAFE_INTEGER;
                    if (leftTime === rightTime) {
                        return left.name.localeCompare(right.name);
                    }
                    return leftTime - rightTime;
                }
            }
        });

        return filtered;
    },

    renderView() {
        const filteredProjects = this.getFilteredProjects();
        this.renderSummary(filteredProjects);
        const countEl = document.getElementById('projects-results-count');
        if (countEl) {
            countEl.textContent = `${filteredProjects.length} project${filteredProjects.length === 1 ? '' : 's'}`;
        }

        if (this.currentView === 'kanban') {
            this.renderKanban(filteredProjects);
        } else {
            this.renderTimeline(filteredProjects);
        }
    },

    renderSummary(projects) {
        const summaryGrid = document.getElementById('projects-summary-grid');
        if (!summaryGrid) return;

        const activeCount = projects.filter((project) => project.status === 'active').length;
        const completedCount = projects.filter((project) => project.status === 'completed').length;
        const overdueCount = projects.filter((project) => this.isOverdue(project)).length;
        const avgProgress = projects.length
            ? Math.round(projects.reduce((total, project) => total + (project.progress || 0), 0) / projects.length)
            : 0;

        summaryGrid.innerHTML = `
            <div class="compact-item projects-summary-stat">
                <span class="item-desc">Active Execution</span>
                <div class="projects-summary-value">${activeCount}</div>
                <span class="badge">Now</span>
            </div>
            <div class="compact-item projects-summary-stat">
                <span class="item-desc">Completed</span>
                <div class="projects-summary-value">${completedCount}</div>
                <span class="badge">Closed loop</span>
            </div>
            <div class="compact-item projects-summary-stat">
                <span class="item-desc">Overdue</span>
                <div class="projects-summary-value">${overdueCount}</div>
                <span class="badge">Needs attention</span>
            </div>
            <div class="compact-item projects-summary-stat">
                <span class="item-desc">Average Progress</span>
                <div class="projects-summary-value">${avgProgress}%</div>
                <span class="badge">Stages + tasks</span>
            </div>
        `;
    },

    renderKanban(projects) {
        const rowLimit = CoreUI.getStatusColumnRowLimit();
        const columns = {
            planning: document.getElementById('projects-planning'),
            active: document.getElementById('projects-active'),
            paused: document.getElementById('projects-paused'),
            completed: document.getElementById('projects-completed')
        };
        const counts = { planning: 0, active: 0, paused: 0, completed: 0 };

        Object.values(columns).forEach((column) => {
            if (column) {
                column.innerHTML = '';
            }
        });

        projects.forEach((project) => {
            const status = counts[project.status] !== undefined ? project.status : 'active';
            counts[status] += 1;
            if (counts[status] <= rowLimit) {
                columns[status]?.appendChild(this.createProjectCard(project));
            }
        });

        Object.entries(columns).forEach(([status, column]) => {
            document.getElementById(`${status}-count`).textContent = counts[status];
            if (column && counts[status] === 0) {
                CoreUI.setEmptyState(column, 'No projects');
            } else if (column && counts[status] > rowLimit) {
                column.appendChild(CoreUI.createRowLimitNotice(counts[status] - rowLimit, 'projects'));
            }
        });
    },

    createProjectCard(project) {
        const goal = this.goals.find((item) => item.id === project.goal_id);
        const deadlineMeta = this.getDeadlineMeta(project);
        const statusLabel = project.status.replace('_', ' ');
        const card = document.createElement('div');
        card.className = 'compact-item project-card';
        if (!window.LifeOSSession?.is_guest) {
            card.onclick = () => this.openCreateModal(project.id);
        }

        card.innerHTML = `
            <div class="project-card-header">
                <div class="item-main">
                    <div class="project-card-meta">
                        <span class="project-meta-chip"><span class="project-status-dot" style="background:${this.getStatusColor(project.status)};"></span>${CoreUI.escapeHtml(statusLabel)}</span>
                        ${goal ? `<span class="project-meta-chip"><i class="ph ph-target"></i>${CoreUI.escapeHtml(goal.title)}</span>` : ''}
                        ${project.linkedin_post_enabled ? '<span class="project-meta-chip"><i class="ph ph-linkedin-logo"></i>LinkedIn</span>' : ''}
                    </div>
                    <div class="item-title" style="${project.status === 'completed' ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${CoreUI.escapeHtml(project.name)}</div>
                </div>
                ${!window.LifeOSSession?.is_guest && project.status !== 'completed' ? `<button class="btn btn-icon" onclick="event.stopPropagation(); ProjectUI.quickStatus(${project.id}, 'completed')" title="Mark completed"><i class="ph ph-check"></i></button>` : ''}
            </div>
            <div class="project-card-body">
                <div class="item-desc">${CoreUI.escapeHtml(project.description || 'No description added yet.')}</div>
                ${project.notes ? `<div class="item-desc project-card-notes">${CoreUI.escapeHtml(project.notes)}</div>` : ''}
            </div>
            <div class="project-card-footer">
                <div class="project-card-meta">
                    <span class="project-meta-chip ${deadlineMeta.className}"><i class="ph ph-calendar"></i>${CoreUI.escapeHtml(deadlineMeta.label)}</span>
                    <span class="project-meta-chip"><i class="ph ph-list-checks"></i>${project.completed_task_count}/${project.task_count} tasks</span>
                    <span class="project-meta-chip"><i class="ph ph-flag"></i>${project.completed_milestone_count}/${project.milestone_count} stages</span>
                </div>
                <span class="item-desc">${project.progress}%</span>
            </div>
            <div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${project.progress}%; background:${project.progress === 100 ? 'var(--text-success)' : this.getStatusColor(project.status)};"></div>
                </div>
            </div>
        `;

        return card;
    },

    renderTimeline(projects) {
        const container = document.getElementById('timeline-container');
        if (!container) return;

        if (projects.length === 0) {
            container.innerHTML = '<div class="item-desc" style="padding: 20px;">No projects match the current filters.</div>';
            return;
        }

        const bounds = this.getTimelineBounds(projects);
        const totalDuration = Math.max(1, bounds.maxDate - bounds.minDate);
        const monthLabels = this.getMonthLabels(bounds.minDate, bounds.maxDate);

        let html = `
            <div class="timeline-shell">
                <div class="timeline-header">
                    <div class="item-desc">Project</div>
                    <div class="timeline-months">${monthLabels.map((label) => `<span>${CoreUI.escapeHtml(label)}</span>`).join('')}</div>
                </div>
        `;

        projects.forEach((project) => {
            const start = project.created_at ? new Date(project.created_at) : new Date();
            const end = project.deadline ? new Date(project.deadline) : new Date(start.getTime() + (14 * 24 * 60 * 60 * 1000));
            let leftPct = ((start - bounds.minDate) / totalDuration) * 100;
            let widthPct = ((end - start) / totalDuration) * 100;
            leftPct = Math.max(0, Math.min(100, leftPct));
            widthPct = Math.max(2, Math.min(100 - leftPct, widthPct || 2));
            const deadlineMeta = this.getDeadlineMeta(project);

            html += `
                <div class="timeline-row">
                    <div class="timeline-row-label">
                        <div class="item-title">${CoreUI.escapeHtml(project.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(deadlineMeta.label)} - ${project.progress}% progress</div>
                    </div>
                    <div class="timeline-scale">
                        <div class="timeline-bar"
                             style="left:${leftPct}%; width:${widthPct}%; background:${this.getStatusColor(project.status)};"
                             onclick="ProjectUI.openCreateModal(${project.id})">
                            ${CoreUI.escapeHtml(project.status)}
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;
    },

    getTimelineBounds(projects) {
        const now = new Date();
        let minDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        let maxDate = new Date(now.getFullYear(), now.getMonth() + 3, 1);

        projects.forEach((project) => {
            const created = project.created_at ? new Date(project.created_at) : null;
            const deadline = project.deadline ? new Date(project.deadline) : null;
            if (created && created < minDate) minDate = created;
            if (deadline && deadline > maxDate) maxDate = deadline;
        });

        minDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        maxDate = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
        return { minDate, maxDate };
    },

    getMonthLabels(minDate, maxDate) {
        const labels = [];
        const cursor = new Date(minDate);
        while (cursor <= maxDate) {
            labels.push(cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }));
            cursor.setMonth(cursor.getMonth() + 1);
        }
        return labels;
    },

    getStatusColor(status) {
        if (status === 'completed') return '#77d19a';
        if (status === 'paused') return '#8d95a5';
        if (status === 'planning') return '#7aa2ff';
        return '#f0d36d';
    },

    getDeadlineMeta(project) {
        if (!project.deadline) {
            return { label: 'No deadline', className: '' };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const deadline = new Date(project.deadline);
        deadline.setHours(0, 0, 0, 0);
        const daysRemaining = Math.round((deadline - today) / (24 * 60 * 60 * 1000));

        if (project.status !== 'completed' && daysRemaining < 0) {
            return { label: `Overdue by ${Math.abs(daysRemaining)}d`, className: 'project-deadline-danger' };
        }
        if (project.status !== 'completed' && daysRemaining <= 7) {
            return { label: `Due in ${daysRemaining}d`, className: 'project-deadline-warning' };
        }

        return { label: CoreUI.formatDate(project.deadline), className: '' };
    },

    isOverdue(project) {
        return Boolean(project.deadline) && project.status !== 'completed' && new Date(project.deadline) < new Date(new Date().setHours(0, 0, 0, 0));
    },

    async openCreateModal(projectId = null) {
        if (window.LifeOSSession?.is_guest) return;
        const modal = document.getElementById('project-modal');
        const title = document.getElementById('project-modal-title');
        const subtitle = document.getElementById('project-modal-subtitle');
        const deleteBtn = document.getElementById('project-delete-btn');
        const form = document.getElementById('project-form');
        const notebookBtn = document.getElementById('btn-open-notebook');
        const tasksList = document.getElementById('project-tasks-list');
        const milestonesList = document.getElementById('project-milestones-list');
        const habitsList = document.getElementById('project-habits-list');
        const habitSelect = document.getElementById('available-habits');

        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('project-id').value = '';
        document.getElementById('project-status').value = 'planning';
        document.getElementById('project-notes').value = '';
        document.getElementById('project-linkedin-enabled').checked = false;
        this.populateFilterOptions();

        document.getElementById('project-task-add').style.display = projectId ? 'flex' : 'none';
        document.getElementById('project-milestone-add').style.display = projectId ? 'flex' : 'none';
        document.getElementById('project-habit-add').style.display = projectId ? 'flex' : 'none';
        notebookBtn.style.display = projectId ? 'inline-flex' : 'none';

        if (projectId) {
            title.textContent = 'Project Workspace';
            subtitle.textContent = 'Edit structure, notes, and execution links.';
            deleteBtn.style.display = 'inline-flex';
            notebookBtn.href = `/projects/${projectId}/notebook`;

            try {
                const [projectDetail, tasks] = await Promise.all([
                    API.get(`/api/projects/${projectId}`),
                    API.get(`/api/tasks/?project_id=${projectId}`)
                ]);

                document.getElementById('project-id').value = projectDetail.id;
                document.getElementById('project-name').value = projectDetail.name;
                document.getElementById('project-desc').value = projectDetail.description || '';
                document.getElementById('project-deadline').value = projectDetail.deadline || '';
                document.getElementById('project-status').value = projectDetail.status;
                document.getElementById('project-goal').value = projectDetail.goal_id || '';
                document.getElementById('project-notes').value = projectDetail.notes || '';
                document.getElementById('project-linkedin-enabled').checked = Boolean(projectDetail.linkedin_post_enabled);

                this.renderProjectPulse(projectDetail, tasks);
                this.renderProjectTasks(tasksList, tasks);
                this.renderProjectMilestones(milestonesList, projectDetail, projectId);
                this.renderProjectHabits(habitsList, projectDetail, projectId);

                habitSelect.innerHTML = '';
                const linkedHabitIds = (projectDetail.habits || []).map((habit) => habit.id);
                this.allHabits.forEach((habit) => {
                    if (!linkedHabitIds.includes(habit.id)) {
                        habitSelect.innerHTML += `<option value="${habit.id}">${CoreUI.escapeHtml(habit.name)}</option>`;
                    }
                });
                if (habitSelect.options.length === 0) {
                    habitSelect.innerHTML = '<option value="">All habits linked</option>';
                    habitSelect.disabled = true;
                } else {
                    habitSelect.disabled = false;
                }
            } catch (error) {
                CoreUI.showError('Failed to load project details.');
                return;
            }
        } else {
            title.textContent = 'New Project';
            subtitle.textContent = 'Capture the project before tasks and habits get attached.';
            deleteBtn.style.display = 'none';
            tasksList.innerHTML = '<div class="item-desc">Save the project to manage tasks.</div>';
            milestonesList.innerHTML = '<div class="item-desc">Save the project to manage milestones.</div>';
            habitsList.innerHTML = '<div class="item-desc">Save the project to manage habits.</div>';
            document.getElementById('project-meta-status').textContent = 'Unsaved draft';
            document.getElementById('project-pulse-grid').innerHTML = '<div class="compact-item"><span class="item-desc">Save the project to track work.</span></div>';
        }

        modal.style.display = 'flex';
    },

    renderProjectPulse(projectDetail, tasks) {
        const pulse = document.getElementById('project-pulse-grid');
        const status = document.getElementById('project-meta-status');
        if (!pulse || !status) return;

        const completedTasks = tasks.filter((task) => task.status === 'completed').length;
        const inProgressTasks = tasks.filter((task) => task.status === 'in_progress').length;
        const linkedHabits = (projectDetail.habits || []).length;
        const milestones = projectDetail.milestones || [];
        const completedMilestones = milestones.filter((milestone) => milestone.status === 'completed').length;
        status.textContent = `${projectDetail.status} - ${projectDetail.deadline ? CoreUI.formatDate(projectDetail.deadline) : 'no deadline'}`;
        pulse.innerHTML = `
            <div class="compact-item project-pulse-stat">
                <span class="item-desc">Tasks</span>
                <span class="project-pulse-value">${completedTasks}/${tasks.length}</span>
            </div>
            <div class="compact-item project-pulse-stat">
                <span class="item-desc">In Progress</span>
                <span class="project-pulse-value">${inProgressTasks}</span>
            </div>
            <div class="compact-item project-pulse-stat">
                <span class="item-desc">Habits Linked</span>
                <span class="project-pulse-value">${linkedHabits}</span>
            </div>
            <div class="compact-item project-pulse-stat">
                <span class="item-desc">Stages</span>
                <span class="project-pulse-value">${completedMilestones}/${milestones.length}</span>
            </div>
        `;
    },

    renderProjectTasks(tasksList, tasks) {
        tasksList.innerHTML = '';
        if (tasks.length === 0) {
            tasksList.innerHTML = '<div class="item-desc">No tasks linked.</div>';
            return;
        }

        tasks.forEach((task) => {
            tasksList.innerHTML += `
                <div class="project-list-row">
                    <div>
                        <div class="item-title" style="font-size: 13px; ${task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${CoreUI.escapeHtml(task.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(task.status.replace('_', ' '))}</div>
                    </div>
                    <button type="button" class="btn btn-icon" onclick="ProjectUI.deleteTask(${task.id})"><i class="ph ph-trash"></i></button>
                </div>
            `;
        });
    },

    renderProjectHabits(habitsList, projectDetail, projectId) {
        habitsList.innerHTML = '';
        const habits = projectDetail.habits || [];
        if (habits.length === 0) {
            habitsList.innerHTML = '<div class="item-desc">No habits linked.</div>';
            return;
        }

        habits.forEach((habit) => {
            habitsList.innerHTML += `
                <div class="project-list-row">
                    <div>
                        <div class="item-title" style="font-size: 13px;">${CoreUI.escapeHtml(habit.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(habit.frequency || 'habit')}</div>
                    </div>
                    <button type="button" class="btn btn-icon" onclick="ProjectUI.unlinkHabit(${projectId}, ${habit.id})"><i class="ph ph-x"></i></button>
                </div>
            `;
        });
    },

    renderProjectMilestones(milestonesList, projectDetail, projectId) {
        milestonesList.innerHTML = '';
        const milestones = projectDetail.milestones || [];
        if (milestones.length === 0) {
            milestonesList.innerHTML = '<div class="item-desc">No stages added.</div>';
            return;
        }

        milestones.forEach((milestone) => {
            const startButton = milestone.status === 'pending'
                ? `<button type="button" class="btn btn-icon" onclick="ProjectUI.updateMilestone(${projectId}, ${milestone.id}, 'in_progress')" title="Start stage"><i class="ph ph-play"></i></button>`
                : '';
            const completeButton = milestone.status !== 'completed'
                ? `<button type="button" class="btn btn-icon" onclick="ProjectUI.updateMilestone(${projectId}, ${milestone.id}, 'completed')" title="Complete stage"><i class="ph ph-check"></i></button>`
                : '';
            milestonesList.innerHTML += `
                <div class="project-list-row">
                    <div>
                        <div class="item-title" style="font-size: 13px; ${milestone.status === 'completed' ? 'text-decoration: line-through; color: var(--text-muted);' : ''}">${CoreUI.escapeHtml(milestone.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(milestone.status.replace('_', ' '))}${milestone.due_date ? ` - ${CoreUI.escapeHtml(CoreUI.formatDate(milestone.due_date))}` : ''}</div>
                    </div>
                    <div style="display:flex; gap:4px;">
                        ${startButton}
                        ${completeButton}
                        <button type="button" class="btn btn-icon btn-danger" onclick="ProjectUI.deleteMilestone(${projectId}, ${milestone.id})"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
            `;
        });
    },

    closeModal() {
        document.getElementById('project-modal').style.display = 'none';
    },

    openQuickAdd() {
        this.openCreateModal();
    },

    async submitProject(event) {
        event.preventDefault();
        const projectId = document.getElementById('project-id').value;
        const payload = {
            name: document.getElementById('project-name').value,
            description: document.getElementById('project-desc').value,
            notes: document.getElementById('project-notes').value,
            deadline: document.getElementById('project-deadline').value || null,
            status: document.getElementById('project-status').value,
            goal_id: document.getElementById('project-goal').value ? parseInt(document.getElementById('project-goal').value, 10) : null,
            linkedin_post_enabled: document.getElementById('project-linkedin-enabled').checked
        };

        try {
            if (projectId) {
                await API.put(`/api/projects/${projectId}`, payload);
            } else {
                await API.post('/api/projects/', payload);
            }
            this.closeModal();
            await this.loadData();
            CoreUI.showError('Project saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save project.');
        }
    },

    async quickStatus(id, status) {
        try {
            await API.put(`/api/projects/${id}`, { status });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update project.');
        }
    },

    async deleteCurrentProject() {
        const projectId = document.getElementById('project-id').value;
        if (!projectId || !(await CoreUI.confirm({
            title: 'Delete project?',
            message: 'This project and its linked project data will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/projects/${projectId}`);
            this.closeModal();
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete project.');
        }
    },

    async quickAddTask() {
        const titleInput = document.getElementById('new-task-title');
        const title = titleInput.value.trim();
        const projectId = document.getElementById('project-id').value;

        if (!title || !projectId) return;

        try {
            await API.post('/api/tasks/', { title, project_id: parseInt(projectId, 10) });
            titleInput.value = '';
            await this.openCreateModal(parseInt(projectId, 10));
            await this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to add task.');
        }
    },

    async addMilestone() {
        const projectId = document.getElementById('project-id').value;
        const titleInput = document.getElementById('new-milestone-title');
        const dateInput = document.getElementById('new-milestone-date');
        const title = titleInput.value.trim();
        if (!projectId || !title) return;
        try {
            await API.post(`/api/projects/${projectId}/milestones`, {
                title,
                due_date: dateInput.value || null
            });
            titleInput.value = '';
            dateInput.value = '';
            await this.openCreateModal(parseInt(projectId, 10));
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to add stage.');
        }
    },

    async updateMilestone(projectId, milestoneId, status) {
        try {
            await API.put(`/api/projects/${projectId}/milestones/${milestoneId}`, { status });
            await this.openCreateModal(projectId);
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update stage.');
        }
    },

    async deleteMilestone(projectId, milestoneId) {
        if (!(await CoreUI.confirm({
            title: 'Delete stage?',
            message: 'This project stage will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/projects/${projectId}/milestones/${milestoneId}`);
            await this.openCreateModal(projectId);
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete stage.');
        }
    },

    async deleteTask(taskId) {
        const projectId = document.getElementById('project-id').value;
        if (!(await CoreUI.confirm({
            title: 'Delete task?',
            message: 'This task will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/tasks/${taskId}`);
            await this.openCreateModal(parseInt(projectId, 10));
            await this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to delete task.');
        }
    },

    async linkHabit() {
        const projectId = document.getElementById('project-id').value;
        const habitSelect = document.getElementById('available-habits');
        const habitId = habitSelect.value;

        if (!projectId || !habitId) return;

        try {
            await API.post(`/api/projects/${projectId}/habits`, { habit_id: parseInt(habitId, 10) });
            await this.openCreateModal(parseInt(projectId, 10));
            await this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to link habit.');
        }
    },

    async unlinkHabit(projectId, habitId) {
        if (!(await CoreUI.confirm({
            title: 'Unlink habit?',
            message: 'The habit will stay in Habits, but it will no longer be linked to this project.',
            confirmText: 'Unlink',
            danger: false
        }))) return;
        try {
            await API.delete(`/api/projects/${projectId}/habits/${habitId}`);
            await this.openCreateModal(projectId);
            await this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to unlink habit.');
        }
    }
};

window.ProjectUI = ProjectUI;

document.addEventListener('DOMContentLoaded', () => {
    ProjectUI.init();
    ProjectUI.loadData();
});
