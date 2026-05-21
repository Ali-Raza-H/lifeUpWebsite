const SettingsUI = {
    skills: [],

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
                            <div class="item-desc" style="margin-top: 4px; text-transform: capitalize;">${CoreUI.escapeHtml(skill.category)} • ${CoreUI.escapeHtml(skill.experience_level)}</div>
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
        if (!skillId || !confirm('Delete this skill?')) return;

        try {
            await API.delete(`/api/profile/skills/${skillId}`);
            this.closeSkillModal();
            await this.loadSkills();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete skill.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    SettingsUI.loadSkills();
});
