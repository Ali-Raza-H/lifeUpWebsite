const MindsetUI = {
    traits: [],
    beliefs: [],
    skills: [],

    async init() {
        try {
            const [traits, beliefs, skills] = await Promise.all([
                API.get('/api/profile/traits'),
                API.get('/api/profile/beliefs'),
                API.get('/api/profile/skills')
            ]);
            this.traits = traits;
            this.beliefs = beliefs;
            this.skills = skills;
            this.render();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load mindset profile.');
        }
    },

    render() {
        this.renderMetrics();
        this.renderHero();
        this.renderTraits();
        this.renderBeliefs();
        this.renderStrengths();
        this.renderRisks();
        this.renderSkills();
        this.renderRecommendations();
    },

    renderMetrics() {
        const avgSkill = this.skills.length
            ? Math.round(this.skills.reduce((sum, skill) => sum + Number(skill.proficiency || 0), 0) / this.skills.length)
            : 0;
        const metrics = {
            'mindset-metric-traits': this.traits.length,
            'mindset-metric-beliefs': this.beliefs.length,
            'mindset-metric-skills': this.skills.length,
            'mindset-metric-skill-avg': `${avgSkill}%`
        };
        Object.entries(metrics).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = String(value);
        });
    },

    renderHero() {
        const strongestTrait = this.traits[0];
        const strongestSkill = [...this.skills].sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0))[0];
        const title = document.getElementById('mindset-hero-title');
        const summary = document.getElementById('mindset-hero-summary');
        const badges = document.getElementById('mindset-hero-badges');

        if (title) {
            title.textContent = strongestTrait
                ? `${strongestTrait.name} anchored, systems-oriented profile`
                : 'Profile synthesis unavailable';
        }
        if (summary) {
            const principle = this.beliefs[0]?.title || 'No leading principle saved yet';
            const skill = strongestSkill ? `${strongestSkill.name} at ${strongestSkill.proficiency}%` : 'no dominant skill yet';
            summary.textContent = `Primary operating principle: ${principle}. Current strongest capability: ${skill}. This page updates from your live profile records instead of hardcoded notes.`;
        }
        if (badges) {
            const badgeItems = [
                strongestTrait ? `Top trait: ${strongestTrait.name}` : 'Top trait unavailable',
                strongestSkill ? `Top skill: ${strongestSkill.name}` : 'Top skill unavailable',
                `${this.beliefs.length} beliefs tracked`
            ];
            badges.innerHTML = badgeItems.map((item) => `<span class="badge">${CoreUI.escapeHtml(item)}</span>`).join('');
        }
    },

    renderTraits() {
        const list = document.getElementById('mindset-traits-list');
        if (!list) return;

        if (!this.traits.length) {
            CoreUI.setEmptyState(list, 'No traits available.');
            return;
        }

        list.innerHTML = this.traits.map((trait) => `
            <div class="compact-item mindset-trait-row">
                <div>
                    <div class="item-title">${CoreUI.escapeHtml(trait.name)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(this.labelize(trait.category || 'general'))}</div>
                </div>
                <div class="skill-meter">
                    <div class="skill-meter-fill" style="width:${trait.score}%;"></div>
                </div>
                <div class="badge">${trait.score}</div>
            </div>
        `).join('');
    },

    renderBeliefs() {
        const list = document.getElementById('mindset-beliefs-list');
        if (!list) return;

        if (!this.beliefs.length) {
            CoreUI.setEmptyState(list, 'No principles available.');
            return;
        }

        list.innerHTML = this.beliefs.map((belief) => `
            <div class="compact-item">
                <span class="item-title">${CoreUI.escapeHtml(belief.title)}</span>
                <span class="item-desc">${CoreUI.escapeHtml(belief.text)}</span>
            </div>
        `).join('');
    },

    renderStrengths() {
        const list = document.getElementById('mindset-strengths-list');
        if (!list) return;

        const strongest = this.traits.slice(0, 3);
        if (!strongest.length) {
            CoreUI.setEmptyState(list, 'No strengths available.');
            return;
        }

        list.innerHTML = strongest.map((trait) => `
            <div class="compact-item">
                <span class="item-title">${CoreUI.escapeHtml(trait.name)}</span>
                <span class="item-desc">${this.describeStrength(trait)}</span>
            </div>
        `).join('');
    },

    renderRisks() {
        const list = document.getElementById('mindset-risks-list');
        if (!list) return;

        const risks = [...this.traits].sort((left, right) => Number(left.score || 0) - Number(right.score || 0)).slice(0, 3);
        if (!risks.length) {
            CoreUI.setEmptyState(list, 'No constraints available.');
            return;
        }

        list.innerHTML = risks.map((trait) => `
            <div class="compact-item">
                <span class="item-title">${CoreUI.escapeHtml(trait.name)}</span>
                <span class="item-desc">${this.describeRisk(trait)}</span>
            </div>
        `).join('');
    },

    renderSkills() {
        const list = document.getElementById('mindset-skills-list');
        if (!list) return;

        const topSkills = [...this.skills]
            .sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0))
            .slice(0, 5);
        if (!topSkills.length) {
            CoreUI.setEmptyState(list, 'No skill data available.');
            return;
        }

        list.innerHTML = topSkills.map((skill) => `
            <div class="compact-item">
                <div style="display:flex; justify-content:space-between; gap:12px;">
                    <span class="item-title">${CoreUI.escapeHtml(skill.name)}</span>
                    <span class="badge">${skill.proficiency}%</span>
                </div>
                <span class="item-desc">${CoreUI.escapeHtml(this.labelize(skill.category))} - ${CoreUI.escapeHtml(this.labelize(skill.experience_level))}</span>
            </div>
        `).join('');
    },

    renderRecommendations() {
        const container = document.getElementById('mindset-recommendations');
        if (!container) return;

        const strongestTrait = this.traits[0];
        const weakestTrait = [...this.traits].sort((left, right) => Number(left.score || 0) - Number(right.score || 0))[0];
        const belief = this.beliefs[0];
        const strongestSkill = [...this.skills].sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0))[0];
        const recommendations = [
            {
                title: 'Exploit Dominant Strengths',
                text: strongestTrait
                    ? `Route difficult work through ${strongestTrait.name.toLowerCase()} on purpose. Build systems that turn this into repeatable leverage rather than one-off bursts.`
                    : 'Add profile traits to generate strength-based recommendations.'
            },
            {
                title: 'Protect The Weakest Link',
                text: weakestTrait
                    ? `${weakestTrait.name} is currently the lowest signal in the profile. Set one recurring habit or workflow guardrail that directly supports it.`
                    : 'Add more traits to surface the current constraint.'
            },
            {
                title: 'Translate Identity Into Output',
                text: belief && strongestSkill
                    ? `Use "${belief.title}" as the decision rule, then express it through ${strongestSkill.name}. That keeps principles tied to visible work instead of abstraction.`
                    : 'Store both beliefs and skills to get principle-to-output recommendations.'
            }
        ];

        container.innerHTML = recommendations.map((item) => `
            <div class="compact-item mindset-panel-note">
                <span class="item-title">${CoreUI.escapeHtml(item.title)}</span>
                <span class="item-desc">${CoreUI.escapeHtml(item.text)}</span>
            </div>
        `).join('');
    },

    describeStrength(trait) {
        if ((trait.category || '') === 'cognitive') {
            return `${trait.score}% score. Likely useful for analysis, pattern recognition, and long-horizon planning.`;
        }
        return `${trait.score}% score. Strong enough to shape execution style and day-to-day behavior.`;
    },

    describeRisk(trait) {
        if ((trait.category || '') === 'behavioral') {
            return `${trait.score}% score. This is a likely execution bottleneck unless supported by routine or environment design.`;
        }
        return `${trait.score}% score. Lower cognitive preference can become a blind spot when work complexity increases.`;
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => {
    MindsetUI.init();
});
