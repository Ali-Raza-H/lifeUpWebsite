const TaskUI = {
    async loadTasks() {
        try {
            const [pendingTasks, inProgressTasks, completedTasks] = await Promise.all([
                API.get('/api/tasks/?status=pending'),
                API.get('/api/tasks/?status=in_progress'),
                API.get('/api/tasks/?status=completed')
            ]);
            const activeTasks = [...pendingTasks, ...inProgressTasks];

            const pendingList = document.getElementById('tasks-pending');
            const completedList = document.getElementById('tasks-completed');
            if (!pendingList || !completedList) return;

            pendingList.innerHTML = '';
            completedList.innerHTML = '';

            if (activeTasks.length === 0) {
                CoreUI.setEmptyState(pendingList, 'No tasks pending.');
            } else {
                activeTasks.sort((a, b) => a.priority - b.priority).forEach((task) => {
                    const div = document.createElement('div');
                    div.className = 'compact-item';
                    div.style.flexDirection = 'column';
                    div.style.gap = '8px';
                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; width:100%; gap: 12px;">
                            <span class="item-title">${CoreUI.escapeHtml(task.title)}</span>
                            ${CoreUI.getPriorityLabel(task.priority)}
                        </div>
                        <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap: 12px;">
                            <span class="item-desc"><i class="ph ph-clock"></i> ${CoreUI.escapeHtml(task.status.replace('_', ' '))} • Due: ${CoreUI.escapeHtml(CoreUI.formatDate(task.due_date))}</span>
                            <div style="display: flex; gap: 4px;">
                                <button class="btn btn-icon" onclick="TaskUI.completeTask(${task.id})" title="Complete"><i class="ph ph-check"></i></button>
                                <button class="btn btn-icon" onclick="TaskUI.deleteTask(${task.id})" title="Delete"><i class="ph ph-trash"></i></button>
                            </div>
                        </div>
                    `;
                    pendingList.appendChild(div);
                });
            }

            if (completedTasks.length === 0) {
                CoreUI.setEmptyState(completedList, 'No tasks completed.');
            } else {
                completedTasks.forEach((task) => {
                    const div = document.createElement('div');
                    div.className = 'compact-item';
                    div.style.flexDirection = 'column';
                    div.style.gap = '8px';
                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; width:100%;">
                            <span class="item-title" style="text-decoration: line-through; color: var(--text-muted);">${CoreUI.escapeHtml(task.title)}</span>
                        </div>
                        <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap: 12px;">
                            <span class="item-desc">Completed ${CoreUI.escapeHtml(CoreUI.formatDate(task.completed_at || task.created_at))}</span>
                            <button class="btn btn-icon" onclick="TaskUI.deleteTask(${task.id})" title="Delete"><i class="ph ph-trash"></i></button>
                        </div>
                    `;
                    completedList.appendChild(div);
                });
            }
        } catch (error) {
            console.error('Failed to load tasks', error);
            CoreUI.showError(error.message || 'Failed to load tasks.');
        }
    },

    openCreateModal() {
        document.getElementById('task-modal').style.display = 'flex';
    },

    closeModal() {
        document.getElementById('task-modal').style.display = 'none';
        document.getElementById('task-form').reset();
    },

    async submitTask(event) {
        event.preventDefault();
        const title = document.getElementById('task-title').value;
        const description = document.getElementById('task-desc').value;
        const priority = parseInt(document.getElementById('task-priority').value, 10);

        try {
            await API.post('/api/tasks/', { title, description, priority });
            this.closeModal();
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create task.');
        }
    },

    async completeTask(id) {
        try {
            await API.put(`/api/tasks/${id}`, { status: 'completed' });
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update task.');
        }
    },

    async deleteTask(id) {
        if (!confirm('Confirm deletion?')) return;
        try {
            await API.delete(`/api/tasks/${id}`);
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete task.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    TaskUI.loadTasks();
});
