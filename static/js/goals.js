const GoalUI = {
    goals: [],

    async loadGoals() {
        try {
            const goals = await API.get('/api/goals/');
            this.goals = goals;
            const grid = document.getElementById('goals-grid');
            if (!grid) return;

            grid.innerHTML = '';
            if (goals.length === 0) {
                CoreUI.setEmptyState(grid, 'No active trajectories defined.');
                return;
            }

            const list = document.createElement('div');
            list.className = 'compact-list';
            goals.forEach((goal) => {
                const div = document.createElement('div');
                div.className = 'compact-item';
                div.style.flexDirection = 'column';
                div.style.gap = '10px';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; width:100%;">
                        <div>
                            <span class="badge" style="margin-bottom: 8px;">${CoreUI.escapeHtml(goal.type)}</span>
                            <div class="item-title" style="font-size: 16px;">${CoreUI.escapeHtml(goal.title)}</div>
                            <div class="item-desc" style="margin-top: 4px;">${CoreUI.escapeHtml(goal.status)} • target ${CoreUI.escapeHtml(CoreUI.formatDate(goal.target_date))}</div>
                            <div class="item-desc" style="margin-top: 4px;">Tasks: ${goal.completed_task_count}/${goal.task_count} complete</div>
                        </div>
                        <div style="display:flex; gap: 4px;">
                            <button class="btn btn-icon" onclick="GoalUI.openCreateModal(${goal.id})" title="Edit Goal"><i class="ph ph-pencil-simple"></i></button>
                            ${goal.status !== 'completed' ? `<button class="btn btn-icon" onclick="GoalUI.quickStatus(${goal.id}, 'completed')" title="Mark Completed"><i class="ph ph-check"></i></button>` : ''}
                        </div>
                    </div>
                    <div>
                        <div style="display:flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">
                            <span>Progress</span>
                            <span>${goal.progress}%</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${goal.progress}%;"></div>
                        </div>
                    </div>
                `;
                list.appendChild(div);
            });
            grid.appendChild(list);
        } catch (error) {
            console.error('Failed to load goals', error);
            CoreUI.showError(error.message || 'Failed to load goals.');
        }
    },

    openCreateModal(goalId = null) {
        const modal = document.getElementById('goal-modal');
        const title = document.getElementById('goal-modal-title');
        const deleteBtn = document.getElementById('goal-delete-btn');
        const form = document.getElementById('goal-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('goal-id').value = '';
        document.getElementById('goal-status').value = 'active';

        if (goalId) {
            const goal = this.goals.find((item) => item.id === goalId);
            if (!goal) return;
            title.textContent = 'Edit Goal';
            document.getElementById('goal-id').value = goal.id;
            document.getElementById('goal-title').value = goal.title;
            document.getElementById('goal-type').value = goal.type;
            document.getElementById('goal-date').value = goal.target_date || '';
            document.getElementById('goal-status').value = goal.status;
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Define Directive';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('goal-modal').style.display = 'none';
        document.getElementById('goal-form').reset();
    },

    async submitGoal(event) {
        event.preventDefault();
        const goalId = document.getElementById('goal-id').value;
        const payload = {
            title: document.getElementById('goal-title').value,
            type: document.getElementById('goal-type').value,
            target_date: document.getElementById('goal-date').value,
            status: document.getElementById('goal-status').value
        };

        try {
            if (goalId) {
                await API.put(`/api/goals/${goalId}`, payload);
            } else {
                await API.post('/api/goals/', payload);
            }
            this.closeModal();
            await this.loadGoals();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save goal.');
        }
    },

    async quickStatus(id, status) {
        try {
            await API.put(`/api/goals/${id}`, { status });
            await this.loadGoals();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update goal.');
        }
    },

    async deleteCurrentGoal() {
        const goalId = document.getElementById('goal-id').value;
        if (!goalId || !confirm('Confirm removal of trajectory?')) return;
        try {
            await API.delete(`/api/goals/${goalId}`);
            this.closeModal();
            await this.loadGoals();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete goal.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    GoalUI.loadGoals();
});
