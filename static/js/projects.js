const ProjectUI = {
    projects: [],

    async loadProjects() {
        try {
            const projects = await API.get('/api/projects/');
            this.projects = projects;
            const grid = document.getElementById('projects-grid');
            if (!grid) return;

            grid.innerHTML = '';
            if (projects.length === 0) {
                CoreUI.setEmptyState(grid, 'No active projects.');
                return;
            }

            const list = document.createElement('div');
            list.className = 'compact-list';
            projects.forEach((project) => {
                const div = document.createElement('div');
                div.className = 'compact-item';
                div.style.flexDirection = 'column';
                div.style.gap = '10px';
                div.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; width:100%;">
                        <div>
                            <div class="item-title" style="font-size: 16px;">${CoreUI.escapeHtml(project.name)}</div>
                            <div class="item-desc" style="margin-top: 4px;">${CoreUI.escapeHtml(project.status)} • due ${CoreUI.escapeHtml(CoreUI.formatDate(project.deadline))}</div>
                            <div class="item-desc" style="margin-top: 4px;">${CoreUI.escapeHtml(project.description || 'No description')}</div>
                            <div class="item-desc" style="margin-top: 4px;">Tasks: ${project.completed_task_count}/${project.task_count} complete</div>
                        </div>
                        <div style="display:flex; gap: 4px;">
                            <button class="btn btn-icon" onclick="ProjectUI.openCreateModal(${project.id})" title="Edit Project"><i class="ph ph-pencil-simple"></i></button>
                            ${project.status !== 'completed' ? `<button class="btn btn-icon" onclick="ProjectUI.quickStatus(${project.id}, 'completed')" title="Mark Complete"><i class="ph ph-check"></i></button>` : ''}
                        </div>
                    </div>
                    <div>
                        <div style="display:flex; justify-content: space-between; font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">
                            <span>Completion</span>
                            <span>${project.progress}%</span>
                        </div>
                        <div class="progress-track">
                            <div class="progress-fill" style="width: ${project.progress}%;"></div>
                        </div>
                    </div>
                `;
                list.appendChild(div);
            });
            grid.appendChild(list);
        } catch (error) {
            console.error('Failed to load projects', error);
            CoreUI.showError(error.message || 'Failed to load projects.');
        }
    },

    openCreateModal(projectId = null) {
        const modal = document.getElementById('project-modal');
        const title = document.getElementById('project-modal-title');
        const deleteBtn = document.getElementById('project-delete-btn');
        const form = document.getElementById('project-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('project-id').value = '';
        document.getElementById('project-status').value = 'active';

        if (projectId) {
            const project = this.projects.find((item) => item.id === projectId);
            if (!project) return;
            title.textContent = 'Edit Project';
            document.getElementById('project-id').value = project.id;
            document.getElementById('project-name').value = project.name;
            document.getElementById('project-desc').value = project.description || '';
            document.getElementById('project-deadline').value = project.deadline || '';
            document.getElementById('project-status').value = project.status;
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'New Architecture';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('project-modal').style.display = 'none';
        document.getElementById('project-form').reset();
    },

    async submitProject(event) {
        event.preventDefault();
        const projectId = document.getElementById('project-id').value;
        const payload = {
            name: document.getElementById('project-name').value,
            description: document.getElementById('project-desc').value,
            deadline: document.getElementById('project-deadline').value,
            status: document.getElementById('project-status').value
        };

        try {
            if (projectId) {
                await API.put(`/api/projects/${projectId}`, payload);
            } else {
                await API.post('/api/projects/', payload);
            }
            this.closeModal();
            await this.loadProjects();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save project.');
        }
    },

    async quickStatus(id, status) {
        try {
            await API.put(`/api/projects/${id}`, { status });
            await this.loadProjects();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update project.');
        }
    },

    async deleteCurrentProject() {
        const projectId = document.getElementById('project-id').value;
        if (!projectId || !confirm('Confirm deconstruction?')) return;
        try {
            await API.delete(`/api/projects/${projectId}`);
            this.closeModal();
            await this.loadProjects();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete project.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ProjectUI.loadProjects();
});
