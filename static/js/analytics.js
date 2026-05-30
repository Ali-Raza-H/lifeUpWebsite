const AnalyticsUI = {
    velocityChart: null,
    traitChart: null,
    moodProductivityChart: null,
    selectedMonth: null,

    async loadData(month = this.selectedMonth) {
        try {
            const calendarSuffix = month ? `?month=${encodeURIComponent(month)}` : '';
            const [overview, velocity, traits, calendarPayload, moodProductivity] = await Promise.all([
                API.get('/api/analytics/overview'),
                API.get('/api/analytics/velocity'),
                API.get('/api/profile/traits'),
                API.get(`/api/analytics/habit_calendar${calendarSuffix}`),
                API.get('/api/analytics/mood_productivity')
            ]);

            this.selectedMonth = calendarPayload.month;
            const monthlyConsistency = this.calculateMonthlyConsistency(calendarPayload.habits);
            document.getElementById('completed-tasks').textContent = overview.completed_tasks;
            document.getElementById('active-habits').textContent = overview.active_habits;
            document.getElementById('consistency-rate').textContent = `${monthlyConsistency}%`;

            this.renderToolbar(calendarPayload);
            this.initCharts(velocity, traits, moodProductivity);
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
                        <span>${CoreUI.escapeHtml(payload.month_label)} Compliance</span>
                        <span>${habit.month_completion_rate}%</span>
                    </div>
                    <div class="progress-track" style="height:3px;">
                        <div class="progress-fill" style="width:${habit.month_completion_rate}%;"></div>
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
                        <div class="item-desc" style="margin-top:4px;">${CoreUI.escapeHtml(payload.month_label)} completion: ${habit.month_completion_rate}%</div>
                    </div>
                    <span class="badge" style="background: transparent;">${habit.month_completed_days}/${habit.month_target_days}</span>
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

    initCharts(velocity, traits, moodProductivity) {
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

        const traitCanvas = document.getElementById('traitChart');
        if (traitCanvas) {
            CoreUI.destroyChart(this.traitChart);
            this.traitChart = new Chart(traitCanvas, {
                type: 'radar',
                data: {
                    labels: traits.map((trait) => trait.name),
                    datasets: [{
                        label: 'Profile',
                        data: traits.map((trait) => trait.score),
                        backgroundColor: 'rgba(255, 0, 255, 0.2)',
                        borderColor: '#ff00ff',
                        pointBackgroundColor: '#ff00ff',
                        pointBorderColor: '#000',
                        borderWidth: 1.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        r: {
                            angleLines: { color: '#1f1f22' },
                            grid: { color: '#1f1f22' },
                            pointLabels: { color: '#a1a1aa', font: { size: 10 } },
                            min: 0,
                            max: 100,
                            ticks: { display: false }
                        }
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
                            label: 'Completed Tasks',
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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AnalyticsUI.loadData();
});
