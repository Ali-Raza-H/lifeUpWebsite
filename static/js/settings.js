const SettingsUI = {
    skills: [],
    traits: [],
    traitSaveTimers: {},

    init() {
        this.bindEvents();
        this.loadSkills();
        this.loadTraits();
    },

    bindEvents() {
        const traitList = document.getElementById('settings-traits-list');
        if (!traitList) return;
        traitList.addEventListener('input', (event) => this.handleTraitInput(event));
        traitList.addEventListener('click', (event) => this.handleTraitClick(event));
    },

    async loadTraits() {
        try {
            const traits = await API.get('/api/profile/traits');
            this.traits = traits;
            this.renderTraits();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load traits.');
        }
    },

    renderTraits() {
        const list = document.getElementById('settings-traits-list');
        if (!list) return;

        if (this.traits.length === 0) {
            CoreUI.setEmptyState(list, 'No traits available.');
            return;
        }

        list.innerHTML = this.traits.map((trait) => `
            <div class="compact-item" data-trait-id="${trait.id}" style="display:grid; grid-template-columns:minmax(180px,0.7fr) minmax(0,1.3fr) auto; gap: var(--space-3); align-items:center;">
                <div>
                    <div class="item-title">${CoreUI.escapeHtml(trait.name)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(this.labelize(trait.category || 'general'))}</div>
                </div>
                <div style="display:grid; grid-template-columns:minmax(140px,1fr) 86px auto; gap: var(--space-2); align-items:center;">
                    <input type="range" class="settings-trait-range" min="0" max="100" value="${trait.score}" style="width:100%; accent-color: var(--accent-blue);">
                    <input type="number" class="form-control settings-trait-number" min="0" max="100" value="${trait.score}" style="min-height:32px; padding:4px 8px;">
                    <button type="button" class="btn btn-sm settings-trait-save">Save</button>
                </div>
                <div class="item-desc settings-trait-state" style="min-width:76px; text-align:right;">Saved</div>
            </div>
        `).join('');
    },

    handleTraitInput(event) {
        const row = event.target.closest('[data-trait-id]');
        if (!row) return;

        const rangeEl = row.querySelector('.settings-trait-range');
        const numberEl = row.querySelector('.settings-trait-number');
        if (!rangeEl || !numberEl) return;

        if (event.target === rangeEl) numberEl.value = rangeEl.value;
        if (event.target === numberEl) {
            const raw = Number(numberEl.value);
            const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
            numberEl.value = clamped;
            rangeEl.value = clamped;
        }

        this.setTraitRowState(row, 'Unsaved');
        this.scheduleTraitSave(row);
    },

    handleTraitClick(event) {
        const saveButton = event.target.closest('.settings-trait-save');
        if (!saveButton) return;
        const row = saveButton.closest('[data-trait-id]');
        if (!row) return;
        this.saveTraitRow(row);
    },

    scheduleTraitSave(row) {
        const traitId = Number(row.dataset.traitId);
        if (!traitId) return;
        if (this.traitSaveTimers[traitId]) clearTimeout(this.traitSaveTimers[traitId]);
        this.traitSaveTimers[traitId] = setTimeout(() => this.saveTraitRow(row), 900);
    },

    async saveTraitRow(row) {
        const traitId = Number(row.dataset.traitId);
        const numberEl = row.querySelector('.settings-trait-number');
        if (!traitId || !numberEl) return;

        const score = Math.max(0, Math.min(100, Math.trunc(Number(numberEl.value) || 0)));
        this.setTraitRowState(row, 'Saving...');
        try {
            const payload = await API.put(`/api/profile/traits/${traitId}`, { score });
            const updated = payload?.trait;
            const idx = this.traits.findIndex((item) => item.id === traitId);
            if (idx >= 0) this.traits[idx] = updated ? updated : { ...this.traits[idx], score };
            this.setTraitRowState(row, 'Saved');
        } catch (error) {
            this.setTraitRowState(row, 'Save failed');
            CoreUI.showError(error.message || 'Failed to update trait.');
        }
    },

    setTraitRowState(row, message) {
        const stateEl = row.querySelector('.settings-trait-state');
        if (stateEl) stateEl.textContent = message;
    },

    async loadSkills() {
        try {
            const skills = await API.get('/api/profile/skills');
            this.skills = skills;
            const grid = document.getElementById('settings-skills-grid');
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
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap: 12px; margin-bottom: var(--space-3);">
                        <div>
                            <div class="item-title" style="font-size: 16px;">${CoreUI.escapeHtml(skill.name)}</div>
                            <div class="item-desc" style="margin-top: 4px; text-transform: capitalize;">${CoreUI.escapeHtml(skill.category)} - ${CoreUI.escapeHtml(skill.experience_level)}</div>
                        </div>
                        <button class="btn btn-icon" onclick="SettingsUI.openSkillModal(${skill.id})" title="Edit Skill"><i class="ph ph-pencil-simple"></i></button>
                    </div>
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
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load skills.');
        }
    },

    openSkillModal(skillId = null) {
        const modal = document.getElementById('settings-skill-modal');
        const title = document.getElementById('settings-skill-modal-title');
        const deleteBtn = document.getElementById('settings-skill-delete-btn');
        const form = document.getElementById('settings-skill-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        document.getElementById('settings-skill-id').value = '';
        document.getElementById('settings-skill-category').value = 'language';
        document.getElementById('settings-skill-level').value = 'intermediate';
        document.getElementById('settings-skill-proficiency').value = 50;

        if (skillId) {
            const skill = this.skills.find((item) => item.id === skillId);
            if (!skill) return;
            title.textContent = 'Edit Skill';
            document.getElementById('settings-skill-id').value = skill.id;
            document.getElementById('settings-skill-name').value = skill.name;
            document.getElementById('settings-skill-category').value = skill.category;
            document.getElementById('settings-skill-proficiency').value = skill.proficiency;
            document.getElementById('settings-skill-level').value = skill.experience_level;
            document.getElementById('settings-skill-notes').value = skill.notes || '';
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Add Skill';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeSkillModal() {
        const modal = document.getElementById('settings-skill-modal');
        if (modal) modal.style.display = 'none';
    },

    async submitSkill(event) {
        event.preventDefault();
        const skillId = document.getElementById('settings-skill-id').value;
        const payload = {
            name: document.getElementById('settings-skill-name').value,
            category: document.getElementById('settings-skill-category').value,
            proficiency: parseInt(document.getElementById('settings-skill-proficiency').value, 10),
            experience_level: document.getElementById('settings-skill-level').value,
            notes: document.getElementById('settings-skill-notes').value
        };

        try {
            if (skillId) {
                await API.put(`/api/profile/skills/${skillId}`, payload);
            } else {
                await API.post('/api/profile/skills', payload);
            }
            this.closeSkillModal();
            await this.loadSkills();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save skill.');
        }
    },

    async deleteCurrentSkill() {
        const skillId = document.getElementById('settings-skill-id').value;
        if (!skillId || !(await CoreUI.confirm({
            title: 'Delete skill?',
            message: 'This skill will be removed permanently.',
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/profile/skills/${skillId}`);
            this.closeSkillModal();
            await this.loadSkills();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete skill.');
        }
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => {
    SettingsUI.init();
});
