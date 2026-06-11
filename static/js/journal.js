const JournalUI = {
    entries: [],
    generatingFeedbackIds: new Set(),
    filters: {
        q: '',
        mood: '',
        date_from: ''
    },

    init() {
        document.getElementById('journal-search')?.addEventListener('input', (event) => {
            this.filters.q = event.target.value.trim().toLowerCase();
            this.renderEntries();
        });
        document.getElementById('journal-mood-filter')?.addEventListener('change', (event) => {
            this.filters.mood = event.target.value;
            this.renderEntries();
        });
        document.getElementById('journal-date-from')?.addEventListener('change', (event) => {
            this.filters.date_from = event.target.value;
            this.renderEntries();
        });
        document.getElementById('journal-reset-filters')?.addEventListener('click', () => {
            this.filters = { q: '', mood: '', date_from: '' };
            document.getElementById('journal-search').value = '';
            document.getElementById('journal-mood-filter').value = '';
            document.getElementById('journal-date-from').value = '';
            this.renderEntries();
        });
    },

    async loadEntries() {
        try {
            this.entries = await API.get('/api/journal/');
            this.renderEntries();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load journal.');
        }
    },

    getFilteredEntries() {
        return this.entries.filter((entry) => {
            const haystack = `${entry.title || ''} ${entry.tags || ''} ${entry.content}`.toLowerCase();
            if (this.filters.q && !haystack.includes(this.filters.q)) return false;
            if (this.filters.mood && String(entry.mood_score) !== this.filters.mood) return false;
            if (this.filters.date_from && String(entry.entry_date).slice(0, 10) < this.filters.date_from) return false;
            return true;
        });
    },

    renderEntries() {
        const entries = this.getFilteredEntries();
        const list = document.getElementById('journal-list');
        const countEl = document.getElementById('journal-results-count');
        if (!list) return;

        if (countEl) countEl.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
        this.renderSummary(entries);

        list.innerHTML = '';
        if (entries.length === 0) {
            CoreUI.setEmptyState(list, 'No entries match the current filters.');
            return;
        }

        entries.forEach((entry) => {
            const div = document.createElement('div');
            const isGeneratingFeedback = this.generatingFeedbackIds.has(entry.id);
            const hasFeedback = String(entry.ai_feedback || '').trim().length > 0;
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '12px';
            div.style.alignItems = 'flex-start';
            div.innerHTML = `
                <div style="width:100%; display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(entry.title || 'Untitled entry')}</div>
                        <div class="item-desc" style="margin-top:4px;">${CoreUI.escapeHtml(CoreUI.formatDate(entry.entry_date))}</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span class="badge">Mood ${entry.mood_score}/10</span>
                        <button class="btn btn-icon" onclick="JournalUI.generateFeedback(${entry.id})" title="${hasFeedback ? 'Refresh objective AI feedback' : 'Generate objective AI feedback'}" ${isGeneratingFeedback ? 'disabled' : ''}><i class="ph ph-scales"></i></button>
                        <button class="btn btn-icon" onclick="JournalUI.openCreateModal(${entry.id})" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn btn-icon btn-danger" onclick="JournalUI.deleteEntry(${entry.id})" title="Delete"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
                ${entry.tags ? `<div class="item-desc">${CoreUI.escapeHtml(entry.tags)}</div>` : ''}
                <div style="font-family: var(--font-mono); white-space: pre-wrap; font-size: 13px; color: var(--text-primary); line-height: 1.6; width: 100%;">
                    ${CoreUI.escapeHtml(entry.content)}
                </div>
                <div style="width:100%; border-top:1px solid var(--border-color); padding-top:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:8px;">
                        <span class="item-title"><i class="ph ph-scales"></i> Objective AI Feedback</span>
                        ${entry.ai_feedback_generated_at ? `<span class="item-desc">${CoreUI.escapeHtml(CoreUI.formatDate(entry.ai_feedback_generated_at))}</span>` : ''}
                    </div>
                    ${isGeneratingFeedback
                        ? '<div class="item-desc">Generating objective feedback...</div>'
                        : hasFeedback
                            ? `<div style="font-family: var(--font-mono); white-space: pre-wrap; font-size: 12px; color: var(--text-secondary); line-height: 1.6;">${CoreUI.escapeHtml(entry.ai_feedback)}</div>`
                            : '<div class="item-desc">No feedback generated yet.</div>'}
                </div>
            `;
            list.appendChild(div);
        });
    },

    renderSummary(entries) {
        const grid = document.getElementById('journal-summary-grid');
        if (!grid) return;
        const avgMood = entries.length ? (entries.reduce((sum, entry) => sum + (entry.mood_score || 0), 0) / entries.length).toFixed(1) : '0.0';
        const totalWords = entries.reduce((sum, entry) => sum + String(entry.content || '').split(/\s+/).filter(Boolean).length, 0);
        const tagged = entries.filter((entry) => (entry.tags || '').trim()).length;
        grid.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Average Mood</span>
                <span class="stat-value">${avgMood}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Words</span>
                <span class="stat-value">${totalWords}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Tagged</span>
                <span class="stat-value">${tagged}</span>
            </div>
        `;
    },

    openCreateModal(entryId = null) {
        const modal = document.getElementById('journal-modal');
        const title = document.getElementById('journal-modal-title');
        const deleteBtn = document.getElementById('journal-delete-btn');
        document.getElementById('journal-form').reset();
        document.getElementById('journal-id').value = '';
        deleteBtn.style.display = 'none';

        if (entryId) {
            const entry = this.entries.find((item) => item.id === entryId);
            if (!entry) return;
            title.textContent = 'Edit Entry';
            document.getElementById('journal-id').value = entry.id;
            document.getElementById('journal-title').value = entry.title || '';
            document.getElementById('journal-tags').value = entry.tags || '';
            document.getElementById('journal-content').value = entry.content || '';
            document.getElementById('journal-mood').value = entry.mood_score || 5;
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'Record Observation';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        document.getElementById('journal-modal').style.display = 'none';
        document.getElementById('journal-form').reset();
    },

    openQuickAdd() {
        this.openCreateModal();
    },

    async submitEntry(event) {
        event.preventDefault();
        const entryId = document.getElementById('journal-id').value;
        const payload = {
            title: document.getElementById('journal-title').value,
            tags: document.getElementById('journal-tags').value,
            content: document.getElementById('journal-content').value,
            mood_score: document.getElementById('journal-mood').value
        };

        try {
            if (entryId) {
                await API.put(`/api/journal/${entryId}`, payload);
            } else {
                await API.post('/api/journal/', payload);
            }
            this.closeModal();
            await this.loadEntries();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save journal entry.');
        }
    },

    async deleteCurrentEntry() {
        const id = document.getElementById('journal-id').value;
        if (id) {
            await this.deleteEntry(parseInt(id, 10));
            this.closeModal();
        }
    },

    async deleteEntry(id) {
        if (!(await CoreUI.confirm({
            title: 'Delete journal entry?',
            message: 'This entry will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/journal/${id}`);
            await this.loadEntries();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete journal entry.');
        }
    },

    async generateFeedback(id) {
        if (this.generatingFeedbackIds.has(id)) return;
        this.generatingFeedbackIds.add(id);
        this.renderEntries();

        try {
            await API.post(`/api/journal/${id}/feedback`, {});
            await this.loadEntries();
            CoreUI.showError('Objective AI feedback generated.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to generate journal feedback.');
        } finally {
            this.generatingFeedbackIds.delete(id);
            this.renderEntries();
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    JournalUI.init();
    JournalUI.loadEntries();
});
