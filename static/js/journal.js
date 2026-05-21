const JournalUI = {
    async loadEntries() {
        try {
            const entries = await API.get('/api/journal/');
            const list = document.getElementById('journal-list');
            if (!list) return;

            list.innerHTML = '';
            if (entries.length === 0) {
                CoreUI.setEmptyState(list, 'Memory banks empty.');
                return;
            }

            entries.forEach((entry) => {
                const div = document.createElement('div');
                div.className = 'compact-item';
                div.style.flexDirection = 'column';
                div.style.gap = '12px';
                div.style.alignItems = 'flex-start';
                div.innerHTML = `
                    <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                        <span class="badge"><i class="ph ph-clock"></i> ${CoreUI.escapeHtml(CoreUI.formatDate(entry.entry_date))}</span>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <span class="item-desc">State: ${entry.mood_score}/10</span>
                            <button class="btn btn-icon" onclick="JournalUI.deleteEntry(${entry.id})" title="Purge"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>
                    <div style="font-family: var(--font-mono); white-space: pre-wrap; font-size: 13px; color: var(--text-primary); line-height: 1.6; width: 100%;">
                        ${CoreUI.escapeHtml(entry.content)}
                    </div>
                `;
                list.appendChild(div);
            });
        } catch (error) {
            console.error('Failed to load journal', error);
            CoreUI.showError(error.message || 'Failed to load journal.');
        }
    },

    openCreateModal() {
        document.getElementById('journal-modal').style.display = 'flex';
    },

    closeModal() {
        document.getElementById('journal-modal').style.display = 'none';
        document.getElementById('journal-form').reset();
    },

    async submitEntry(event) {
        event.preventDefault();
        const content = document.getElementById('journal-content').value;
        const mood_score = document.getElementById('journal-mood').value;

        try {
            await API.post('/api/journal/', { content, mood_score });
            this.closeModal();
            await this.loadEntries();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create journal entry.');
        }
    },

    async deleteEntry(id) {
        if (!confirm('Confirm memory purge?')) return;
        try {
            await API.delete(`/api/journal/${id}`);
            await this.loadEntries();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete journal entry.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    JournalUI.loadEntries();
});
