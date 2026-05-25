const ProjectUI = {
    projects: [],
    goals: [],
    allHabits: [],
    currentView: 'kanban', // 'kanban' or 'timeline'

    async loadData() {
        try {
            const [projects, goals, habits] = await Promise.all([
                API.get('/api/projects/'),
                API.get('/api/goals/'),
                API.get('/api/habits/')
            ]);
            this.projects = projects;
            this.goals = goals;
            this.allHabits = habits;
            
            this.renderView();
        } catch (error) {
            console.error('Failed to load project data', error);
            CoreUI.showError(error.message || 'Failed to load project data.');
        }
    },
    
    toggleView() {
        this.currentView = this.currentView === 'kanban' ? 'timeline' : 'kanban';
        document.getElementById('projects-kanban').style.display = this.currentView === 'kanban' ? 'grid' : 'none';
        document.getElementById('projects-timeline').style.display = this.currentView === 'timeline' ? 'block' : 'none';
        this.renderView();
    },

    renderView() {
        if (this.currentView === 'kanban') {
            this.renderKanban();
        } else {
            this.renderTimeline();
        }
    },

    renderKanban() {
        const columns = {
            'planning': document.getElementById('projects-planning'),
            'active': document.getElementById('projects-active'),
            'paused': document.getElementById('projects-paused'),
            'completed': document.getElementById('projects-completed')
        };
        
        Object.values(columns).forEach(col => { if(col) col.innerHTML = ''; });
        
        const grouped = { planning: [], active: [], paused: [], completed: [] };
        
        this.projects.forEach(p => {
            if (grouped[p.status]) grouped[p.status].push(p);
            else grouped['active'].push(p); // default fallback
        });
        
        Object.keys(columns).forEach(status => {
            const col = columns[status];
            if (!col) return;
            
            if (grouped[status].length === 0) {
                CoreUI.setEmptyState(col, 'Empty');
            } else {
                grouped[status].forEach(project => {
                    col.appendChild(this.createProjectCard(project));
                });
            }
        });
    },
    
    createProjectCard(project) {
        const div = document.createElement('div');
        div.className = 'compact-item';
        div.style.flexDirection = 'column';
        div.style.gap = '10px';
        div.style.cursor = 'pointer';
        div.onclick = () => this.openCreateModal(project.id);
        
        const deadlineStr = project.deadline ? `Due ${CoreUI.escapeHtml(CoreUI.formatDate(project.deadline))}` : 'No deadline';
        const titleStyle = project.status === 'completed' ? 'text-decoration: line-through; color: var(--text-muted);' : '';
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                <div class="item-title" style="${titleStyle}">${CoreUI.escapeHtml(project.name)}</div>
                ${project.status !== 'completed' ? `<button class="btn btn-icon" onclick="event.stopPropagation(); ProjectUI.quickStatus(${project.id}, 'completed')" title="Complete"><i class="ph ph-check"></i></button>` : ''}
            </div>
            <div class="item-desc">${deadlineStr}</div>
            ${project.description ? `<div class="item-desc" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(project.description)}</div>` : ''}
            <div>
                <div style="display:flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-bottom: 4px;">
                    <span>Tasks: ${project.completed_task_count}/${project.task_count}</span>
                    <span>${project.progress}%</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${project.progress}%; background: ${project.progress === 100 ? 'var(--text-success)' : 'var(--primary)'}"></div>
                </div>
            </div>
        `;
        return div;
    },
    
    renderTimeline() {
        const container = document.getElementById('timeline-container');
        if (!container) return;
        
        if (this.projects.length === 0) {
            container.innerHTML = '<div class="item-desc" style="padding: 20px;">No projects to display.</div>';
            return;
        }
        
        // Very basic timeline visualization
        let html = '<div style="display:flex; flex-direction:column; gap: 8px; min-width: 600px;">';
        
        // Find min and max dates to scale
        const now = new Date();
        let minDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 1 month ago
        let maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 2 months from now
        
        this.projects.forEach(p => {
            if (p.created_at) {
                const cDate = new Date(p.created_at);
                if (cDate < minDate) minDate = cDate;
            }
            if (p.deadline) {
                const dDate = new Date(p.deadline);
                if (dDate > maxDate) maxDate = dDate;
            }
        });
        
        const totalDuration = maxDate - minDate;
        
        this.projects.sort((a,b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)).forEach(project => {
            const start = project.created_at ? new Date(project.created_at) : new Date();
            const end = project.deadline ? new Date(project.deadline) : new Date(start.getTime() + 7*24*60*60*1000);
            
            let leftPct = ((start - minDate) / totalDuration) * 100;
            let widthPct = ((end - start) / totalDuration) * 100;
            
            // Constrain
            leftPct = Math.max(0, Math.min(100, leftPct));
            widthPct = Math.max(1, Math.min(100 - leftPct, widthPct));
            
            const color = project.status === 'completed' ? 'var(--text-success)' : (project.status === 'paused' ? 'var(--text-muted)' : 'var(--primary)');
            const opacity = project.status === 'planning' ? '0.5' : '1';
            
            html += `
                <div style="position: relative; height: 30px; background: var(--bg-panel); border-radius: 4px; display: flex; align-items: center; border: 1px solid var(--border-subtle);">
                    <div style="position: absolute; left: ${leftPct}%; width: ${widthPct}%; height: 100%; background: ${color}; opacity: ${opacity}; border-radius: 3px; display: flex; align-items: center; padding: 0 8px; overflow: hidden; color: #fff; font-size: 11px; white-space: nowrap; cursor: pointer;" onclick="ProjectUI.openCreateModal(${project.id})">
                        ${CoreUI.escapeHtml(project.name)}
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
    },

    async openCreateModal(projectId = null) {
        const modal = document.getElementById('project-modal');
        const title = document.getElementById('project-modal-title');
        const deleteBtn = document.getElementById('project-delete-btn');
        const form = document.getElementById('project-form');
        const notebookBtn = document.getElementById('btn-open-notebook');
        
        const goalSelect = document.getElementById('project-goal');
        const habitSelect = document.getElementById('available-habits');
        
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('project-id').value = '';
        document.getElementById('project-status').value = 'planning';
        
        // Populate Goal dropdown
        goalSelect.innerHTML = '<option value="">-- No Goal --</option>';
        this.goals.forEach(g => {
            goalSelect.innerHTML += `<option value="${g.id}">${CoreUI.escapeHtml(g.title)}</option>`;
        });
        
        // Hide integration sections if new project
        document.getElementById('project-task-add').style.display = projectId ? 'block' : 'none';
        document.getElementById('project-habit-add').style.display = projectId ? 'block' : 'none';
        notebookBtn.style.display = projectId ? 'inline-flex' : 'none';
        
        const tasksList = document.getElementById('project-tasks-list');
        const habitsList = document.getElementById('project-habits-list');
        
        if (projectId) {
            title.textContent = 'Edit Project Dashboard';
            deleteBtn.style.display = 'inline-flex';
            notebookBtn.href = `/projects/${projectId}/notebook`;
            
            try {
                // Fetch full project details including linked habits
                const projectDetail = await API.get(`/api/projects/${projectId}`);
                const tasks = await API.get(`/api/tasks/?project_id=${projectId}`);
                
                document.getElementById('project-id').value = projectDetail.id;
                document.getElementById('project-name').value = projectDetail.name;
                document.getElementById('project-desc').value = projectDetail.description || '';
                document.getElementById('project-deadline').value = projectDetail.deadline || '';
                document.getElementById('project-status').value = projectDetail.status;
                document.getElementById('project-goal').value = projectDetail.goal_id || '';
                
                // Render Tasks
                tasksList.innerHTML = '';
                if (tasks.length === 0) {
                    tasksList.innerHTML = '<div class="item-desc">No tasks linked.</div>';
                } else {
                    tasks.forEach(t => {
                        tasksList.innerHTML += `
                            <div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px solid var(--border-subtle); align-items:center;">
                                <span style="font-size: 12px; ${t.status === 'completed' ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${CoreUI.escapeHtml(t.title)}</span>
                                <button type="button" class="btn btn-icon" onclick="ProjectUI.deleteTask(${t.id})" style="padding: 2px;"><i class="ph ph-trash"></i></button>
                            </div>
                        `;
                    });
                }
                
                // Render Habits
                habitsList.innerHTML = '';
                if (!projectDetail.habits || projectDetail.habits.length === 0) {
                    habitsList.innerHTML = '<div class="item-desc">No habits linked.</div>';
                } else {
                    projectDetail.habits.forEach(h => {
                        habitsList.innerHTML += `
                            <div style="display:flex; justify-content:space-between; padding: 4px 0; border-bottom: 1px solid var(--border-subtle); align-items:center;">
                                <span style="font-size: 12px;">${CoreUI.escapeHtml(h.name)}</span>
                                <button type="button" class="btn btn-icon" onclick="ProjectUI.unlinkHabit(${projectId}, ${h.id})" style="padding: 2px;"><i class="ph ph-x"></i></button>
                            </div>
                        `;
                    });
                }
                
                // Populate available habits
                habitSelect.innerHTML = '';
                const linkedHabitIds = (projectDetail.habits || []).map(h => h.id);
                this.allHabits.forEach(h => {
                    if (!linkedHabitIds.includes(h.id)) {
                        habitSelect.innerHTML += `<option value="${h.id}">${CoreUI.escapeHtml(h.name)}</option>`;
                    }
                });
                if (habitSelect.options.length === 0) {
                    habitSelect.innerHTML = '<option value="">All habits linked</option>';
                    habitSelect.disabled = true;
                } else {
                    habitSelect.disabled = false;
                }
                
            } catch (error) {
                CoreUI.showError('Failed to load project details.');
            }
        } else {
            title.textContent = 'New Project';
            deleteBtn.style.display = 'none';
            tasksList.innerHTML = '<div class="item-desc">Save the project to manage tasks.</div>';
            habitsList.innerHTML = '<div class="item-desc">Save the project to manage habits.</div>';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('project-modal').style.display = 'none';
    },

    async submitProject(event) {
        event.preventDefault();
        const projectId = document.getElementById('project-id').value;
        const payload = {
            name: document.getElementById('project-name').value,
            description: document.getElementById('project-desc').value,
            deadline: document.getElementById('project-deadline').value || null,
            status: document.getElementById('project-status').value,
            goal_id: document.getElementById('project-goal').value ? parseInt(document.getElementById('project-goal').value, 10) : null
        };

        try {
            if (projectId) {
                await API.put(`/api/projects/${projectId}`, payload);
            } else {
                await API.post('/api/projects/', payload);
            }
            this.closeModal();
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save project.');
        }
    },

    async quickStatus(id, status) {
        try {
            await API.put(`/api/projects/${id}`, { status });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update project.');
        }
    },

    async deleteCurrentProject() {
        const projectId = document.getElementById('project-id').value;
        if (!projectId || !confirm('Confirm project deletion?')) return;
        try {
            await API.delete(`/api/projects/${projectId}`);
            this.closeModal();
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete project.');
        }
    },
    
    // Integrations
    async quickAddTask() {
        const titleInput = document.getElementById('new-task-title');
        const title = titleInput.value.trim();
        const projectId = document.getElementById('project-id').value;
        
        if (!title || !projectId) return;
        
        try {
            await API.post('/api/tasks/', { title: title, project_id: parseInt(projectId, 10) });
            titleInput.value = '';
            // Refresh modal
            this.openCreateModal(parseInt(projectId, 10));
            // Background load projects to update counts
            this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to add task.');
        }
    },
    
    async deleteTask(taskId) {
        const projectId = document.getElementById('project-id').value;
        if (!confirm('Delete task?')) return;
        try {
            await API.delete(`/api/tasks/${taskId}`);
            this.openCreateModal(parseInt(projectId, 10));
            this.loadData();
        } catch (error) {
            CoreUI.showError('Failed to delete task.');
        }
    },
    
    async linkHabit() {
        const projectId = document.getElementById('project-id').value;
        const habitSelect = document.getElementById('available-habits');
        const habitId = habitSelect.value;
        
        if (!projectId || !habitId) return;
        
        try {
            await API.post(`/api/projects/${projectId}/habits`, { habit_id: parseInt(habitId, 10) });
            this.openCreateModal(parseInt(projectId, 10));
        } catch (error) {
            CoreUI.showError('Failed to link habit.');
        }
    },
    
    async unlinkHabit(projectId, habitId) {
        if (!confirm('Unlink this habit?')) return;
        try {
            await API.delete(`/api/projects/${projectId}/habits/${habitId}`);
            this.openCreateModal(projectId);
        } catch (error) {
            CoreUI.showError('Failed to unlink habit.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ProjectUI.loadData();
});