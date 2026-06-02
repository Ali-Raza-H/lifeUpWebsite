const DashboardUI = {
    habitChartInstance: null,
    taskChartInstance: null,
    clockInterval: null,
    projects: [],
    goals: [],

    async loadData() {
        this.setGreeting();
        this.initClock();

        try {
            const payload = await API.get('/api/analytics/dashboard');
            const tasks = payload.tasks || [];
            const projects = payload.projects || [];
            const habits = payload.habits || [];
            const overview = payload.overview || {};
            const habitsMonthly = payload.habits_monthly || [];
            const taskAnalytics = payload.task_analytics || {};
            const todayPayload = payload.today || {};

            this.projects = projects;
            await this.loadQuickAddMeta();
            this.renderOverview(overview, tasks, todayPayload);
            this.renderToday(todayPayload);
            this.renderTasks(tasks);
            this.renderProjects(projects);
            this.renderHabits(habits);
            this.renderNextEvent(todayPayload.next_event);
            this.initHabitChart(habitsMonthly);
            this.initTaskChart(taskAnalytics);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load dashboard data.');
        }
    },

    async loadQuickAddMeta() {
        try {
            this.goals = await API.get('/api/goals/');
            this.populateQuickAddRelations();
        } catch (error) {
            this.goals = [];
        }
    },

    initClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        const updateClock = () => {
            const now = new Date();
            const timeEl = document.getElementById('current-time');
            const dateEl = document.getElementById('current-date');
            if (timeEl) {
                timeEl.textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }
            if (dateEl) {
                dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            }
        };
        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    },

    setGreeting() {
        const hour = new Date().getHours();
        let greeting = 'System Overview';
        if (hour >= 5 && hour < 12) greeting = 'Morning Protocol';
        else if (hour >= 12 && hour < 18) greeting = 'Afternoon Execution';
        else greeting = 'Evening Reflection';
        const el = document.getElementById('greeting');
        if (el) el.textContent = greeting;
    },

    renderOverview(overview, tasks, todayPayload) {
        const activeTaskCount = tasks.length;
        const activeProjectCount = overview?.active_projects ?? 0;
        const overdueCount = todayPayload?.overdue_tasks ?? 0;
        const consistency = overview?.consistency ?? 0;

        const grid = document.getElementById('dashboard-summary-grid');
        if (grid) {
            grid.innerHTML = `
                <div class="compact-item metric-card">
                    <span class="item-desc">Active Tasks</span>
                    <div class="stat-value">${activeTaskCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Active Projects</span>
                    <div class="stat-value">${activeProjectCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Overdue</span>
                    <div class="stat-value">${overdueCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Consistency</span>
                    <div class="stat-value">${consistency}%</div>
                </div>
            `;
        }

        const activeTasksEl = document.getElementById('active-tasks-count');
        if (activeTasksEl) activeTasksEl.textContent = String(activeTaskCount);

        const activeProjectsEl = document.getElementById('active-projects-count');
        if (activeProjectsEl) activeProjectsEl.textContent = String(activeProjectCount);

        const consistencyEl = document.getElementById('habit-consistency');
        if (consistencyEl) consistencyEl.textContent = `${consistency}%`;
    },

    renderToday(todayPayload) {
        const list = document.getElementById('today-focus-list');
        if (!list) return;

        const focusTasks = todayPayload?.focus_tasks || [];
        const items = [
            { label: 'Tasks due today', value: todayPayload?.due_today ?? 0 },
            { label: 'Overdue tasks', value: todayPayload?.overdue_tasks ?? 0 },
            { label: 'Habits still open', value: todayPayload?.open_habits ?? 0 }
        ];

        list.innerHTML = items.map((item) => `
            <div class="compact-item">
                <span class="item-title">${CoreUI.escapeHtml(item.label)}</span>
                <span class="badge">${item.value}</span>
            </div>
        `).join('');

        if (focusTasks.length > 0) {
            focusTasks.forEach((task) => {
                list.innerHTML += `
                    <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:6px;">
                        <div style="display:flex; justify-content:space-between; width:100%; gap:12px;">
                            <span class="item-title">${CoreUI.escapeHtml(task.title)}</span>
                            ${CoreUI.getPriorityLabel(task.priority)}
                        </div>
                        <span class="item-desc">${task.due_date ? `Due ${CoreUI.escapeHtml(CoreUI.formatDate(task.due_date))}` : 'No due date'}</span>
                    </div>
                `;
            });
        }
    },

    renderNextEvent(event) {
        const container = document.getElementById('dashboard-next-event');
        if (!container) return;

        if (!event || !event.id) {
            CoreUI.setEmptyState(container, 'No upcoming events.');
            return;
        }

        container.innerHTML = `
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(event.title)}</div>
                        <div class="item-desc" style="margin-top:4px;">${CoreUI.escapeHtml(CoreUI.formatDate(event.start_at))}</div>
                    </div>
                    ${event.category ? `<span class="badge">${CoreUI.escapeHtml(event.category)}</span>` : ''}
                </div>
                <div class="item-desc">${CoreUI.escapeHtml(event.location || 'No location')}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${event.project_name ? `<span class="badge"><i class="ph ph-kanban"></i>${CoreUI.escapeHtml(event.project_name)}</span>` : ''}
                    ${event.goal_title ? `<span class="badge"><i class="ph ph-target"></i>${CoreUI.escapeHtml(event.goal_title)}</span>` : ''}
                </div>
            </div>
        `;
    },

    renderTasks(tasks) {
        const taskList = document.getElementById('priority-tasks-list');
        if (!taskList) return;
        taskList.innerHTML = '';
        const topTasks = [...tasks].sort((a, b) => a.priority - b.priority).slice(0, 9);
        if (topTasks.length === 0) {
            CoreUI.setEmptyState(taskList, 'No active tasks.', 3);
            return;
        }

        topTasks.forEach((task) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '8px';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                    <span class="item-title" style="flex:1;">${CoreUI.escapeHtml(task.title)}</span>
                    ${CoreUI.getPriorityLabel(task.priority)}
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-top:4px;">
                    <span class="item-desc">${task.due_date ? `Due ${CoreUI.escapeHtml(CoreUI.formatDate(task.due_date))}` : 'No due date'}</span>
                    <select class="form-control form-control-compact" onchange="DashboardUI.changeTaskStatus(${task.id}, this.value)">
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Not started</option>
                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In progress</option>
                        <option value="on_hold" ${task.status === 'on_hold' ? 'selected' : ''}>On hold</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
            `;
            taskList.appendChild(div);
        });
    },

    async changeTaskStatus(taskId, newStatus) {
        try {
            await API.put(`/api/tasks/${taskId}`, { status: newStatus });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update task status.');
            await this.loadData();
        }
    },

    renderProjects(projects) {
        const activeProjects = projects.filter((project) => !['completed', 'archived'].includes(project.status)).slice(0, 6);
        const projectList = document.getElementById('current-projects-list');
        if (!projectList) return;
        projectList.innerHTML = '';
        if (activeProjects.length === 0) {
            CoreUI.setEmptyState(projectList, 'No active projects.');
            return;
        }

        activeProjects.forEach((project) => {
            const nextAction = project.next_action;
            const nextActionLabel = nextAction
                ? `${nextAction.kind === 'milestone' ? 'Stage' : 'Task'}: ${nextAction.title}`
                : 'No next action set';
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start';
            div.style.gap = '8px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span class="item-title">${CoreUI.escapeHtml(project.name)}</span>
                    <span class="item-desc" style="font-weight:bold; color:var(--text-primary);">${project.progress}%</span>
                </div>
                <div class="progress-track" style="width:100%;">
                    <div class="progress-fill" style="width:${project.progress}%;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; font-size:0.8rem; color:var(--text-secondary);">
                    <span>${project.completed_task_count}/${project.task_count} tasks</span>
                    <span>${project.health.replace('_', ' ')}</span>
                </div>
                <div class="item-desc" style="display:flex; align-items:center; gap:6px; width:100%;">
                    <i class="ph ph-lightning"></i>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(nextActionLabel)}</span>
                </div>
                ${project.resource_count ? `<span class="badge"><i class="ph ph-paperclip"></i>${project.resource_count} resources</span>` : ''}
            `;
            projectList.appendChild(div);
        });
    },

    renderHabits(habits) {
        const habitList = document.getElementById('daily-habits-list');
        if (!habitList) return;
        habitList.innerHTML = '';
        if (habits.length === 0) {
            CoreUI.setEmptyState(habitList, 'No active protocols.');
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        habits.slice(0, 8).forEach((habit) => {
            const isCompleted = habit.today_status === 'completed';
            const checkClass = isCompleted ? 'checked' : '';
            const icon = isCompleted ? '<i class="ph-bold ph-check"></i>' : '';
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px; flex:1;">
                    <button class="tick-box ${checkClass}" onclick="DashboardUI.toggleHabit(${habit.id}, '${todayStr}', ${isCompleted})" style="margin:0; width:24px; height:24px; flex-shrink:0;">
                        ${icon}
                    </button>
                    <span class="item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(habit.name)}</span>
                </div>
                <span class="badge">${habit.current_streak}</span>
            `;
            habitList.appendChild(div);
        });
    },

    async toggleHabit(id, date, isCurrentlyChecked) {
        try {
            const newStatus = isCurrentlyChecked ? 'skipped' : 'completed';
            await API.post(`/api/habits/${id}/log`, { date, status: newStatus });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to log habit.');
        }
    },

    populateQuickAddRelations() {
        const projectSelect = document.getElementById('dashboard-quick-project');
        const goalSelect = document.getElementById('dashboard-quick-goal');
        if (projectSelect) {
            const current = projectSelect.value;
            projectSelect.innerHTML = '<option value="">No project</option>';
            this.projects.forEach((project) => {
                projectSelect.innerHTML += `<option value="${project.id}">${CoreUI.escapeHtml(project.name)}</option>`;
            });
            projectSelect.value = current;
        }
        if (goalSelect) {
            const current = goalSelect.value;
            goalSelect.innerHTML = '<option value="">No goal</option>';
            this.goals.forEach((goal) => {
                goalSelect.innerHTML += `<option value="${goal.id}">${CoreUI.escapeHtml(goal.title)}</option>`;
            });
            goalSelect.value = current;
        }
    },

    openQuickAddModal() {
        const form = document.getElementById('dashboard-quick-add-form');
        if (form) form.reset();
        this.populateQuickAddRelations();
        this.setQuickAddDefaults();
        this.changeQuickAddType();
        document.getElementById('dashboard-quick-add-modal').style.display = 'flex';
    },

    closeQuickAddModal() {
        document.getElementById('dashboard-quick-add-modal').style.display = 'none';
    },

    setQuickAddDefaults() {
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        const end = new Date(now.getTime() + (60 * 60 * 1000));
        const toLocal = (date) => {
            const pad = (value) => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        };
        const today = toLocal(now).slice(0, 10);
        const due = document.getElementById('dashboard-quick-due');
        const start = document.getElementById('dashboard-quick-start');
        const eventEnd = document.getElementById('dashboard-quick-end');
        const targetDate = document.getElementById('dashboard-quick-date');
        if (due) due.value = toLocal(now);
        if (start) start.value = toLocal(now);
        if (eventEnd) eventEnd.value = toLocal(end);
        if (targetDate) targetDate.value = today;
    },

    changeQuickAddType() {
        const type = document.getElementById('dashboard-quick-add-type')?.value || 'task';
        document.querySelectorAll('.quick-add-field').forEach((field) => {
            const types = (field.dataset.types || '').split(/\s+/);
            field.style.display = types.includes(type) ? '' : 'none';
        });
        const submit = document.getElementById('dashboard-quick-submit');
        if (submit) {
            submit.textContent = `Create ${this.quickAddLabel(type)}`;
        }
        const title = document.getElementById('dashboard-quick-title');
        if (title) {
            title.placeholder = type === 'resource' ? 'Resource title' : `${this.quickAddLabel(type)} title`;
        }
    },

    quickAddLabel(type) {
        const labels = {
            task: 'Task',
            event: 'Event',
            project: 'Project',
            goal: 'Goal',
            note: 'Note',
            journal: 'Journal Entry',
            resource: 'Resource'
        };
        return labels[type] || 'Item';
    },

    intOrNull(id) {
        const value = document.getElementById(id)?.value;
        if (value == null || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
    },

    async submitQuickAdd(event) {
        event.preventDefault();
        const type = document.getElementById('dashboard-quick-add-type').value;
        const title = document.getElementById('dashboard-quick-title').value;
        const notes = document.getElementById('dashboard-quick-notes').value;

        try {
            if (type === 'task') {
                await API.post('/api/tasks/', {
                    title,
                    description: notes,
                    priority: parseInt(document.getElementById('dashboard-quick-priority').value, 10),
                    due_date: document.getElementById('dashboard-quick-due').value || null,
                    estimated_minutes: this.intOrNull('dashboard-quick-estimate'),
                    project_id: this.intOrNull('dashboard-quick-project'),
                    goal_id: this.intOrNull('dashboard-quick-goal')
                });
            } else if (type === 'event') {
                await API.post('/api/calendar/events', {
                    title,
                    description: notes,
                    category: document.getElementById('dashboard-quick-category').value || 'general',
                    location: document.getElementById('dashboard-quick-location').value,
                    start_at: document.getElementById('dashboard-quick-start').value,
                    end_at: document.getElementById('dashboard-quick-end').value,
                    project_id: this.intOrNull('dashboard-quick-project'),
                    goal_id: this.intOrNull('dashboard-quick-goal'),
                    sync_task: true
                });
            } else if (type === 'project') {
                await API.post('/api/projects/', {
                    name: title,
                    description: notes,
                    deadline: document.getElementById('dashboard-quick-date').value || null,
                    status: 'planning'
                });
            } else if (type === 'goal') {
                await API.post('/api/goals/', {
                    title,
                    notes,
                    type: document.getElementById('dashboard-quick-goal-type').value,
                    target_date: document.getElementById('dashboard-quick-date').value || null
                });
            } else if (type === 'note') {
                await API.post('/api/notes/', {
                    title,
                    content: notes || title,
                    tags: document.getElementById('dashboard-quick-tags').value
                });
            } else if (type === 'journal') {
                await API.post('/api/journal/', {
                    title,
                    content: notes || title,
                    tags: document.getElementById('dashboard-quick-tags').value,
                    mood_score: this.intOrNull('dashboard-quick-mood') || 5
                });
            } else if (type === 'resource') {
                await API.post('/api/life/attachments', {
                    entity_type: this.intOrNull('dashboard-quick-project') ? 'project' : 'general',
                    entity_id: this.intOrNull('dashboard-quick-project'),
                    title,
                    url: document.getElementById('dashboard-quick-url').value,
                    notes,
                    is_favorite: document.getElementById('dashboard-quick-favorite').checked
                });
            }

            this.closeQuickAddModal();
            await this.loadData();
            CoreUI.showError(`${this.quickAddLabel(type)} created.`, true);
        } catch (error) {
            CoreUI.showError(error.message || `Failed to create ${this.quickAddLabel(type).toLowerCase()}.`);
        }
    },

    initHabitChart(habitsMonthly) {
        const ctx = document.getElementById('habitChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.habitChartInstance);
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        const labels = habitsMonthly.map((habit) => habit.name.length > 15 ? `${habit.name.substring(0, 15)}...` : habit.name);
        const elapsedData = habitsMonthly.map((habit) => habit.completion_rate);
        const fullMonthData = habitsMonthly.map((habit) => habit.full_completion_rate ?? habit.completion_rate);
        this.habitChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Elapsed Month',
                        data: elapsedData,
                        backgroundColor: 'rgba(0, 240, 255, 0.8)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Full Month',
                        data: fullMonthData,
                        backgroundColor: 'rgba(255, 0, 255, 0.45)',
                        borderColor: '#ff00ff',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#1f1f22' }, ticks: { callback: (value) => `${value}%` } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    initTaskChart(taskAnalytics) {
        const ctx = document.getElementById('taskChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.taskChartInstance);
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        this.taskChartInstance = new Chart(ctx, {
            data: {
                labels: taskAnalytics?.labels || [],
                datasets: [
                    {
                        type: 'bar',
                        label: 'Completed',
                        data: taskAnalytics?.completed || [],
                        backgroundColor: 'rgba(0, 240, 255, 0.45)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        yAxisID: 'yTasks'
                    },
                    {
                        type: 'line',
                        label: `Share of Total${taskAnalytics?.total_tasks ? ` (${taskAnalytics.total_tasks})` : ''}`,
                        data: taskAnalytics?.share_of_total || [],
                        borderColor: '#ff00ff',
                        borderWidth: 2,
                        backgroundColor: 'rgba(255, 0, 255, 0.1)',
                        pointBackgroundColor: '#ff00ff',
                        pointBorderColor: '#000',
                        pointBorderWidth: 2,
                        pointRadius: 3,
                        tension: 0.3,
                        yAxisID: 'yShare'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                    yTasks: { beginAtZero: true, precision: 0, grid: { color: '#1f1f22' } },
                    yShare: {
                        beginAtZero: true,
                        max: 100,
                        position: 'right',
                        grid: { display: false },
                        ticks: { callback: (value) => `${value}%` }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    DashboardUI.loadData();
});
