const GuestOverviewUI = {
    skillsChartInstance: null,

    async init() {
        try {
            const [profile, projects, workSummary, workExperiences, librarySummary, libraryItems] = await Promise.all([
                API.get('/api/profile/all'),
                API.get('/api/projects/'),
                API.get('/api/work/summary'),
                API.get('/api/work/experiences'),
                API.get('/api/library/summary'),
                API.get('/api/library/items')
            ]);

            this.renderMetrics({ profile, projects, workSummary, librarySummary });
            this.renderProjects(projects || []);
            this.renderWork(workExperiences || []);
            this.renderProfile(profile || {});
            this.renderLibrary(librarySummary || {}, libraryItems || []);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load guest overview.');
        }
    },

    renderMetrics({ profile, projects, workSummary, librarySummary }) {
        const container = document.getElementById('guest-overview-metrics');
        if (!container) return;

        const traits = profile?.traits || [];
        const skills = profile?.skills || [];
        const beliefs = profile?.beliefs || [];
        const activeProjects = (projects || []).filter((project) => !['completed', 'archived'].includes(project.status)).length;

        container.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Profile Depth</span>
                <div class="stat-value">${traits.length + beliefs.length + skills.length}</div>
                <span class="badge" style="margin-top: 8px;">${skills.length} skills tracked</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Active Projects</span>
                <div class="stat-value">${activeProjects}</div>
                <span class="badge" style="margin-top: 8px;">${(projects || []).length} total</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Work Experiences</span>
                <div class="stat-value">${workSummary?.total || 0}</div>
                <span class="badge" style="margin-top: 8px;">${workSummary?.completed_count || 0} completed roles</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Library Titles</span>
                <div class="stat-value">${librarySummary?.total_items || 0}</div>
                <span class="badge" style="margin-top: 8px;">${librarySummary?.in_progress_count || 0} reading/watching</span>
            </div>
        `;
    },

    renderProjects(projects) {
        const container = document.getElementById('guest-project-spotlight');
        if (!container) return;

        const activeProjects = projects.filter(p => !['completed', 'archived'].includes(p.status));
        if (!activeProjects.length) {
            CoreUI.setEmptyState(container, 'No active projects available in the demo.');
            return;
        }

        const topProjects = [...activeProjects]
            .sort((left, right) => (right.progress || 0) - (left.progress || 0))
            .slice(0, 5);

        container.innerHTML = topProjects.map((project) => `
            <div class="compact-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span class="item-title">${CoreUI.escapeHtml(project.name)}</span>
                    <span class="item-desc" style="font-weight:bold; color:var(--accent-blue);">${project.progress || 0}%</span>
                </div>
                <div class="progress-track" style="width:100%;">
                    <div class="progress-fill" style="width:${project.progress || 0}%; background: var(--accent-blue);"></div>
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; font-size:0.8rem; color:var(--text-secondary);">
                    <span>${project.completed_task_count || 0}/${project.task_count || 0} tasks</span>
                    <span>${CoreUI.escapeHtml(this.labelize(project.status))}</span>
                </div>
                ${project.description ? `<div class="item-desc" style="width: 100%; margin-top: 4px;">${CoreUI.escapeHtml(project.description)}</div>` : ''}
            </div>
        `).join('');
    },

    renderWork(experiences) {
        const container = document.getElementById('guest-work-spotlight');
        if (!container) return;

        if (!experiences.length) {
            CoreUI.setEmptyState(container, 'No work records are available in the demo yet.');
            return;
        }

        container.innerHTML = experiences.slice(0, 4).map((item) => `
            <div class="compact-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                <div style="display:flex; justify-content:space-between; width:100%; align-items: flex-start;">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(item.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(item.organization)}</div>
                    </div>
                    <span class="badge" style="${item.status === 'active' ? 'background: rgba(57,255,20,0.1); color: var(--accent-green); border-color: var(--accent-green);' : ''}">${CoreUI.escapeHtml(this.labelize(item.status))}</span>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <span class="badge">${CoreUI.escapeHtml(this.labelize(item.experience_type))}</span>
                    ${item.location ? `<span class="badge"><i class="ph ph-map-pin"></i> ${CoreUI.escapeHtml(item.location)}</span>` : ''}
                    ${item.start_date ? `<span class="badge"><i class="ph ph-calendar"></i> ${CoreUI.formatDate(item.start_date)} - ${item.end_date ? CoreUI.formatDate(item.end_date) : 'Present'}</span>` : ''}
                </div>
                ${item.achievements ? `<div class="item-desc" style="margin-top:4px; font-size: 0.85rem;"><i class="ph ph-check-circle" style="color:var(--text-secondary);"></i> ${CoreUI.escapeHtml(item.achievements.split('\\n')[0])}</div>` : ''}
            </div>
        `).join('');
    },

    renderProfile(profile) {
        const container = document.getElementById('guest-profile-spotlight');
        if (!container) return;

        const topTraits = [...(profile.traits || [])]
            .sort((left, right) => (right.score || 0) - (left.score || 0))
            .slice(0, 4);
            
        const topSkills = [...(profile.skills || [])]
            .sort((left, right) => (right.proficiency || 0) - (left.proficiency || 0))
            .slice(0, 6);

        // Chart rendering
        if (topSkills.length > 0) {
            this.initSkillsChart(topSkills);
        } else {
            const chartCanvas = document.getElementById('guestSkillsChart');
            if (chartCanvas && chartCanvas.parentElement) {
                chartCanvas.parentElement.style.display = 'none';
            }
        }

        // Traits and Beliefs
        const sections = [];
        if (topTraits.length) {
            sections.push(`
                <div class="compact-item" style="flex-direction: column; align-items: flex-start; gap: 8px; border:none; padding: 0 0 12px 0;">
                    <div class="item-title" style="color: var(--text-secondary); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em;">Core Traits</div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        ${topTraits.map((trait) => `<span class="badge" style="background: rgba(255,0,255,0.1); color: var(--accent-pink); border-color: rgba(255,0,255,0.2);"><i class="ph ph-sparkle"></i> ${CoreUI.escapeHtml(trait.name)}</span>`).join('')}
                    </div>
                </div>
            `);
        }
        
        const beliefs = (profile.beliefs || []).slice(0, 2);
        if (beliefs.length) {
            sections.push(`
                <div class="compact-item" style="flex-direction: column; align-items: flex-start; gap: 8px; border:none; padding: 0;">
                    <div class="item-title" style="color: var(--text-secondary); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em;">Key Beliefs</div>
                    ${beliefs.map((belief) => `
                        <div style="background: var(--bg-surface); padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); width: 100%;">
                            <div class="item-title" style="margin-bottom: 4px;">${CoreUI.escapeHtml(belief.title)}</div>
                            <div class="item-desc" style="font-size: 0.85rem;">${CoreUI.escapeHtml(belief.text)}</div>
                        </div>
                    `).join('')}
                </div>
            `);
        }

        if (!sections.length && !topSkills.length) {
            CoreUI.setEmptyState(container, 'No profile signals are available in the demo yet.');
            return;
        }

        container.innerHTML = sections.join('');
    },

    initSkillsChart(skills) {
        const ctx = document.getElementById('guestSkillsChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.skillsChartInstance);
        
        if (typeof Chart === 'undefined') return;

        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        
        this.skillsChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: skills.map(s => s.name),
                datasets: [{
                    label: 'Proficiency',
                    data: skills.map(s => s.proficiency),
                    backgroundColor: 'rgba(0, 240, 255, 0.45)',
                    borderColor: '#00f0ff',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: { 
                    legend: { display: false } 
                },
                scales: {
                    x: { beginAtZero: true, max: 100, grid: { color: '#1f1f22' }, ticks: { display: false } },
                    y: { grid: { display: false } }
                }
            }
        });
    },

    renderLibrary(summary, items) {
        const container = document.getElementById('guest-library-spotlight');
        if (!container) return;

        if (!items.length) {
            CoreUI.setEmptyState(container, 'The guest account currently has no demo media items to show.');
            return;
        }

        const latestItems = items.slice(0, 5);
        const breakdown = Object.entries(summary.type_breakdown || {})
            .sort((left, right) => right[1] - left[1])
            .slice(0, 4)
            .map(([type, count]) => `
                <div style="display: flex; flex-direction: column; align-items: center; background: var(--bg-surface); padding: 8px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); flex: 1;">
                    <span class="stat-value" style="font-size: 1.2rem; font-weight: bold; color: var(--text-primary);">${count}</span>
                    <span class="item-desc" style="font-size: 0.75rem; color: var(--text-secondary);">${CoreUI.escapeHtml(this.labelize(type))}</span>
                </div>
            `)
            .join('');

        container.innerHTML = `
            ${breakdown ? `<div style="display: flex; gap: 8px; margin-bottom: 16px;">${breakdown}</div>` : ''}
            <div class="item-title" style="color: var(--text-secondary); text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; margin-bottom: 8px;">Recent Additions</div>
            ${latestItems.map((item) => `
                <div class="compact-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                    <div style="display:flex; justify-content:space-between; width:100%; align-items: flex-start;">
                        <div style="padding-right: 12px;">
                            <div class="item-title">${CoreUI.escapeHtml(item.title)}</div>
                            ${item.creator ? `<div class="item-desc" style="margin-top: 2px;">${CoreUI.escapeHtml(item.creator)}</div>` : ''}
                        </div>
                        <span class="badge">${CoreUI.escapeHtml(this.labelize(item.status))}</span>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <span class="badge"><i class="${this.getMediaIcon(item.media_type)}"></i> ${CoreUI.escapeHtml(this.labelize(item.media_type))}</span>
                        ${item.platform ? `<span class="badge">${CoreUI.escapeHtml(item.platform)}</span>` : ''}
                        ${item.score ? `<span class="badge"><i class="ph-fill ph-star" style="color: var(--accent-amber);"></i> ${item.score}/10</span>` : ''}
                    </div>
                </div>
            `).join('')}
        `;
    },

    getMediaIcon(type) {
        const icons = {
            book: 'ph ph-book',
            manga: 'ph ph-book-open',
            manhwa: 'ph ph-book-open',
            anime: 'ph ph-television',
            tv: 'ph ph-television',
            movie: 'ph ph-film-strip'
        };
        return icons[type] || 'ph ph-bookmark';
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\\b\\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => GuestOverviewUI.init());
