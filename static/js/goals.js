const GoalUI = {
    goals: [],
    filters: {
        query: '',
        status: 'all'
    },

    init() {
        document.getElementById('goal-search')?.addEventListener('input', (event) => {
            this.filters.query = event.target.value.trim().toLowerCase();
            this.renderGoals();
        });
        document.getElementById('goal-status-filter')?.addEventListener('change', (event) => {
            this.filters.status = event.target.value;
            this.renderGoals();
        });
        document.getElementById('goals-clear-filters')?.addEventListener('click', () => {
            this.filters = { query: '', status: 'all' };
            document.getElementById('goal-search').value = '';
            document.getElementById('goal-status-filter').value = 'all';
            this.renderGoals();
        });
    },

    async loadGoals() {
        try {
            const goals = await API.get('/api/goals/');
            this.goals = goals;
            this.renderGoals();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load goals.');
        }
    },

    getFilteredGoals() {
        return this.goals
            .filter((goal) => {
                const linkText = (goal.links || []).map((link) => `${link.title} ${link.url}`).join(' ');
                const haystack = `${goal.title} ${goal.notes || ''} ${goal.type || ''} ${linkText}`.toLowerCase();
                if (this.filters.query && !haystack.includes(this.filters.query)) {
                    return false;
                }
                if (this.filters.status !== 'all' && goal.status !== this.filters.status) {
                    return false;
                }
                return true;
            })
            .sort((left, right) => {
                if (left.status !== right.status) {
                    const order = { active: 0, paused: 1, completed: 2, archived: 3 };
                    return (order[left.status] ?? 99) - (order[right.status] ?? 99);
                }
                const leftTime = left.target_date ? new Date(left.target_date).getTime() : Number.MAX_SAFE_INTEGER;
                const rightTime = right.target_date ? new Date(right.target_date).getTime() : Number.MAX_SAFE_INTEGER;
                if (leftTime === rightTime) {
                    return left.title.localeCompare(right.title);
                }
                return leftTime - rightTime;
            });
    },

    renderGoals() {
        const goals = this.getFilteredGoals();
        const grid = document.getElementById('goals-grid');
        if (!grid) return;

        this.renderSummary(goals);
        const countEl = document.getElementById('goals-results-count');
        if (countEl) {
            countEl.textContent = `${goals.length} goal${goals.length === 1 ? '' : 's'}`;
        }

        grid.innerHTML = '';
        if (goals.length === 0) {
            CoreUI.setEmptyState(grid, 'No goals match the current filters.');
            return;
        }

        goals.forEach((goal) => {
            const card = document.createElement('div');
            card.className = 'compact-item goal-card';
            card.onclick = () => this.openCreateModal(goal.id);

            const dueLabel = goal.target_date ? CoreUI.formatDate(goal.target_date) : 'No target date';
            const notePreview = goal.notes
                ? `<div class="item-desc goal-card-notes">${CoreUI.escapeHtml(goal.notes)}</div>`
                : '<div class="item-desc">No notes yet.</div>';
            const links = goal.links || [];
            const milestones = goal.milestones || [];
            const linkPreview = links.length
                ? `<div class="goal-card-links">${links.slice(0, 4).map((link) => `
                    <a class="btn btn-sm goal-link-chip" href="${CoreUI.escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" title="${CoreUI.escapeHtml(link.url)}">
                        <i class="ph ph-arrow-square-out"></i>${CoreUI.escapeHtml(link.title)}
                    </a>
                `).join('')}</div>`
                : '<div class="item-desc">No websites linked.</div>';

            card.innerHTML = `
                <div class="goal-card-header">
                    <div>
                        <div class="goal-card-meta">
                            <span class="badge">${CoreUI.escapeHtml(goal.type)}</span>
                            <span class="badge">${CoreUI.escapeHtml(goal.status)}</span>
                        </div>
                        <div class="item-title" style="font-size: 17px; margin-top: 8px;">${CoreUI.escapeHtml(goal.title)}</div>
                    </div>
                    <div style="display:flex; gap:4px;">
                        <button class="btn btn-icon" onclick="event.stopPropagation(); GoalUI.openCreateModal(${goal.id})" title="Edit goal"><i class="ph ph-pencil-simple"></i></button>
                        ${goal.status !== 'completed' ? `<button class="btn btn-icon" onclick="event.stopPropagation(); GoalUI.quickStatus(${goal.id}, 'completed')" title="Mark completed"><i class="ph ph-check"></i></button>` : ''}
                    </div>
                </div>
                <div class="item-desc">Target ${CoreUI.escapeHtml(dueLabel)}</div>
                ${notePreview}
                ${linkPreview}
                <div>
                    <div class="goal-card-footer">
                        <span class="item-desc">Tasks ${goal.completed_task_count}/${goal.task_count} • Projects ${goal.project_count || 0}</span>
                        <span class="item-desc">${goal.progress}%</span>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill" style="width:${goal.progress}%; background:${goal.status === 'completed' ? '#77d19a' : '#7aa2ff'};"></div>
                    </div>
                    <div class="item-desc" style="margin-top:6px;">Milestones ${goal.completed_milestone_count || 0}/${milestones.length}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    renderSummary(goals) {
        const summary = document.getElementById('goals-summary-grid');
        if (!summary) return;

        const active = goals.filter((goal) => goal.status === 'active').length;
        const completed = goals.filter((goal) => goal.status === 'completed').length;
        const withNotes = goals.filter((goal) => (goal.notes || '').trim()).length;
        const withLinks = goals.filter((goal) => (goal.links || []).length > 0).length;
        const avgProgress = goals.length
            ? Math.round(goals.reduce((total, goal) => total + (goal.progress || 0), 0) / goals.length)
            : 0;

        summary.innerHTML = `
            <div class="compact-item goal-summary-stat">
                <span class="item-desc">Active</span>
                <div class="goal-summary-value">${active}</div>
                <span class="badge">Current</span>
            </div>
            <div class="compact-item goal-summary-stat">
                <span class="item-desc">Completed</span>
                <div class="goal-summary-value">${completed}</div>
                <span class="badge">Done</span>
            </div>
            <div class="compact-item goal-summary-stat">
                <span class="item-desc">Resources</span>
                <div class="goal-summary-value">${withLinks}</div>
                <span class="badge">${withNotes} noted</span>
            </div>
            <div class="compact-item goal-summary-stat">
                <span class="item-desc">Average Progress</span>
                <div class="goal-summary-value">${avgProgress}%</div>
                <span class="badge">Task linked</span>
            </div>
        `;
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
        document.getElementById('goal-notes').value = '';
        this.renderLinks([], false);
        this.renderMilestones([], false);

        if (goalId) {
            const goal = this.goals.find((item) => item.id === goalId);
            if (!goal) return;
            title.textContent = 'Edit Goal';
            document.getElementById('goal-id').value = goal.id;
            document.getElementById('goal-title').value = goal.title;
            document.getElementById('goal-type').value = goal.type;
            document.getElementById('goal-date').value = goal.target_date || '';
            document.getElementById('goal-status').value = goal.status;
            document.getElementById('goal-notes').value = goal.notes || '';
            this.renderLinks(goal.links || [], true);
            this.renderMilestones(goal.milestones || [], true);
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'New Goal';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('goal-modal').style.display = 'none';
        document.getElementById('goal-form').reset();
    },

    renderLinks(links, canEdit) {
        const list = document.getElementById('goal-links-list');
        const addRow = document.getElementById('goal-link-add');
        if (!list || !addRow) return;

        addRow.style.display = canEdit ? 'flex' : 'none';
        document.getElementById('goal-link-title').value = '';
        document.getElementById('goal-link-url').value = '';

        if (!canEdit) {
            list.innerHTML = '<div class="item-desc">Save the goal to add websites.</div>';
            return;
        }

        if (!links.length) {
            list.innerHTML = '<div class="item-desc">No websites linked yet.</div>';
            return;
        }

        list.innerHTML = links.map((link) => `
            <div class="goal-link-row">
                <a class="btn btn-sm goal-link-chip" href="${CoreUI.escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" title="${CoreUI.escapeHtml(link.url)}">
                    <i class="ph ph-arrow-square-out"></i>${CoreUI.escapeHtml(link.title)}
                </a>
                <button type="button" class="btn btn-icon btn-danger" onclick="GoalUI.deleteLink(${link.id})" title="Delete website"><i class="ph ph-trash"></i></button>
            </div>
        `).join('');
    },

    renderMilestones(milestones, canEdit) {
        const list = document.getElementById('goal-milestones-list');
        const addRow = document.getElementById('goal-milestone-add');
        if (!list || !addRow) return;

        addRow.style.display = canEdit ? 'grid' : 'none';
        document.getElementById('goal-milestone-title').value = '';
        document.getElementById('goal-milestone-status').value = 'pending';
        document.getElementById('goal-milestone-date').value = '';

        if (!canEdit) {
            list.innerHTML = '<div class="item-desc">Save the goal to add milestones.</div>';
            return;
        }

        if (!milestones.length) {
            list.innerHTML = '<div class="item-desc">No milestones yet.</div>';
            return;
        }

        list.innerHTML = milestones.map((milestone) => `
            <div class="goal-milestone-row">
                <div class="item-main">
                    <div class="item-title">${CoreUI.escapeHtml(milestone.title)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(milestone.status)} - ${CoreUI.formatDate(milestone.due_date)}</div>
                </div>
                <div class="goal-modal-actions">
                    ${milestone.status !== 'completed' ? `<button type="button" class="btn btn-icon" onclick="GoalUI.updateMilestone(${milestone.id}, 'completed')" title="Mark completed"><i class="ph ph-check"></i></button>` : ''}
                    <button type="button" class="btn btn-icon btn-danger" onclick="GoalUI.deleteMilestone(${milestone.id})" title="Delete milestone"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `).join('');
    },

    openQuickAdd() {
        this.openCreateModal();
    },

    async submitGoal(event) {
        event.preventDefault();
        const goalId = document.getElementById('goal-id').value;
        const payload = {
            title: document.getElementById('goal-title').value,
            type: document.getElementById('goal-type').value,
            target_date: document.getElementById('goal-date').value || null,
            status: document.getElementById('goal-status').value,
            notes: document.getElementById('goal-notes').value
        };

        try {
            if (goalId) {
                await API.put(`/api/goals/${goalId}`, payload);
            } else {
                const response = await API.post('/api/goals/', payload);
                document.getElementById('goal-id').value = response.goal.id;
            }
            this.closeModal();
            await this.loadGoals();
            CoreUI.showError('Goal saved.', true);
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

    async addLink() {
        const goalId = document.getElementById('goal-id').value;
        const titleInput = document.getElementById('goal-link-title');
        const urlInput = document.getElementById('goal-link-url');
        const title = titleInput.value.trim();
        const url = urlInput.value.trim();

        if (!goalId || !title || !url) {
            CoreUI.showError('Add a website label and URL first.');
            return;
        }

        try {
            await API.post(`/api/goals/${goalId}/links`, { title, url });
            await this.loadGoals();
            const goal = this.goals.find((item) => item.id === Number(goalId));
            this.renderLinks(goal?.links || [], true);
            CoreUI.showError('Website linked.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to add website.');
        }
    },

    async deleteLink(linkId) {
        const goalId = document.getElementById('goal-id').value;
        if (!goalId || !(await CoreUI.confirm({
            title: 'Delete website link?',
            message: 'This website link will be removed from the goal.',
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/goals/${goalId}/links/${linkId}`);
            await this.loadGoals();
            const goal = this.goals.find((item) => item.id === Number(goalId));
            this.renderLinks(goal?.links || [], true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete website.');
        }
    },

    async addMilestone() {
        const goalId = document.getElementById('goal-id').value;
        const title = document.getElementById('goal-milestone-title').value.trim();
        const status = document.getElementById('goal-milestone-status').value;
        const dueDate = document.getElementById('goal-milestone-date').value || null;

        if (!goalId || !title) {
            CoreUI.showError('Add a milestone title first.');
            return;
        }

        try {
            await API.post(`/api/goals/${goalId}/milestones`, { title, status, due_date: dueDate });
            await this.loadGoals();
            const goal = this.goals.find((item) => item.id === Number(goalId));
            this.renderMilestones(goal?.milestones || [], true);
            CoreUI.showError('Milestone added.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to add milestone.');
        }
    },

    async updateMilestone(milestoneId, status) {
        const goalId = document.getElementById('goal-id').value;
        if (!goalId) return;

        try {
            await API.put(`/api/goals/${goalId}/milestones/${milestoneId}`, { status });
            await this.loadGoals();
            const goal = this.goals.find((item) => item.id === Number(goalId));
            this.renderMilestones(goal?.milestones || [], true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update milestone.');
        }
    },

    async deleteMilestone(milestoneId) {
        const goalId = document.getElementById('goal-id').value;
        if (!goalId || !(await CoreUI.confirm({
            title: 'Delete milestone?',
            message: 'This milestone will be removed from the goal.',
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/goals/${goalId}/milestones/${milestoneId}`);
            await this.loadGoals();
            const goal = this.goals.find((item) => item.id === Number(goalId));
            this.renderMilestones(goal?.milestones || [], true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete milestone.');
        }
    },

    async deleteCurrentGoal() {
        const goalId = document.getElementById('goal-id').value;
        if (!goalId || !(await CoreUI.confirm({
            title: 'Delete goal?',
            message: 'This goal will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/goals/${goalId}`);
            this.closeModal();
            await this.loadGoals();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete goal.');
        }
    }
};

window.GoalUI = GoalUI;

document.addEventListener('DOMContentLoaded', () => {
    GoalUI.init();
    GoalUI.loadGoals();
});
