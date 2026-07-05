const CVUI = {
    profile: {},
    sections: [],
    previewText: '',

    async init() {
        await this.loadAll();
    },

    async loadAll() {
        try {
            const [profile, sections, preview] = await Promise.all([
                API.get('/api/cv/profile'),
                API.get('/api/cv/sections'),
                API.get('/api/cv/preview')
            ]);
            this.profile = profile;
            this.sections = sections;
            this.previewText = preview.text || '';
            this.renderAll();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load CV manager.');
        }
    },

    renderAll() {
        this.renderProfile();
        this.renderSectionOptions();
        this.renderSections();
        this.renderPreview();
    },

    renderProfile() {
        this.setValue('cv-name', this.profile.name);
        this.setValue('cv-headline', this.profile.headline);
        this.setValue('cv-email', this.profile.email);
        this.setValue('cv-phone', this.profile.phone);
        this.setValue('cv-location', this.profile.location);
        this.setValue('cv-links', this.profile.links);
        this.setValue('cv-summary', this.profile.summary);
    },

    renderSectionOptions() {
        const select = document.getElementById('cv-item-section');
        if (!select) return;
        const current = select.value;
        select.innerHTML = this.sections.map((section) => `
            <option value="${section.id}">${CoreUI.escapeHtml(section.title)}</option>
        `).join('');
        if (this.sections.some((section) => String(section.id) === String(current))) {
            select.value = current;
        }
    },

    renderSections() {
        const list = document.getElementById('cv-section-list');
        if (!list) return;
        if (!this.sections.length) {
            CoreUI.setEmptyState(list, 'No CV sections yet.');
            return;
        }

        list.innerHTML = this.sections.map((section) => `
            <div class="compact-item cv-section-item">
                <div class="cv-section-head">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(section.title)} ${section.enabled ? '' : '<span class="badge">Disabled</span>'}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(this.labelize(section.section_type))} - ${section.items.length} item(s)</div>
                    </div>
                    <div class="cv-actions">
                        <button type="button" class="btn btn-icon btn-sm" onclick="CVUI.editSection(${section.id})" title="Edit section"><i class="ph ph-pencil-simple"></i></button>
                        <button type="button" class="btn btn-icon btn-danger btn-sm" onclick="CVUI.deleteSection(${section.id})" title="Delete section"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
                <div class="cv-item-list">
                    ${section.items.length ? section.items.map((item) => this.renderItem(section, item)).join('') : '<span class="item-desc">No items in this section.</span>'}
                </div>
            </div>
        `).join('');
    },

    renderItem(section, item) {
        return `
            <div class="cv-item-row">
                <div>
                    <div class="item-title">${CoreUI.escapeHtml(item.title)} ${item.enabled ? '' : '<span class="badge">Disabled</span>'}</div>
                    <div class="item-desc">${CoreUI.escapeHtml([item.organization, item.location].filter(Boolean).join(' - ') || section.title)}</div>
                </div>
                <div class="cv-actions">
                    <button type="button" class="btn btn-icon btn-sm" onclick="CVUI.editItem(${item.id})" title="Edit item"><i class="ph ph-pencil-simple"></i></button>
                    <button type="button" class="btn btn-icon btn-danger btn-sm" onclick="CVUI.deleteItem(${item.id})" title="Delete item"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `;
    },

    renderPreview() {
        const preview = document.getElementById('cv-preview');
        if (preview) preview.textContent = this.previewText || 'Add profile details and enabled sections to build a CV preview.';
    },

    async saveProfile(event) {
        event.preventDefault();
        const payload = {
            name: this.getValue('cv-name'),
            headline: this.getValue('cv-headline'),
            email: this.getValue('cv-email'),
            phone: this.getValue('cv-phone'),
            location: this.getValue('cv-location'),
            links: this.getValue('cv-links'),
            summary: this.getValue('cv-summary')
        };
        try {
            await API.put('/api/cv/profile', payload);
            await this.loadAll();
            CoreUI.showError('CV profile saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save CV profile.');
        }
    },

    async importPdf(event) {
        event.preventDefault();
        const fileInput = document.getElementById('cv-import-file');
        const status = document.getElementById('cv-import-status');
        const file = fileInput?.files?.[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);
        if (status) status.textContent = 'Extracting CV data...';

        try {
            await API.postForm('/api/cv/import/pdf', formData);
            if (fileInput) fileInput.value = '';
            await this.loadAll();
            if (status) status.textContent = 'CV imported. Review the structured sections below before downloading a new version.';
            CoreUI.showError('CV imported from PDF.', true);
        } catch (error) {
            if (status) status.textContent = 'Import failed.';
            CoreUI.showError(error.message || 'Failed to import CV PDF.');
        }
    },

    async saveSection(event) {
        event.preventDefault();
        const sectionId = this.getValue('cv-section-id');
        const payload = {
            title: this.getValue('cv-section-title'),
            section_type: this.getValue('cv-section-type'),
            enabled: document.getElementById('cv-section-enabled').checked
        };
        try {
            if (sectionId) {
                await API.put(`/api/cv/sections/${sectionId}`, payload);
            } else {
                await API.post('/api/cv/sections', payload);
            }
            this.resetSectionForm();
            await this.loadAll();
            CoreUI.showError('CV section saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save CV section.');
        }
    },

    async saveItem(event) {
        event.preventDefault();
        const itemId = this.getValue('cv-item-id');
        const payload = {
            section_id: Number(this.getValue('cv-item-section')),
            title: this.getValue('cv-item-title'),
            organization: this.getValue('cv-item-organization'),
            location: this.getValue('cv-item-location'),
            start_date: this.getValue('cv-item-start') || null,
            end_date: this.getValue('cv-item-end') || null,
            description: this.getValue('cv-item-description'),
            bullets: this.getValue('cv-item-bullets'),
            skills: this.getValue('cv-item-skills'),
            enabled: document.getElementById('cv-item-enabled').checked
        };
        try {
            if (itemId) {
                await API.put(`/api/cv/items/${itemId}`, payload);
            } else {
                await API.post('/api/cv/items', payload);
            }
            this.resetItemForm();
            await this.loadAll();
            CoreUI.showError('CV item saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save CV item.');
        }
    },

    editSection(sectionId) {
        const section = this.sections.find((item) => item.id === sectionId);
        if (!section) return;
        this.setValue('cv-section-id', section.id);
        this.setValue('cv-section-title', section.title);
        this.setValue('cv-section-type', section.section_type);
        document.getElementById('cv-section-enabled').checked = Boolean(section.enabled);
    },

    editItem(itemId) {
        const item = this.sections.flatMap((section) => section.items).find((entry) => entry.id === itemId);
        if (!item) return;
        this.setValue('cv-item-id', item.id);
        this.setValue('cv-item-section', item.section_id);
        this.setValue('cv-item-title', item.title);
        this.setValue('cv-item-organization', item.organization);
        this.setValue('cv-item-location', item.location);
        this.setValue('cv-item-start', item.start_date);
        this.setValue('cv-item-end', item.end_date);
        this.setValue('cv-item-description', item.description);
        this.setValue('cv-item-bullets', item.bullets);
        this.setValue('cv-item-skills', item.skills);
        document.getElementById('cv-item-enabled').checked = Boolean(item.enabled);
    },

    async deleteSection(sectionId) {
        const confirmed = await CoreUI.confirm({
            title: 'Delete CV section',
            message: 'Delete this section and all of its items?',
            confirmText: 'Delete'
        });
        if (!confirmed) return;
        try {
            await API.delete(`/api/cv/sections/${sectionId}`);
            await this.loadAll();
            CoreUI.showError('CV section deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete CV section.');
        }
    },

    async deleteItem(itemId) {
        const confirmed = await CoreUI.confirm({
            title: 'Delete CV item',
            message: 'Remove this item from your CV?',
            confirmText: 'Delete'
        });
        if (!confirmed) return;
        try {
            await API.delete(`/api/cv/items/${itemId}`);
            await this.loadAll();
            CoreUI.showError('CV item deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete CV item.');
        }
    },

    resetSectionForm() {
        document.getElementById('cv-section-form')?.reset();
        this.setValue('cv-section-id', '');
        document.getElementById('cv-section-enabled').checked = true;
    },

    resetItemForm() {
        document.getElementById('cv-item-form')?.reset();
        this.setValue('cv-item-id', '');
        document.getElementById('cv-item-enabled').checked = true;
    },

    async copyPreview() {
        try {
            await CoreUI.copyText(this.previewText);
            CoreUI.showError('CV copied.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to copy CV.');
        }
    },

    getValue(id) {
        return document.getElementById(id)?.value || '';
    },

    setValue(id, value) {
        const field = document.getElementById(id);
        if (field) field.value = value || '';
    },

    labelize(value) {
        return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CVUI.init();
});
