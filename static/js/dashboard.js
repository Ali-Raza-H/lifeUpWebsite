const DashboardUI = {
    activityChart: null,

    async loadData() {
        this.setGreeting();

        try {
            const [pendingTasks, inProgressTasks, projects, habits, overview, activity] = await Promise.all([
                API.get('/api/tasks/?status=pending'),
                API.get('/api/tasks/?status=in_progress'),
                API.get('/api/projects/'),
                API.get('/api/habits/'),
                API.get('/api/analytics/overview'),
                API.get('/api/analytics/activity')
            ]);

            const tasks = [...pendingTasks, ...inProgressTasks];
            this.renderTasks(tasks);
            this.renderProjects(projects);
            this.renderHabits(habits);
            this.renderOverview(overview, tasks);
            this.initChart(activity);
        } catch (error) {
            console.error('Dashboard data load failed', error);
            CoreUI.showError(error.message || 'Failed to load dashboard data.');
        }
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
        const topTasks = [...tasks].sort((a, b) => a.priority - b.priority).slice(0, 3);

        if (topTasks.length === 0) {
            CoreUI.setEmptyState(taskList, 'No priority tasks pending.', 3);
            return;
        }

        topTasks.forEach((task) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '8px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; gap: 12px;">
                    <span class="item-title">${CoreUI.escapeHtml(task.title)}</span>
                    ${CoreUI.getPriorityLabel(task.priority)}
                </div>
                <span class="item-desc"><i class="ph ph-clock"></i> Due: ${CoreUI.escapeHtml(CoreUI.formatDate(task.due_date))}</span>
            `;
            taskList.appendChild(div);
        });
    },

    renderProjects(projects) {
        const activeProjects = projects.filter((project) => !['completed', 'archived'].includes(project.status));
        const projectCount = document.getElementById('active-projects-count');
        if (projectCount) projectCount.textContent = activeProjects.length;
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
        habits.slice(0, 5).forEach((habit) => {
            const isCompleted = habit.today_status === 'completed';
            const checkClass = isCompleted ? 'checked' : '';
            const icon = isCompleted ? '<i class="ph-bold ph-check"></i>' : '';

            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.alignItems = 'center';
            div.innerHTML = `
                <span class="item-title">${CoreUI.escapeHtml(habit.name)}</span>
                <button class="tick-box ${checkClass}" onclick="DashboardUI.toggleHabit(${habit.id}, '${todayStr}', ${isCompleted})" style="margin: 0; width: 24px; height: 24px;">
                    ${icon}
                </button>
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

    setGreeting() {
        const hour = new Date().getHours();
        let greeting = 'System Overview';
        if (hour >= 5 && hour < 12) greeting = 'Morning Protocol';
        else if (hour >= 12 && hour < 18) greeting = 'Afternoon Execution';
        else greeting = 'Evening Reflection';

        const el = document.getElementById('greeting');
        if (el) el.textContent = greeting;
    },

    initChart(activity) {
        const ctx = document.getElementById('activityChart');
        if (!ctx) return;

        CoreUI.destroyChart(this.activityChart);

        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';

        this.activityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: activity?.labels || [],
                datasets: [{
                    label: 'Activity',
                    data: activity?.values || [],
                    borderColor: '#ededed',
                    borderWidth: 1.5,
                    backgroundColor: 'transparent',
                    pointBackgroundColor: '#ededed',
                    pointBorderColor: '#000',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    tension: 0
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
