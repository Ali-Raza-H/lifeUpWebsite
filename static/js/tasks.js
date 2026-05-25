const TaskUI = {
    tasks: [],

    async loadTasks() {
        try {
            const [pendingTasks, inProgressTasks, onHoldTasks, completedTasks] = await Promise.all([
                API.get('/api/tasks/?status=pending'),
                API.get('/api/tasks/?status=in_progress'),
                API.get('/api/tasks/?status=on_hold'),
                API.get('/api/tasks/?status=completed')
            ]);
            
            // Store locally for editing
            this.tasks = [...pendingTasks, ...inProgressTasks, ...onHoldTasks, ...completedTasks];

            const pendingList = document.getElementById('tasks-pending');
            const inProgressList = document.getElementById('tasks-in-progress');
            const completedList = document.getElementById('tasks-completed');
            if (!pendingList || !inProgressList || !completedList) return;

            pendingList.innerHTML = '';
            inProgressList.innerHTML = '';
            completedList.innerHTML = '';

            const ongoingTasks = [...inProgressTasks, ...onHoldTasks].sort((a, b) => a.priority - b.priority);

            if (pendingTasks.length === 0) CoreUI.setEmptyState(pendingList, 'No pending tasks.');
            else pendingTasks.sort((a, b) => a.priority - b.priority).forEach(t => pendingList.appendChild(this.createTaskElement(t)));

            if (ongoingTasks.length === 0) CoreUI.setEmptyState(inProgressList, 'No tasks in progress.');
            else ongoingTasks.forEach(t => inProgressList.appendChild(this.createTaskElement(t)));

            if (completedTasks.length === 0) CoreUI.setEmptyState(completedList, 'No tasks completed.');
            else completedTasks.forEach(t => completedList.appendChild(this.createTaskElement(t)));

        } catch (error) {
            console.error('Failed to load tasks', error);
            CoreUI.showError(error.message || 'Failed to load tasks.');
        }
    },

    createTaskElement(task) {
        const div = document.createElement('div');
        div.className = 'compact-item';
        div.style.flexDirection = 'column';
        div.style.gap = '8px';
        
        let actionsHtml = '';
        let statusBadge = '';
        
        const dueStr = task.due_date ? ` • Due: ${task.due_date.replace('T', ' ').substring(0, 16)}` : '';
        const estStr = task.estimated_minutes ? ` • ${task.estimated_minutes}m` : '';

        if (task.status === 'completed') {
            actionsHtml = `<button class="btn btn-icon" onclick="TaskUI.deleteTask(${task.id})" title="Delete"><i class="ph ph-trash"></i></button>`;
        } else {
            actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.openCreateModal(${task.id})" title="Edit"><i class="ph ph-pencil-simple"></i></button>`;
            
            if (task.status === 'pending') {
                actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'in_progress')" title="Start"><i class="ph ph-play"></i></button>`;
            } else if (task.status === 'in_progress') {
                actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'on_hold')" title="Stash/Pause"><i class="ph ph-pause"></i></button>`;
                statusBadge = `<span class="badge" style="background: var(--primary); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px;">Active</span>`;
            } else if (task.status === 'on_hold') {
                actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'in_progress')" title="Resume"><i class="ph ph-play"></i></button>`;
                statusBadge = `<span class="badge" style="background: var(--border-focus); padding: 2px 6px; border-radius: 4px; font-size: 10px;">Stashed</span>`;
            }
            
            actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.updateStatus(${task.id}, 'completed')" title="Complete"><i class="ph ph-check"></i></button>`;
            actionsHtml += `<button class="btn btn-icon" onclick="TaskUI.deleteTask(${task.id})" title="Delete"><i class="ph ph-trash"></i></button>`;
        }

        const titleStyle = task.status === 'completed' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; gap: 12px; align-items: start;">
                <div style="display:flex; flex-direction:column; gap: 4px;">
                    <span class="item-title" style="${titleStyle}">${CoreUI.escapeHtml(task.title)}</span>
                    ${statusBadge}
                </div>
                ${CoreUI.getPriorityLabel(task.priority)}
            </div>
            ${task.description ? `<div class="item-desc" style="white-space: pre-wrap; font-size: 11px;">${CoreUI.escapeHtml(task.description)}</div>` : ''}
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap: 12px; margin-top: 4px;">
                <span class="item-desc"><i class="ph ph-clock"></i> ${task.status === 'completed' ? 'Completed ' + (task.completed_at ? task.completed_at.substring(0,10) : '') : 'Pending'}${dueStr}${estStr}</span>
                <div style="display: flex; gap: 4px;">
                    ${actionsHtml}
                </div>
            </div>
        `;
        return div;
    },

    openCreateModal(taskId = null) {
        const modal = document.getElementById('task-modal');
        const title = document.getElementById('task-modal-title');
        const form = document.getElementById('task-form');
        
        form.reset();
        document.getElementById('task-id').value = '';
        title.textContent = 'Create Task';

        if (taskId) {
            const task = this.tasks.find(t => t.id === taskId);
            if (task) {
                title.textContent = 'Edit Task';
                document.getElementById('task-id').value = task.id;
                document.getElementById('task-title').value = task.title;
                document.getElementById('task-desc').value = task.description || '';
                document.getElementById('task-priority').value = task.priority;
                document.getElementById('task-est').value = task.estimated_minutes || '';
                
                if (task.due_date) {
                    // due_date from API is usually like "2026-05-18 10:00:00"
                    // datetime-local expects "YYYY-MM-DDTHH:MM"
                    document.getElementById('task-due-date').value = task.due_date.replace(' ', 'T').substring(0, 16);
                }
            }
        }
        
        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('task-modal').style.display = 'none';
        document.getElementById('task-form').reset();
    },

    async submitTask(event) {
        event.preventDefault();
        const taskId = document.getElementById('task-id').value;
        const payload = {
            title: document.getElementById('task-title').value,
            description: document.getElementById('task-desc').value,
            priority: parseInt(document.getElementById('task-priority').value, 10),
            estimated_minutes: parseInt(document.getElementById('task-est').value, 10) || null,
            due_date: document.getElementById('task-due-date').value || null
        };

        try {
            if (taskId) {
                await API.put(`/api/tasks/${taskId}`, payload);
            } else {
                await API.post('/api/tasks/', payload);
            }
            this.closeModal();
            await this.loadTasks();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save task.');
        }
    },

    async updateStatus(id, newStatus) {
        try {
            await API.put(`/api/tasks/${id}`, { status: newStatus });
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