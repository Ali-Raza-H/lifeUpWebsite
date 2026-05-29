const ProfileUI = {
    chart: null,
    skillCharts: [],

    async loadData() {
        try {
            const [traits, beliefs, skills] = await Promise.all([
                API.get('/api/profile/traits'),
                API.get('/api/profile/beliefs'),
                API.get('/api/profile/skills')
            ]);

            this.renderBeliefs(beliefs);
            this.renderTraitsList(traits);
            this.renderSkills(skills);
            this.renderSkillCharts(skills);
            this.renderChart(traits);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load profile data.');
        }
    },

    renderBeliefs(beliefs) {
        const list = document.getElementById('beliefs-list');
        if (!list) return;

        list.innerHTML = '';
        beliefs.forEach((belief) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start';
            div.style.gap = '6px';
            div.innerHTML = `
                <span class="item-title" style="font-family: var(--font-mono); font-size: 13px;">${CoreUI.escapeHtml(belief.title)}</span>
                <span class="item-desc">${CoreUI.escapeHtml(belief.text)}</span>
            `;
            list.appendChild(div);
        });
    },

    renderTraitsList(traits) {
        const list = document.getElementById('traits-list');
        if (!list) return;

        list.innerHTML = '';
        traits.forEach((trait) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.innerHTML = `
                <span class="item-title">${CoreUI.escapeHtml(trait.name)}</span>
                <span class="badge" style="background: transparent;">Score: ${trait.score} | ${CoreUI.escapeHtml(trait.category || 'general')}</span>
            `;
            list.appendChild(div);
        });
    },

    renderSkills(skills) {
        const grid = document.getElementById('skills-grid');
        if (!grid) return;

        grid.innerHTML = '';
        if (skills.length === 0) {
            CoreUI.setEmptyState(grid, 'No technical skills added yet.', 12);
            return;
        }

        skills.forEach((skill) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.gridColumn = 'span 4';
            card.innerHTML = `
                <div class="item-title" style="font-size: 16px;">${CoreUI.escapeHtml(skill.name)}</div>
                <div class="item-desc" style="margin-top: 4px; text-transform: capitalize;">${CoreUI.escapeHtml(skill.category)} • ${CoreUI.escapeHtml(skill.experience_level)}</div>
                <div class="skill-meter">
                    <div class="skill-meter-fill" style="width: ${skill.proficiency}%;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top: 6px;">
                    <span class="item-desc">Proficiency</span>
                    <span class="badge" style="background: transparent;">${skill.proficiency}%</span>
                </div>
                <div class="item-desc" style="margin-top: var(--space-3); min-height: 36px;">${CoreUI.escapeHtml(skill.notes || 'No notes')}</div>
            `;
            grid.appendChild(card);
        });
    },

    renderSkillCharts(skills) {
        const grid = document.getElementById('skill-radar-grid');
        if (!grid) return;

        this.skillCharts.forEach((chart) => CoreUI.destroyChart(chart));
        this.skillCharts = [];
        grid.innerHTML = '';

        if (skills.length === 0) {
            CoreUI.setEmptyState(grid, 'No skill charts available.', 12);
            return;
        }

        const groups = skills.reduce((acc, skill) => {
            if (!acc[skill.category]) acc[skill.category] = [];
            acc[skill.category].push(skill);
            return acc;
        }, {});

        Object.entries(groups).forEach(([category, items], index) => {
            const card = document.createElement('div');
            card.className = 'card';
            card.style.gridColumn = 'span 4';
            card.innerHTML = `
                <div class="card-header" style="margin-bottom: var(--space-3);">
                    <span class="card-title" style="text-transform: capitalize;">${CoreUI.escapeHtml(category)}</span>
                </div>
                <div class="chart-container" style="height: 260px; display:flex; justify-content:center;">
                    <canvas id="skill-chart-${index}"></canvas>
                </div>
            `;
            grid.appendChild(card);

            const ctx = card.querySelector('canvas');
            if (!ctx) return;

            Chart.defaults.color = '#a1a1aa';
            Chart.defaults.font.family = '"JetBrains Mono", monospace';

            const chart = new Chart(ctx, {
                type: 'radar',
                data: {
                    labels: items.map((skill) => skill.name),
                    datasets: [{
                        label: category,
                        data: items.map((skill) => skill.proficiency),
                        backgroundColor: 'rgba(237, 237, 237, 0.08)',
                        borderColor: '#ededed',
                        pointBackgroundColor: '#ededed',
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
            this.skillCharts.push(chart);
        });
    },

    renderChart(traits) {
        const ctx = document.getElementById('profileChart');
        if (!ctx) return;

        CoreUI.destroyChart(this.chart);

        const labels = traits.map((trait) => trait.name);
        const data = traits.map((trait) => trait.score);

        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';

        this.chart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels,
                datasets: [{
                    label: 'Psychometric Profile',
                    data,
                    backgroundColor: 'rgba(237, 237, 237, 0.1)',
                    borderColor: '#ededed',
                    pointBackgroundColor: '#ededed',
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
                        pointLabels: { color: '#a1a1aa', font: { size: 11 } },
                        min: 0,
                        max: 100,
                        ticks: { display: false }
                    }
                }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    ProfileUI.loadData();
});
