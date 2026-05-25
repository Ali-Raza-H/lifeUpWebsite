const HabitUI = {
    selectedMonth: null,
    habits: [],

    async loadHabits(month = this.selectedMonth) {
        try {
            const suffix = month ? `?month=${encodeURIComponent(month)}` : '';
            const payload = await API.get(`/api/habits/calendar${suffix}`);
            this.selectedMonth = payload.month;
            this.habits = payload.habits;
            this.renderToolbar(payload);
            this.renderMatrix(payload);
        } catch (error) {
            console.error('Failed to load habits', error);
            CoreUI.showError(error.message || 'Failed to load habits.');
        }
    },

    renderToolbar(payload) {
        const label = document.getElementById('habits-month-label');
        const prevButton = document.getElementById('habits-prev-month');
        const nextButton = document.getElementById('habits-next-month');

        if (label) label.textContent = payload.month_label;
        if (prevButton) prevButton.onclick = () => this.loadHabits(payload.previous_month);
        if (nextButton) {
            nextButton.disabled = !payload.next_month;
            nextButton.onclick = payload.next_month ? () => this.loadHabits(payload.next_month) : null;
        }
    },

    renderMatrix(payload) {
        const container = document.getElementById('habits-matrix');
        if (!container) return;

        if (payload.habits.length === 0) {
            container.innerHTML = '<div class="compact-item"><span class="item-desc">No active protocols.</span></div>';
            return;
        }

        const activeCells = payload.habits[0].calendar_cells.filter((cell) => !cell.is_padding);
        const dayHeader = activeCells
            .map((cell) => `<div class="habit-day-head">${cell.day}</div>`)
            .join('');
        const dayCountStyle = `style="--habit-day-count:${activeCells.length};"`;

        const rows = payload.habits.map((habit) => {
            const dayCells = habit.calendar_cells
                .filter((cell) => !cell.is_padding)
                .map((cell) => {
                    const statusClass = cell.status ? ` is-${cell.status}` : '';
                    const todayClass = cell.is_today ? ' is-today' : '';
                    const lockedClass = !cell.is_trackable ? ' is-locked' : '';
                    const icon = cell.status === 'completed' ? '<i class="ph-bold ph-check"></i>' : cell.status === 'skipped' ? 'x' : '';
                    if (!cell.is_trackable) {
                        return `<div class="habit-cell${statusClass}${todayClass}${lockedClass}">${icon}</div>`;
                    }
                    return `
                        <button
                            type="button"
                            class="habit-cell interactive${statusClass}${todayClass}"
                            onclick="HabitUI.toggleLog(${habit.id}, '${cell.date}', ${cell.status === 'completed'})"
                            title="${CoreUI.escapeHtml(habit.name)} • ${cell.date}"
                        >
                            ${icon}
                        </button>
                    `;
                })
                .join('');

            return `
                <div class="habit-meta">
                    <button class="btn btn-icon" onclick="HabitUI.openCreateModal(${habit.id})" title="Edit Habit"><i class="ph ph-pencil-simple"></i></button>
                    <div class="habit-meta-main">
                        <div class="item-title">${CoreUI.escapeHtml(habit.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(habit.category || 'general')} • streak ${habit.current_streak} • ${habit.month_completion_rate}%</div>
                    </div>
                </div>
                <div class="habit-days" ${dayCountStyle}>${dayCells}</div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="habit-matrix-shell">
                <div class="habit-matrix">
                    <div class="habit-head-meta">Habit</div>
                    <div class="habit-head-days" ${dayCountStyle}>${dayHeader}</div>
                    ${rows}
                </div>
            </div>
        `;
    },

    openCreateModal(habitId = null) {
        const modal = document.getElementById('habit-modal');
        const title = document.getElementById('habit-modal-title');
        const deleteBtn = document.getElementById('habit-delete-btn');
        const form = document.getElementById('habit-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('habit-id').value = '';
        document.getElementById('habit-target-streak').value = 0;

        if (habitId) {
            const habit = this.habits.find((item) => item.id === habitId);
            if (!habit) return;
            title.textContent = 'Edit Protocol';
            document.getElementById('habit-id').value = habit.id;
            document.getElementById('habit-name').value = habit.name;
            document.getElementById('habit-category').value = habit.category || '';
            document.getElementById('habit-frequency').value = habit.frequency || 'daily';
            document.getElementById('habit-target-streak').value = habit.target_streak || 0;
            document.getElementById('habit-description').value = habit.description || '';
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Define Protocol';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('habit-modal').style.display = 'none';
        document.getElementById('habit-form').reset();
    },

    async submitHabit(event) {
        event.preventDefault();
        const habitId = document.getElementById('habit-id').value;
        const payload = {
            name: document.getElementById('habit-name').value,
            category: document.getElementById('habit-category').value,
            frequency: document.getElementById('habit-frequency').value,
            target_streak: parseInt(document.getElementById('habit-target-streak').value || '0', 10),
            description: document.getElementById('habit-description').value
        };

        try {
            if (habitId) {
                await API.put(`/api/habits/${habitId}`, payload);
            } else {
                await API.post('/api/habits/', payload);
            }
            this.closeModal();
            await this.loadHabits(this.selectedMonth);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save habit.');
        }
    },

    async toggleLog(id, date, isCurrentlyChecked) {
        try {
            const newStatus = isCurrentlyChecked ? 'skipped' : 'completed';
            await API.post(`/api/habits/${id}/log`, { date, status: newStatus });
            await this.loadHabits(this.selectedMonth);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update habit log.');
        }
    },

    async deleteCurrentHabit() {
        const habitId = document.getElementById('habit-id').value;
        if (!habitId || !confirm('Confirm protocol termination?')) return;
        try {
            await API.delete(`/api/habits/${habitId}`);
            this.closeModal();
            await this.loadHabits(this.selectedMonth);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete habit.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    HabitUI.loadHabits();
});
