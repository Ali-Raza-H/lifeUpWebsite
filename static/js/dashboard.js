const DashboardUI = {
    habitChartInstance: null,
    taskChartInstance: null,
    clockInterval: null,

    async loadData() {
        this.setGreeting();
        this.initClock();

        try {
            const [pendingTasks, inProgressTasks, onHoldTasks, projects, habits, overview, habitsMonthly, taskVelocity] = await Promise.all([
                API.get('/api/tasks/?status=pending'),
                API.get('/api/tasks/?status=in_progress'),
                API.get('/api/tasks/?status=on_hold'),
                API.get('/api/projects/'),
                API.get('/api/habits/'),
                API.get('/api/analytics/overview'),
                API.get('/api/analytics/habits_monthly'),
                API.get('/api/analytics/velocity')
            ]);

            const tasks = [...pendingTasks, ...inProgressTasks, ...onHoldTasks];
            this.renderOverview(overview, tasks);
            this.renderTasks(tasks);
            this.renderProjects(projects);
            this.renderHabits(habits);
            this.initHabitChart(habitsMonthly);
            this.initTaskChart(taskVelocity);
        } catch (error) {
            console.error('Dashboard data load failed', error);
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

    renderOverview(overview, tasks) {
        const taskCount = document.getElementById('active-tasks-count');
        const projectCount = document.getElementById('active-projects-count');
        const consistency = document.getElementById('habit-consistency');

        if (taskCount) taskCount.textContent = tasks.length;
        if (projectCount) projectCount.textContent = overview?.active_projects ?? '-';
        if (consistency) consistency.textContent = `${overview?.consistency ?? 0}%`;
    },

    renderTasks(tasks) {
        const taskList = document.getElementById('priority-tasks-list');
        if (!taskList) return;

        taskList.innerHTML = '';
        const topTasks = [...tasks].sort((a, b) => a.priority - b.priority).slice(0, 9); // Show up to 9 tasks

        if (topTasks.length === 0) {
            CoreUI.setEmptyState(taskList, 'No active tasks.', 3);
            return;
        }

        topTasks.forEach((task) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '8px';
            
            const isPending = task.status === 'pending';
            const isInProgress = task.status === 'in_progress';
            const isOnHold = task.status === 'on_hold';
            const isCompleted = task.status === 'completed';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; gap: 12px; align-items: flex-start;">
                    <span class="item-title" style="flex: 1;">${CoreUI.escapeHtml(task.title)}</span>
                    ${CoreUI.getPriorityLabel(task.priority)}
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; align-items: center; margin-top: 4px;">
                    <span class="item-desc"><i class="ph ph-clock"></i> ${task.due_date ? CoreUI.escapeHtml(CoreUI.formatDate(task.due_date)) : 'No due date'}</span>
                    <select class="form-control" style="width: auto; padding: 2px 8px; font-size: 0.8rem; height: auto;" onchange="DashboardUI.changeTaskStatus(${task.id}, this.value)">
                        <option value="pending" ${isPending ? 'selected' : ''}>Not Started</option>
                        <option value="in_progress" ${isInProgress ? 'selected' : ''}>In Progress</option>
                        <option value="on_hold" ${isOnHold ? 'selected' : ''}>On Hold</option>
                        <option value="completed" ${isCompleted ? 'selected' : ''}>Completed</option>
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
            await this.loadData(); // Reload to revert UI state on failure
        }
    },

    renderProjects(projects) {
        const activeProjects = projects.filter((project) => !['completed', 'archived'].includes(project.status));
        
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
            
            const progress = project.progress || 0;

            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; width: 100%;">
                    <span class="item-title">${CoreUI.escapeHtml(project.name)}</span>
                    <span class="item-desc" style="font-weight: bold; color: var(--text-primary);">${progress}%</span>
                </div>
                <div class="progress-bar" style="width: 100%; height: 6px; background: var(--bg-surface); border-radius: 3px; overflow: hidden;">
                    <div class="progress-fill" style="width: ${progress}%; height: 100%; background: var(--color-primary); transition: width 0.3s ease;"></div>
                </div>
                <div style="display: flex; justify-content: space-between; width: 100%; font-size: 0.8rem; color: var(--text-secondary);">
                    <span>${project.completed_task_count} / ${project.task_count} tasks</span>
                    <span>${project.deadline ? 'Due: ' + CoreUI.formatDate(project.deadline) : 'Ongoing'}</span>
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
        habits.forEach((habit) => {
            const isCompleted = habit.today_status === 'completed';
            const checkClass = isCompleted ? 'checked' : '';
            const icon = isCompleted ? '<i class="ph-bold ph-check"></i>' : '';
            
            const streakDisplay = habit.current_streak > 0 
                ? `<span style="color: var(--color-warning); font-size: 0.85rem; font-weight: bold; display: flex; align-items: center; gap: 4px;"><i class="ph-fill ph-fire"></i> ${habit.current_streak}</span>`
                : `<span style="color: var(--text-muted); font-size: 0.85rem; display: flex; align-items: center; gap: 4px;"><i class="ph ph-fire"></i> 0</span>`;

            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                    <button class="tick-box ${checkClass}" onclick="DashboardUI.toggleHabit(${habit.id}, '${todayStr}', ${isCompleted})" style="margin: 0; width: 24px; height: 24px; flex-shrink: 0;">
                        ${icon}
                    </button>
                    <span class="item-title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${CoreUI.escapeHtml(habit.name)}</span>
                </div>
                ${streakDisplay}
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

    initHabitChart(habitsMonthly) {
        const ctx = document.getElementById('habitChart');
        if (!ctx) return;

        CoreUI.destroyChart(this.habitChartInstance);

        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';

        const labels = habitsMonthly.map(h => h.name.length > 15 ? h.name.substring(0, 15) + '...' : h.name);
        const data = habitsMonthly.map(h => h.completion_rate);

        this.habitChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Completion Rate (%)',
                    data: data,
                    backgroundColor: 'rgba(237, 237, 237, 0.8)',
                    borderColor: '#ededed',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.parsed.y + '%';
                            }
                        }
                    }
                },
                scales: {
                    y: { 
                        beginAtZero: true, 
                        max: 100,
                        grid: { color: '#1f1f22' },
                        ticks: {
                            callback: function(value) { return value + '%' }
                        }
                    },
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
