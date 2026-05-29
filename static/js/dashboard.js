const DashboardUI = {
    habitChartInstance: null,
    taskChartInstance: null,
    clockInterval: null,

    async loadData() {
        this.setGreeting();
        this.initClock();

        try {
            const [
                pendingTasks,
                inProgressTasks,
                onHoldTasks,
                projects,
                habits,
                overview,
                habitsMonthly,
                taskVelocity,
                todayPayload
            ] = await Promise.all([
                API.get('/api/tasks/?status=pending'),
                API.get('/api/tasks/?status=in_progress'),
                API.get('/api/tasks/?status=on_hold'),
                API.get('/api/projects/'),
                API.get('/api/habits/'),
                API.get('/api/analytics/overview'),
                API.get('/api/analytics/habits_monthly'),
                API.get('/api/analytics/velocity'),
                API.get('/api/analytics/today')
            ]);

            const tasks = [...pendingTasks, ...inProgressTasks, ...onHoldTasks];
            this.renderOverview(overview, tasks, todayPayload);
            this.renderToday(todayPayload);
            this.renderTasks(tasks);
            this.renderProjects(projects);
            this.renderHabits(habits);
            this.renderNextEvent(todayPayload.next_event);
            this.initHabitChart(habitsMonthly);
            this.initTaskChart(taskVelocity);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load dashboard data.');
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
        const grid = document.getElementById('dashboard-summary-grid');
        if (!grid) return;
        grid.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Active Tasks</span>
                <div class="stat-value">${tasks.length}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Active Projects</span>
                <div class="stat-value">${overview?.active_projects ?? 0}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Overdue</span>
                <div class="stat-value">${todayPayload?.overdue_tasks ?? 0}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Consistency</span>
                <div class="stat-value">${overview?.consistency ?? 0}%</div>
            </div>
        `;
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

    openQuickTaskModal() {
        document.getElementById('dashboard-task-form').reset();
        document.getElementById('dashboard-task-modal').style.display = 'flex';
    },

    closeQuickTaskModal() {
        document.getElementById('dashboard-task-modal').style.display = 'none';
    },

    async submitQuickTask(event) {
        event.preventDefault();
        try {
            await API.post('/api/tasks/', {
                title: document.getElementById('dashboard-task-title').value,
                priority: parseInt(document.getElementById('dashboard-task-priority').value, 10),
                due_date: document.getElementById('dashboard-task-due').value || null
            });
            this.closeQuickTaskModal();
            await this.loadData();
            CoreUI.showError('Task created.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create task.');
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
        const data = habitsMonthly.map((habit) => habit.completion_rate);
        this.habitChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Completion Rate (%)',
                    data,
                    backgroundColor: 'rgba(237, 237, 237, 0.8)',
                    borderColor: '#ededed',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#1f1f22' }, ticks: { callback: (value) => `${value}%` } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    initTaskChart(taskVelocity) {
        const ctx = document.getElementById('taskChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.taskChartInstance);
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        this.taskChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: taskVelocity?.labels || [],
                datasets: [{
                    label: 'Tasks Completed',
                    data: taskVelocity?.values || [],
                    borderColor: '#ededed',
                    borderWidth: 2,
                    backgroundColor: 'rgba(237, 237, 237, 0.1)',
                    pointBackgroundColor: '#ededed',
                    pointBorderColor: '#000',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    tension: 0.3,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, precision: 0, grid: { color: '#1f1f22' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    DashboardUI.loadData();
});
