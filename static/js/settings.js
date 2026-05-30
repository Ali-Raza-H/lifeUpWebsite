const SettingsUI = {
    skills: [],
    traits: [],
    beliefs: [],
    system: null,
    importedBackup: null,
    importedBackupName: '',
    traitSaveTimers: {},

    init() {
        this.bindEvents();
        this.loadAll();
    },

    bindEvents() {
        document.getElementById('settings-traits-list')?.addEventListener('input', (event) => this.handleTraitInput(event));
        document.getElementById('settings-traits-list')?.addEventListener('click', (event) => this.handleTraitListClick(event));
        document.getElementById('settings-beliefs-list')?.addEventListener('click', (event) => this.handleBeliefListClick(event));
        document.getElementById('settings-skill-search')?.addEventListener('input', () => this.renderSkills());
        document.getElementById('settings-skill-filter-category')?.addEventListener('change', () => this.renderSkills());
        document.getElementById('settings-skill-sort')?.addEventListener('change', () => this.renderSkills());
        document.getElementById('settings-import-file')?.addEventListener('change', (event) => this.handleImportFile(event));

        document.querySelectorAll('.modal-overlay').forEach((modal) => {
            modal.addEventListener('click', (event) => {
                if (event.target !== modal) return;
                modal.style.display = 'none';
            });
        });
    },

    async loadAll() {
        await Promise.all([
            this.loadSystemSummary(),
            this.loadTraits(),
            this.loadBeliefs(),
            this.loadSkills()
        ]);
    },

    async loadSystemSummary() {
        try {
            this.system = await API.get('/api/settings/system');
            this.renderSystemSummary();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load system information.');
        }
    },

    renderSystemSummary() {
        const system = this.system;
        if (!system) return;

        const metrics = {
            'settings-metric-total': system.total_records,
            'settings-metric-traits': system.profile_summary?.traits ?? 0,
            'settings-metric-beliefs': system.profile_summary?.beliefs ?? 0,
            'settings-metric-skills': system.profile_summary?.skills ?? 0
        };
        Object.entries(metrics).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = String(value);
        });

        const info = document.getElementById('settings-system-info');
        if (info) {
            const database = system.database || {};
            info.innerHTML = `
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-git-commit"></i> Version</span>
                    <span class="item-desc">${CoreUI.escapeHtml(system.version || 'Unknown')}</span>
                </div>
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-activity"></i> Status</span>
                    <span class="item-desc">${CoreUI.escapeHtml(this.labelize(system.status || 'online'))}</span>
                </div>
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-database"></i> Database</span>
                    <span class="item-desc">${CoreUI.escapeHtml(database.name || 'Unknown')}</span>
                </div>
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-download-simple"></i> Size</span>
                    <span class="item-desc">${CoreUI.escapeHtml(this.formatBytes(database.size_bytes || 0))}</span>
                </div>
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-clock"></i> Modified</span>
                    <span class="item-desc">${CoreUI.escapeHtml(this.formatDateTime(database.modified_at))}</span>
                </div>
                <div class="compact-item">
                    <span class="item-title"><i class="ph ph-paperclip"></i> Orphan Attachments</span>
                    <span class="item-desc">${system.orphan_attachment_count || 0}</span>
                </div>
            `;
        }

        const distribution = document.getElementById('settings-record-distribution');
        if (distribution) {
            const recordEntries = Object.entries(system.record_counts || {}).sort((left, right) => right[1] - left[1]);
            distribution.innerHTML = recordEntries.map(([name, count]) => `
                <div class="compact-item">
                    <span class="item-title">${CoreUI.escapeHtml(this.labelize(name))}</span>
                    <span class="badge">${count}</span>
                </div>
            `).join('');
        }
    },

    async loadTraits() {
        try {
            this.traits = await API.get('/api/profile/traits');
            this.renderTraits();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load traits.');
        }
    },

    renderTraits() {
        const list = document.getElementById('settings-traits-list');
        if (!list) return;

        if (!this.traits.length) {
            CoreUI.setEmptyState(list, 'No traits available.');
            return;
        }

        list.innerHTML = this.traits.map((trait, index) => `
            <div class="compact-item settings-entity-row" data-trait-id="${trait.id}">
                <div>
                    <div class="item-title">${CoreUI.escapeHtml(trait.name)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(this.labelize(trait.category || 'general'))}</div>
                </div>
                <div class="settings-row-controls">
                    <input type="range" class="settings-trait-range" min="0" max="100" value="${trait.score}" style="width:100%; accent-color: var(--accent-blue);">
                    <input type="number" class="form-control settings-trait-number" min="0" max="100" value="${trait.score}">
                    <button type="button" class="btn btn-sm settings-trait-save">Save</button>
                </div>
                <div class="settings-row-actions">
                    <span class="item-desc settings-state">Saved</span>
                    <button type="button" class="btn btn-icon" data-action="move-up" ${index === 0 ? 'disabled' : ''}><i class="ph ph-arrow-up"></i></button>
                    <button type="button" class="btn btn-icon" data-action="move-down" ${index === this.traits.length - 1 ? 'disabled' : ''}><i class="ph ph-arrow-down"></i></button>
                    <button type="button" class="btn btn-icon" data-action="edit"><i class="ph ph-pencil-simple"></i></button>
                </div>
            </div>
        `).join('');
    },

    handleTraitInput(event) {
        const row = event.target.closest('[data-trait-id]');
        if (!row) return;

        const range = row.querySelector('.settings-trait-range');
        const number = row.querySelector('.settings-trait-number');
        if (!range || !number) return;

        if (event.target === range) number.value = range.value;
        if (event.target === number) {
            const clamped = Math.max(0, Math.min(100, Number(number.value) || 0));
            number.value = clamped;
            range.value = clamped;
        }

        this.setTraitState(row, 'Unsaved');
        this.scheduleTraitSave(row);
    },

    handleTraitListClick(event) {
        const row = event.target.closest('[data-trait-id]');
        if (!row) return;

        if (event.target.closest('.settings-trait-save')) {
            this.saveTraitRow(row);
            return;
        }

        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;

        const action = actionButton.dataset.action;
        const traitId = Number(row.dataset.traitId);
        if (action === 'edit') this.openTraitModal(traitId);
        if (action === 'move-up') this.moveEntity('trait', traitId, -1);
        if (action === 'move-down') this.moveEntity('trait', traitId, 1);
    },

    scheduleTraitSave(row) {
        const traitId = Number(row.dataset.traitId);
        if (!traitId) return;
        if (this.traitSaveTimers[traitId]) clearTimeout(this.traitSaveTimers[traitId]);
        this.traitSaveTimers[traitId] = setTimeout(() => this.saveTraitRow(row), 900);
    },

    async saveTraitRow(row) {
        const traitId = Number(row.dataset.traitId);
        const number = row.querySelector('.settings-trait-number');
        if (!traitId || !number) return;

        const score = Math.max(0, Math.min(100, Math.trunc(Number(number.value) || 0)));
        this.setTraitState(row, 'Saving...');
        try {
            await API.put(`/api/profile/traits/${traitId}`, { score });
            const target = this.traits.find((trait) => trait.id === traitId);
            if (target) target.score = score;
            this.setTraitState(row, 'Saved');
            this.loadSystemSummary();
        } catch (error) {
            this.setTraitState(row, 'Failed');
            CoreUI.showError(error.message || 'Failed to update trait.');
        }
    },

    setTraitState(row, message) {
        const state = row.querySelector('.settings-state');
        if (state) state.textContent = message;
    },

    openTraitModal(traitId = null) {
        const form = document.getElementById('settings-trait-form');
        const modal = document.getElementById('settings-trait-modal');
        const title = document.getElementById('settings-trait-modal-title');
        const deleteBtn = document.getElementById('settings-trait-delete-btn');
        if (!form || !modal || !title || !deleteBtn) return;

        form.reset();
        document.getElementById('settings-trait-id').value = '';
        document.getElementById('settings-trait-score').value = 50;
        document.getElementById('settings-trait-category').value = 'general';

        if (traitId) {
            const trait = this.traits.find((item) => item.id === traitId);
            if (!trait) return;
            title.textContent = 'Edit Trait';
            document.getElementById('settings-trait-id').value = String(trait.id);
            document.getElementById('settings-trait-name').value = trait.name;
            document.getElementById('settings-trait-category').value = trait.category || '';
            document.getElementById('settings-trait-score').value = trait.score;
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Add Trait';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeTraitModal() {
        const modal = document.getElementById('settings-trait-modal');
        if (modal) modal.style.display = 'none';
    },

    async submitTrait(event) {
        event.preventDefault();
        const traitId = document.getElementById('settings-trait-id').value;
        const payload = {
            name: document.getElementById('settings-trait-name').value,
            category: document.getElementById('settings-trait-category').value,
            score: parseInt(document.getElementById('settings-trait-score').value, 10)
        };

        try {
            if (traitId) {
                await API.put(`/api/profile/traits/${traitId}`, payload);
            } else {
                await API.post('/api/profile/traits', payload);
            }
            this.closeTraitModal();
            await Promise.all([this.loadTraits(), this.loadSystemSummary()]);
            CoreUI.showError('Trait saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save trait.');
        }
    },

    async deleteCurrentTrait() {
        const traitId = document.getElementById('settings-trait-id').value;
        if (!traitId) return;
        const confirmed = await CoreUI.confirm({
            title: 'Delete trait?',
            message: 'This removes the trait permanently.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/profile/traits/${traitId}`);
            this.closeTraitModal();
            await Promise.all([this.loadTraits(), this.loadSystemSummary()]);
            CoreUI.showError('Trait deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete trait.');
        }
    },

    async loadBeliefs() {
        try {
            this.beliefs = await API.get('/api/profile/beliefs');
            this.renderBeliefs();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load beliefs.');
        }
    },

    renderBeliefs() {
        const list = document.getElementById('settings-beliefs-list');
        if (!list) return;

        if (!this.beliefs.length) {
            CoreUI.setEmptyState(list, 'No beliefs available.');
            return;
        }

        list.innerHTML = this.beliefs.map((belief, index) => `
            <div class="compact-item settings-entity-row" data-belief-id="${belief.id}">
                <div>
                    <div class="item-title">${CoreUI.escapeHtml(belief.title)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(belief.text)}</div>
                </div>
                <div class="item-desc">${belief.text.length} chars</div>
                <div class="settings-row-actions">
                    <button type="button" class="btn btn-icon" data-action="move-up" ${index === 0 ? 'disabled' : ''}><i class="ph ph-arrow-up"></i></button>
                    <button type="button" class="btn btn-icon" data-action="move-down" ${index === this.beliefs.length - 1 ? 'disabled' : ''}><i class="ph ph-arrow-down"></i></button>
                    <button type="button" class="btn btn-icon" data-action="edit"><i class="ph ph-pencil-simple"></i></button>
                </div>
            </div>
        `).join('');
    },

    handleBeliefListClick(event) {
        const row = event.target.closest('[data-belief-id]');
        if (!row) return;
        const beliefId = Number(row.dataset.beliefId);
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;

        const action = actionButton.dataset.action;
        if (action === 'edit') this.openBeliefModal(beliefId);
        if (action === 'move-up') this.moveEntity('belief', beliefId, -1);
        if (action === 'move-down') this.moveEntity('belief', beliefId, 1);
    },

    openBeliefModal(beliefId = null) {
        const form = document.getElementById('settings-belief-form');
        const modal = document.getElementById('settings-belief-modal');
        const title = document.getElementById('settings-belief-modal-title');
        const deleteBtn = document.getElementById('settings-belief-delete-btn');
        if (!form || !modal || !title || !deleteBtn) return;

        form.reset();
        document.getElementById('settings-belief-id').value = '';

        if (beliefId) {
            const belief = this.beliefs.find((item) => item.id === beliefId);
            if (!belief) return;
            title.textContent = 'Edit Belief';
            document.getElementById('settings-belief-id').value = String(belief.id);
            document.getElementById('settings-belief-title').value = belief.title;
            document.getElementById('settings-belief-text').value = belief.text;
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Add Belief';
            deleteBtn.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    closeBeliefModal() {
        const modal = document.getElementById('settings-belief-modal');
        if (modal) modal.style.display = 'none';
    },

    async submitBelief(event) {
        event.preventDefault();
        const beliefId = document.getElementById('settings-belief-id').value;
        const payload = {
            title: document.getElementById('settings-belief-title').value,
            text: document.getElementById('settings-belief-text').value
        };

        try {
            if (beliefId) {
                await API.put(`/api/profile/beliefs/${beliefId}`, payload);
            } else {
                await API.post('/api/profile/beliefs', payload);
            }
            this.closeBeliefModal();
            await Promise.all([this.loadBeliefs(), this.loadSystemSummary()]);
            CoreUI.showError('Belief saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save belief.');
        }
    },

    async deleteCurrentBelief() {
        const beliefId = document.getElementById('settings-belief-id').value;
        if (!beliefId) return;
        const confirmed = await CoreUI.confirm({
            title: 'Delete belief?',
            message: 'This removes the belief permanently.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/profile/beliefs/${beliefId}`);
            this.closeBeliefModal();
            await Promise.all([this.loadBeliefs(), this.loadSystemSummary()]);
            CoreUI.showError('Belief deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete belief.');
        }
    },

    async loadSkills() {
        try {
            this.skills = await API.get('/api/profile/skills');
            this.renderSkills();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load skills.');
        }
    },

    renderSkills() {
        const grid = document.getElementById('settings-skills-grid');
        if (!grid) return;

        const visibleSkills = this.getVisibleSkills();
        if (!visibleSkills.length) {
            CoreUI.setEmptyState(grid, 'No matching skills found.');
            return;
        }

        const searchQuery = (document.getElementById('settings-skill-search')?.value || '').trim();
        const category = document.getElementById('settings-skill-filter-category')?.value || '';
        const sort = document.getElementById('settings-skill-sort')?.value || 'manual';
        const allowReorder = sort === 'manual' && !searchQuery && !category;

        grid.innerHTML = visibleSkills.map((skill, index) => `
            <div class="card settings-skill-card">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom: var(--space-3);">
                    <div>
                        <div class="item-title" style="font-size: 16px;">${CoreUI.escapeHtml(skill.name)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(this.labelize(skill.category))} - ${CoreUI.escapeHtml(this.labelize(skill.experience_level))}</div>
                    </div>
                    <div class="settings-row-actions">
                        ${allowReorder ? `<button type="button" class="btn btn-icon" onclick="SettingsUI.moveEntity('skill', ${skill.id}, -1)" ${index === 0 ? 'disabled' : ''}><i class="ph ph-arrow-up"></i></button>` : ''}
                        ${allowReorder ? `<button type="button" class="btn btn-icon" onclick="SettingsUI.moveEntity('skill', ${skill.id}, 1)" ${index === visibleSkills.length - 1 ? 'disabled' : ''}><i class="ph ph-arrow-down"></i></button>` : ''}
                        <button type="button" class="btn btn-icon" onclick="SettingsUI.openSkillModal(${skill.id})"><i class="ph ph-pencil-simple"></i></button>
                    </div>
                </div>
                <div class="skill-meter">
                    <div class="skill-meter-fill" style="width:${skill.proficiency}%;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top: 8px;">
                    <span class="item-desc">Proficiency</span>
                    <span class="badge">${skill.proficiency}%</span>
                </div>
                <div class="item-desc" style="margin-top: var(--space-3); min-height: 36px;">${CoreUI.escapeHtml(skill.notes || 'No notes')}</div>
            </div>
        `).join('');
    },

    getVisibleSkills() {
        const query = (document.getElementById('settings-skill-search')?.value || '').trim().toLowerCase();
        const category = document.getElementById('settings-skill-filter-category')?.value || '';
        const sort = document.getElementById('settings-skill-sort')?.value || 'manual';

        let items = this.skills.filter((skill) => {
            if (category && skill.category !== category) return false;
            if (!query) return true;
            const haystack = `${skill.name} ${skill.category} ${skill.experience_level} ${skill.notes || ''}`.toLowerCase();
            return haystack.includes(query);
        });

        if (sort === 'name') {
            items = [...items].sort((left, right) => left.name.localeCompare(right.name));
        } else if (sort === 'category') {
            items = [...items].sort((left, right) => `${left.category}${left.name}`.localeCompare(`${right.category}${right.name}`));
        } else if (sort === 'proficiency_desc') {
            items = [...items].sort((left, right) => Number(right.proficiency || 0) - Number(left.proficiency || 0));
        } else if (sort === 'proficiency_asc') {
            items = [...items].sort((left, right) => Number(left.proficiency || 0) - Number(right.proficiency || 0));
        }

        return items;
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
            await Promise.all([this.loadSkills(), this.loadSystemSummary()]);
            CoreUI.showError('Skill saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save skill.');
        }
    },

    async deleteCurrentSkill() {
        const skillId = document.getElementById('settings-skill-id').value;
        if (!skillId) return;
        const confirmed = await CoreUI.confirm({
            title: 'Delete skill?',
            message: 'This removes the skill permanently.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/profile/skills/${skillId}`);
            this.closeSkillModal();
            await Promise.all([this.loadSkills(), this.loadSystemSummary()]);
            CoreUI.showError('Skill deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete skill.');
        }
    },

    async moveEntity(type, entityId, direction) {
        const map = {
            trait: { key: 'traits', endpoint: '/api/profile/traits/reorder', reload: () => this.loadTraits() },
            belief: { key: 'beliefs', endpoint: '/api/profile/beliefs/reorder', reload: () => this.loadBeliefs() },
            skill: { key: 'skills', endpoint: '/api/profile/skills/reorder', reload: () => this.loadSkills() }
        };
        const config = map[type];
        if (!config) return;

        const items = [...this[config.key]];
        const index = items.findIndex((item) => item.id === entityId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return;

        [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
        try {
            await API.post(config.endpoint, { ids: items.map((item) => item.id) });
            this[config.key] = items;
            await Promise.all([config.reload(), this.loadSystemSummary()]);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to reorder items.');
        }
    },

    async handleImportFile(event) {
        const file = event.target.files?.[0];
        if (!file) {
            this.clearImportSelection();
            return;
        }

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            this.importedBackup = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
            this.importedBackupName = file.name;
            this.renderImportPreview();
        } catch (error) {
            this.clearImportSelection();
            CoreUI.showError('Selected file is not valid JSON.');
        }
    },

    renderImportPreview() {
        const preview = document.getElementById('settings-import-preview');
        const button = document.getElementById('settings-import-btn');
        if (!preview || !button) return;

        if (!this.importedBackup) {
            preview.innerHTML = '<span class="item-desc">No backup selected.</span>';
            button.disabled = true;
            return;
        }

        const keys = [
            'tasks', 'habits', 'habit_logs', 'projects', 'project_milestones', 'project_notes',
            'project_habits', 'goals', 'goal_links', 'goal_milestones', 'journal_entries', 'notes',
            'traits', 'beliefs', 'skills', 'calendar_events', 'health_logs', 'finance_entries',
            'contacts', 'life_reviews', 'attachments'
        ];
        const counts = keys
            .filter((key) => Array.isArray(this.importedBackup[key]))
            .map((key) => ({
                key,
                count: this.importedBackup[key].length
            }))
            .sort((left, right) => right.count - left.count);
        const total = counts.reduce((sum, item) => sum + item.count, 0);

        preview.innerHTML = `
            <div class="item-title">${CoreUI.escapeHtml(this.importedBackupName)}</div>
            <div class="item-desc">Detected ${total} records across ${counts.length} tables.</div>
            <div class="compact-list" style="margin-top: var(--space-2);">
                ${counts.slice(0, 6).map((item) => `
                    <div class="compact-item">
                        <span class="item-title">${CoreUI.escapeHtml(this.labelize(item.key))}</span>
                        <span class="badge">${item.count}</span>
                    </div>
                `).join('')}
            </div>
        `;
        button.disabled = false;
    },

    clearImportSelection() {
        this.importedBackup = null;
        this.importedBackupName = '';
        const fileInput = document.getElementById('settings-import-file');
        if (fileInput) fileInput.value = '';
        this.renderImportPreview();
    },

    async importBackup() {
        if (!this.importedBackup) return;
        const confirmed = await CoreUI.confirm({
            title: 'Restore backup?',
            message: 'This replaces the current database contents with the selected JSON backup.',
            confirmText: 'Restore'
        });
        if (!confirmed) return;

        try {
            await API.post('/api/settings/import/json', { data: this.importedBackup });
            this.clearImportSelection();
            await this.loadAll();
            CoreUI.showError('Backup restored successfully.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to restore backup.');
        }
    },

    async resetProfileDefaults() {
        const confirmed = await CoreUI.confirm({
            title: 'Reset profile defaults?',
            message: 'Current traits, beliefs, and skills will be replaced with the default seeded set.',
            confirmText: 'Reset'
        });
        if (!confirmed) return;

        try {
            await API.post('/api/settings/maintenance/profile/reset', {});
            await this.loadAll();
            CoreUI.showError('Profile defaults restored.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to reset profile.');
        }
    },

    async pruneAttachments() {
        try {
            const response = await API.post('/api/settings/maintenance/attachments/prune', {});
            await this.loadSystemSummary();
            CoreUI.showError(response.message || 'Attachment cleanup completed.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to prune attachments.');
        }
    },

    async vacuumDatabase() {
        try {
            const response = await API.post('/api/settings/maintenance/database/vacuum', {});
            await this.loadSystemSummary();
            CoreUI.showError(response.message || 'Database vacuum completed.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to vacuum database.');
        }
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    },

    formatDateTime(value) {
        if (!value) return 'Unknown';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString();
    },

    formatBytes(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    SettingsUI.init();
});
