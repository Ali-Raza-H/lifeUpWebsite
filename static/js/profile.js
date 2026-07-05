const ProfileUI = {
    traitChart: null,
    skillChart: null,
    traits: [],
    beliefs: [],
    skills: [],
    admiredPeople: [],

    async loadData() {
        try {
            const profile = await API.get('/api/profile/all');

            this.traits = profile.traits || [];
            this.beliefs = profile.beliefs || [];
            this.skills = profile.skills || [];
            this.admiredPeople = profile.admired_people || [];
            this.renderAll();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load profile data.');
        }
    },

    init() {
        this.bindEvents();
        this.loadData();
    },

    bindEvents() {
        document.getElementById('profile-skill-search')?.addEventListener('input', () => this.renderSkillsSection());
        document.getElementById('profile-skill-filter-category')?.addEventListener('change', () => this.renderSkillsSection());
        document.getElementById('profile-skill-chart-scope')?.addEventListener('change', () => this.renderSkillChart());
    },

    renderAll() {
        this.renderSummary();
        this.renderBeliefs(this.beliefs);
        this.renderAdmiredPeople();
        this.renderTraitsPreview(this.traits);
        this.renderTraitChart(this.traits);
        this.renderSkillChartScope();
        this.renderSkillsSection();
    },

    renderSummary() {
        const traitsCountEl = document.getElementById('profile-summary-traits');
        const beliefsCountEl = document.getElementById('profile-summary-beliefs');
        const skillsCountEl = document.getElementById('profile-summary-skills');
        const skillsAvgEl = document.getElementById('profile-summary-skill-avg');
        const strongestTraitEl = document.getElementById('profile-strongest-trait');

        const avgSkill = this.skills.length
            ? Math.round(this.skills.reduce((sum, skill) => sum + Number(skill.proficiency || 0), 0) / this.skills.length)
            : 0;
        const strongestTrait = [...this.traits].sort((left, right) => (right.score || 0) - (left.score || 0))[0];

        if (traitsCountEl) traitsCountEl.textContent = String(this.traits.length);
        if (beliefsCountEl) beliefsCountEl.textContent = String(this.beliefs.length);
        if (skillsCountEl) skillsCountEl.textContent = String(this.skills.length);
        if (skillsAvgEl) skillsAvgEl.textContent = `${avgSkill}%`;
        if (strongestTraitEl) {
            strongestTraitEl.textContent = strongestTrait
                ? `${strongestTrait.name} ${strongestTrait.score}`
                : 'No data';
        }
    },

    renderBeliefs(beliefs) {
        const list = document.getElementById('beliefs-list');
        if (!list) return;

        if (beliefs.length === 0) {
            CoreUI.setEmptyState(list, 'No principles saved yet.');
            return;
        }

        list.innerHTML = beliefs.map((belief) => `
            <div class="compact-item profile-belief-item">
                <span class="item-title">${CoreUI.escapeHtml(belief.title)}</span>
                <span class="item-desc">${CoreUI.escapeHtml(belief.text)}</span>
            </div>
        `).join('');
    },

    renderAdmiredPeople() {
        const list = document.getElementById('admired-people-list');
        if (!list) return;

        if (!this.admiredPeople.length) {
            CoreUI.setEmptyState(list, 'No admired people saved yet.');
            return;
        }

        list.innerHTML = this.admiredPeople.map((person) => `
            <div class="compact-item profile-admired-item">
                <div class="profile-skill-head">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(person.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(person.role_or_context || 'No context')}</div>
                    </div>
                    ${person.traits_to_model ? `<span class="badge">${CoreUI.escapeHtml(person.traits_to_model)}</span>` : ''}
                </div>
                <div class="item-desc">${CoreUI.escapeHtml(person.why_admired)}</div>
                ${person.reference_url ? `<a class="item-desc" href="${CoreUI.escapeHtml(person.reference_url)}" target="_blank" rel="noopener noreferrer"><i class="ph ph-arrow-square-out"></i> Reference</a>` : ''}
            </div>
        `).join('');
    },

    renderTraitsPreview(traits) {
        const list = document.getElementById('traits-editor-list');
        if (!list) return;

        if (traits.length === 0) {
            CoreUI.setEmptyState(list, 'No traits available.');
            return;
        }

        list.innerHTML = traits.map((trait) => `
            <div class="compact-item profile-trait-row">
                <div class="profile-trait-meta">
                    <div class="item-title">${CoreUI.escapeHtml(trait.name)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(this.labelize(trait.category || 'general'))}</div>
                </div>
                <div class="profile-trait-preview">
                    <div class="skill-meter">
                        <div class="skill-meter-fill" style="width: ${trait.score}%;"></div>
                    </div>
                </div>
                <div class="badge">${trait.score}</div>
            </div>
        `).join('');
    },

    getFilteredSkills() {
        const query = (document.getElementById('profile-skill-search')?.value || '').trim().toLowerCase();
        const category = document.getElementById('profile-skill-filter-category')?.value || '';

        return this.skills.filter((skill) => {
            if (category && skill.category !== category) return false;
            if (!query) return true;
            const haystack = `${skill.name} ${skill.category} ${skill.experience_level} ${skill.notes || ''}`.toLowerCase();
            return haystack.includes(query);
        });
    },

    renderSkillsSection() {
        const filtered = this.getFilteredSkills();
        this.renderSkills(filtered);
        this.renderSkillChart();
    },

    renderSkills(skills) {
        const grid = document.getElementById('skills-grid');
        if (!grid) return;

        if (skills.length === 0) {
            CoreUI.setEmptyState(grid, 'No matching skills found.');
            return;
        }

        grid.innerHTML = skills.map((skill) => `
            <div class="compact-item profile-skill-tile">
                <div class="profile-skill-head">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(skill.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(this.labelize(skill.category))} - ${CoreUI.escapeHtml(this.labelize(skill.experience_level))}</div>
                    </div>
                </div>
                <div class="skill-meter">
                    <div class="skill-meter-fill" style="width: ${skill.proficiency}%;"></div>
                </div>
                <div class="profile-skill-meta">
                    <span class="item-desc">Proficiency</span>
                    <span class="badge">${skill.proficiency}%</span>
                </div>
                <div class="item-desc">${CoreUI.escapeHtml(skill.notes || 'No notes')}</div>
            </div>
        `).join('');
    },

    renderSkillChartScope() {
        const select = document.getElementById('profile-skill-chart-scope');
        if (!select) return;
        const previous = select.value;
        const categories = [...new Set(this.skills.map((skill) => skill.category))];
        select.innerHTML = '<option value="all">Chart: All skills</option>';
        categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = `Chart: ${this.labelize(category)}`;
            select.appendChild(option);
        });
        if ([...select.options].some((option) => option.value === previous)) {
            select.value = previous;
        }
    },

    renderSkillChart() {
        const chartCanvas = document.getElementById('profileSkillChart');
        if (!chartCanvas) return;

        const scope = document.getElementById('profile-skill-chart-scope')?.value || 'all';
        const filteredSkills = this.getFilteredSkills();

        let items = filteredSkills;
        if (scope !== 'all') {
            items = filteredSkills.filter((skill) => skill.category === scope);
        }
        items = [...items].sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0)).slice(0, 8);

        CoreUI.destroyChart(this.skillChart);
        if (!items.length) {
            const ctx = chartCanvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
            return;
        }

        const chartTextColor = this.getChartTextColor();
        const chartFontFamily = this.getChartFontFamily();
        Chart.defaults.color = chartTextColor;
        Chart.defaults.font.family = chartFontFamily;
        this.skillChart = new Chart(chartCanvas, {
            type: 'radar',
            data: {
                labels: items.map((skill) => skill.name),
                datasets: [{
                    label: scope === 'all' ? 'Top skills' : this.labelize(scope),
                    data: items.map((skill) => Number(skill.proficiency || 0)),
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
                        pointLabels: {
                            color: chartTextColor,
                            font: { family: chartFontFamily, size: 11, weight: 600 }
                        },
                        min: 0,
                        max: 100,
                        ticks: { display: false }
                    }
                }
            }
        });
    },

    renderTraitChart(traits) {
        const ctx = document.getElementById('profileChart');
        if (!ctx) return;

        CoreUI.destroyChart(this.traitChart);
        if (!traits.length) return;

        const labels = traits.map((trait) => trait.name);
        const data = traits.map((trait) => trait.score);

        const chartTextColor = this.getChartTextColor();
        const chartFontFamily = this.getChartFontFamily();
        Chart.defaults.color = chartTextColor;
        Chart.defaults.font.family = chartFontFamily;

        this.traitChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels,
                datasets: [{
                    label: 'Trait profile',
                    data,
                    backgroundColor: 'rgba(0, 240, 255, 0.2)',
                    borderColor: '#00f0ff',
                    pointBackgroundColor: '#00f0ff',
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
                        pointLabels: {
                            color: chartTextColor,
                            font: { family: chartFontFamily, size: 12, weight: 600 }
                        },
                        min: 0,
                        max: 100,
                        ticks: { display: false }
                    }
                }
            }
        });
    },

    getChartFontFamily() {
        return getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || '"Syne", sans-serif';
    },

    getChartTextColor() {
        return 'rgba(240, 240, 240, 0.78)';
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    },

    
};

document.addEventListener('DOMContentLoaded', () => {
    ProfileUI.init();
});
