const AnalyticsUI = {
    velocityChart: null,
    taskAnalyticsChart: null,
    moodProductivityChart: null,
    financeCategoryChart: null,
    financeMonthlyChart: null,
    selectedMonth: null,

    async loadData(month = this.selectedMonth) {
        try {
            const calendarSuffix = month ? `?month=${encodeURIComponent(month)}` : '';
            const payload = await API.get(`/api/analytics/page${calendarSuffix}`);
            const overview = payload.overview || {};
            const velocity = payload.velocity || {};
            const taskAnalytics = payload.task_analytics || { labels: [], completed: [], share_of_total: [], total_tasks: 0 };
            const calendarPayload = payload.calendar || { habits: [], weekday_labels: [] };
            const moodProductivity = payload.mood_productivity || { labels: [], mood: [], tasks: [] };
            const finance = payload.finance || { totals: {}, categories: [], months: [], net: 0 };

            this.selectedMonth = calendarPayload.month;
            const monthlyConsistency = this.calculateMonthlyConsistency(calendarPayload.habits);
            document.getElementById('completed-tasks').textContent = overview.active_output_tasks ?? overview.completed_tasks;
            document.getElementById('active-habits').textContent = overview.active_habits;
            document.getElementById('consistency-rate').textContent = `${monthlyConsistency}%`;

            this.renderToolbar(calendarPayload);
            this.renderExecutionBreakdown(taskAnalytics, overview);
            this.renderFinanceAnalytics(finance);
            this.initCharts(velocity, taskAnalytics, moodProductivity, finance);
            this.renderMonthlyReport(calendarPayload);
            this.renderCalendarReport(calendarPayload);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load analytics.');
        }
    },

    renderToolbar(payload) {
        const label = document.getElementById('analytics-month-label');
        const prevButton = document.getElementById('analytics-prev-month');
        const nextButton = document.getElementById('analytics-next-month');
        if (label) label.textContent = payload.month_label;
        if (prevButton) prevButton.onclick = () => this.loadData(payload.previous_month);
        if (nextButton) {
            nextButton.disabled = !payload.next_month;
            nextButton.onclick = payload.next_month ? () => this.loadData(payload.next_month) : null;
        }
    },

    calculateMonthlyConsistency(habits) {
        const totals = habits.reduce((acc, habit) => {
            acc.completed += Math.min(habit.month_completed_days, habit.month_target_days);
            acc.target += habit.month_target_days;
            return acc;
        }, { completed: 0, target: 0 });
        return totals.target ? Math.round((totals.completed / totals.target) * 100) : 0;
    },

    renderMonthlyReport(payload) {
        const list = document.getElementById('monthly-report-list');
        if (!list) return;
        list.innerHTML = '';
        if (payload.habits.length === 0) {
            CoreUI.setEmptyState(list, 'No active protocols to report.', 2);
            return;
        }

        payload.habits.forEach((habit) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '8px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap:12px;">
                    <span class="item-title">${CoreUI.escapeHtml(habit.name)}</span>
                    <span class="badge" style="background: transparent;">${habit.month_completed_days} / ${habit.month_target_days}</span>
                </div>
                <div style="width:100%;">
                    <div style="display:flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">
                        <span>Elapsed month compliance</span>
                        <span>${habit.month_completion_rate}%</span>
                    </div>
                    <div class="progress-track" style="height:3px;">
                        <div class="progress-fill" style="width:${habit.month_completion_rate}%;"></div>
                    </div>
                    <div style="display:flex; justify-content: space-between; font-size: 11px; color: var(--text-secondary); margin-top: 8px; margin-bottom: 4px;">
                        <span>Full month target</span>
                        <span>${habit.month_full_completion_rate}%</span>
                    </div>
                    <div class="progress-track" style="height:3px;">
                        <div class="progress-fill" style="width:${habit.month_full_completion_rate}%; opacity:0.65;"></div>
                    </div>
                </div>
            `;
            list.appendChild(div);
        });
    },

    renderCalendarReport(payload) {
        const grid = document.getElementById('analytics-habit-calendar');
        if (!grid) return;
        grid.innerHTML = '';
        if (payload.habits.length === 0) {
            grid.innerHTML = '<div class="compact-item" style="grid-column: span 12;"><span class="item-desc">No active protocols to report.</span></div>';
            return;
        }

        payload.habits.forEach((habit) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.gridColumn = 'span 6';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: var(--space-2); gap:12px;">
                    <div>
                        <div class="item-title" style="font-size:16px;">${CoreUI.escapeHtml(habit.name)}</div>
                        <div class="item-desc" style="margin-top:4px;">
                            elapsed ${habit.month_completion_rate}% &middot; full month ${habit.month_full_completion_rate}%
                        </div>
                    </div>
                    <span class="badge" style="background: transparent;">${habit.month_completed_days}/${habit.month_full_target_days}</span>
                </div>
                ${this.renderCalendar(payload.weekday_labels, habit.calendar_cells)}
            `;
            grid.appendChild(card);
        });
    },

    renderCalendar(weekdayLabels, cells) {
        const head = weekdayLabels.map((label) => `<div class="month-calendar-head">${CoreUI.escapeHtml(label)}</div>`).join('');
        const body = cells.map((cell) => {
            if (cell.is_padding) return '<div class="month-calendar-padding"></div>';
            const statusClass = cell.status ? ` is-${cell.status}` : '';
            const futureClass = cell.is_future ? ' is-future' : '';
            const todayClass = cell.is_today ? ' is-today' : '';
            const lockedClass = !cell.is_trackable ? ' is-locked' : '';
            const icon = cell.status === 'completed' ? '<i class="ph-bold ph-check"></i>' : cell.status === 'skipped' ? 'x' : '';
            return `<div class="month-day readonly${statusClass}${futureClass}${todayClass}${lockedClass}"><span>${cell.day}</span><span>${icon}</span></div>`;
        }).join('');
        return `<div class="month-calendar">${head}${body}</div>`;
    },

    renderExecutionBreakdown(taskAnalytics, overview) {
        const grid = document.getElementById('execution-breakdown-grid');
        const insight = document.getElementById('execution-breakdown-insight');
        if (!grid || !insight) return;

        const completedSeries = taskAnalytics.completed || [];
        const labels = taskAnalytics.labels || [];
        const totalRecent = completedSeries.reduce((sum, value) => sum + Number(value || 0), 0);
        const activeProjects = Number(overview.active_projects || 0);
        const activeGoals = Number(overview.active_goals || 0);
        const completionRate = Number(overview.task_completion_rate || 0);
        const totalTasks = Number(taskAnalytics.total_tasks || overview.total_tasks || 0);
        const peakValue = completedSeries.length ? Math.max(...completedSeries) : 0;
        const peakIndex = peakValue > 0 ? completedSeries.indexOf(peakValue) : -1;
        const peakLabel = peakIndex >= 0 ? labels[peakIndex] : '';
        const activeDays = completedSeries.filter((value) => Number(value || 0) > 0).length;
        const averageActiveDay = activeDays ? (totalRecent / activeDays).toFixed(1) : '0.0';

        grid.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">In Progress Share</span>
                <div class="stat-value">${completionRate}%</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Active Projects</span>
                <div class="stat-value">${activeProjects}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Active Goals</span>
                <div class="stat-value">${activeGoals}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Last 14 Days</span>
                <div class="stat-value">${totalRecent}</div>
            </div>
        `;

        if (!totalRecent) {
            insight.textContent = totalTasks
                ? 'No active task output landed in the current 14-day window. The chart below will highlight pending, in-progress, on-hold, and not-completed task movement.'
                : 'No active task history yet. As tasks are created, this panel will show execution pressure and momentum.';
            return;
        }

        insight.textContent = `Peak active output was ${peakValue} task${peakValue === 1 ? '' : 's'} on ${peakLabel}. You averaged ${averageActiveDay} active task entries on days where work moved.`;
    },

    renderFinanceAnalytics(finance) {
        const grid = document.getElementById('finance-analytics-grid');
        if (!grid) return;
        const totals = finance.totals || {};
        const topCategory = (finance.categories || [])[0];
        grid.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Net</span>
                <div class="stat-value">£${Number(finance.net || 0).toFixed(2)}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Spending</span>
                <div class="stat-value">£${Number(totals.spending || 0).toFixed(2)}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Income</span>
                <div class="stat-value">£${Number(totals.income || 0).toFixed(2)}</div>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Top Category</span>
                <div class="stat-value">${topCategory ? CoreUI.escapeHtml(topCategory.category) : '--'}</div>
            </div>
        `;
    },

    initCharts(velocity, taskAnalytics, moodProductivity, finance) {
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';

        const velocityCanvas = document.getElementById('velocityChart');
        if (velocityCanvas) {
            CoreUI.destroyChart(this.velocityChart);
            this.velocityChart = new Chart(velocityCanvas, {
                type: 'bar',
                data: {
                    labels: velocity?.labels || [],
                    datasets: [{
                        label: 'Tasks',
                        data: velocity?.values || [],
                        backgroundColor: 'rgba(0, 240, 255, 0.8)',
                        borderRadius: 4,
                        barThickness: 12
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

        const taskAnalyticsCanvas = document.getElementById('taskAnalyticsChart');
        if (taskAnalyticsCanvas) {
            CoreUI.destroyChart(this.taskAnalyticsChart);
            this.taskAnalyticsChart = new Chart(taskAnalyticsCanvas, {
                data: {
                    labels: taskAnalytics.labels || [],
                    datasets: [
                        {
                            type: 'bar',
                            label: 'Active task output',
                            data: taskAnalytics.completed || [],
                            backgroundColor: 'rgba(0, 240, 255, 0.45)',
                            borderColor: '#00f0ff',
                            borderWidth: 1,
                            borderRadius: 4,
                            yAxisID: 'yTasks'
                        },
                        {
                            type: 'line',
                            label: `Share of Total${taskAnalytics.total_tasks ? ` (${taskAnalytics.total_tasks})` : ''}`,
                            data: taskAnalytics.share_of_total || [],
                            borderColor: '#ff7a00',
                            borderWidth: 2,
                            backgroundColor: 'rgba(255, 122, 0, 0.12)',
                            pointBackgroundColor: '#ff7a00',
                            pointRadius: 2,
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
                        yTasks: {
                            beginAtZero: true,
                            precision: 0,
                            grid: { color: '#1f1f22' }
                        },
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

        const moodCanvas = document.getElementById('moodProductivityChart');
        if (moodCanvas) {
            CoreUI.destroyChart(this.moodProductivityChart);
            this.moodProductivityChart = new Chart(moodCanvas, {
                data: {
                    labels: moodProductivity.labels,
                    datasets: [
                        {
                            type: 'line',
                            label: 'Mood',
                            data: moodProductivity.mood,
                            borderColor: '#39ff14',
                            backgroundColor: 'rgba(57, 255, 20, 0.12)',
                            yAxisID: 'yMood',
                            tension: 0.3
                        },
                        {
                            type: 'bar',
                            label: 'Active Task Output',
                            data: moodProductivity.tasks,
                            backgroundColor: 'rgba(0, 240, 255, 0.6)',
                            yAxisID: 'yTasks'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true } },
                    scales: {
                        yMood: {
                            position: 'left',
                            min: 0,
                            max: 10,
                            grid: { color: '#1f1f22' }
                        },
                        yTasks: {
                            position: 'right',
                            beginAtZero: true,
                            grid: { display: false }
                        },
                        x: { grid: { display: false } }
                    }
                }
            });
        }

        const categoryCanvas = document.getElementById('financeCategoryChart');
        if (categoryCanvas) {
            CoreUI.destroyChart(this.financeCategoryChart);
            const categories = (finance.categories || []).slice(0, 6);
            this.financeCategoryChart = new Chart(categoryCanvas, {
                type: 'doughnut',
                data: {
                    labels: categories.map((item) => item.category),
                    datasets: [{
                        data: categories.map((item) => item.amount),
                        backgroundColor: [
                            'rgba(255, 77, 109, 0.82)',
                            'rgba(255, 184, 77, 0.78)',
                            'rgba(0, 240, 255, 0.72)',
                            'rgba(176, 107, 255, 0.72)',
                            'rgba(86, 211, 100, 0.68)',
                            'rgba(160, 168, 190, 0.56)'
                        ],
                        borderColor: '#1f1f22',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right' } },
                    cutout: '62%'
                }
            });
        }

        const monthlyCanvas = document.getElementById('financeMonthlyChart');
        if (monthlyCanvas) {
            CoreUI.destroyChart(this.financeMonthlyChart);
            this.financeMonthlyChart = new Chart(monthlyCanvas, {
                type: 'bar',
                data: {
                    labels: (finance.months || []).map((item) => item.label),
                    datasets: [{
                        label: 'Monthly spending',
                        data: (finance.months || []).map((item) => item.spending),
                        backgroundColor: 'rgba(0, 240, 255, 0.55)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        borderRadius: 4,
                        barThickness: 18
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#1f1f22' } },
                        x: { grid: { display: false } }
                    }
                }
            });
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AnalyticsUI.loadData();
});
