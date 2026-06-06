const LibraryUI = {
    items: [],
    summary: {},
    activePanel: 'book',

    typeConfig: {
        book: { label: 'Books', singular: 'Book', icon: 'ph-book-open-text' },
        manga: { label: 'Manga', singular: 'Manga', icon: 'ph-books' },
        manhwa: { label: 'Manhwa', singular: 'Manhwa', icon: 'ph-stack' },
        anime: { label: 'Anime', singular: 'Anime', icon: 'ph-television-simple' },
        tv: { label: 'TV Shows', singular: 'Show', icon: 'ph-monitor-play' },
        movie: { label: 'Movies', singular: 'Movie', icon: 'ph-film-strip' }
    },

    statusConfig: [
        { key: 'want_to_start', label: 'Want Next', empty: 'Nothing queued yet.' },
        { key: 'in_progress', label: 'In Progress', empty: 'Nothing active right now.' },
        { key: 'completed', label: 'Completed', empty: 'Nothing finished yet.' },
        { key: 'paused', label: 'Paused', empty: 'Nothing on hold.' },
        { key: 'dropped', label: 'Dropped', empty: 'Nothing dropped.' }
    ],

    async init() {
        await this.loadAll();
        this.setupModalClosures();
    },

    setupModalClosures() {
        window.addEventListener('click', (event) => {
            if (event.target.classList.contains('modal-overlay')) {
                event.target.style.display = 'none';
            }
        });
    },

    async loadAll() {
        try {
            const [summary, items] = await Promise.all([
                API.get('/api/library/summary'),
                API.get('/api/library/items')
            ]);
            this.summary = summary;
            this.items = items;
            this.render();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load library.');
        }
    },

    render() {
        this.renderSummary();
        Object.keys(this.typeConfig).forEach((type) => {
            this.renderTypePanel(type);
        });
    },

    renderSummary() {
        const container = document.getElementById('library-summary-grid');
        if (!container) return;

        const breakdown = this.summary.type_breakdown || {};
        const topType = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0];
        const topTypeLabel = topType ? this.typeConfig[topType[0]]?.label || topType[0] : 'Nothing yet';
        const averageScore = this.summary.average_score == null ? '--' : `${this.summary.average_score}/10`;

        container.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Total Library</span>
                <div class="life-metric-value">${this.summary.total_items || 0}</div>
                <span class="badge">${topType ? `Largest shelf: ${topTypeLabel}` : 'Start adding titles'}</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">In Progress</span>
                <div class="life-metric-value">${this.summary.in_progress_count || 0}</div>
                <span class="badge">${this.summary.paused_count || 0} paused</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Want Next</span>
                <div class="life-metric-value">${this.summary.want_to_start_count || 0}</div>
                <span class="badge">${this.summary.dropped_count || 0} dropped</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Completed</span>
                <div class="life-metric-value">${this.summary.completed_count || 0}</div>
                <span class="badge">Avg score ${averageScore}</span>
            </div>
        `;
    },

    renderTypePanel(type) {
        const items = this.items.filter((item) => item.media_type === type);
        this.renderTypeStats(type, items);
        this.renderTypeCount(type, items.length);
        this.renderTypeBoard(type, items);
    },

    renderTypeStats(type, items) {
        const container = document.getElementById(`library-stats-${type}`);
        if (!container) return;

        const activeCount = items.filter((item) => item.status === 'in_progress').length;
        const queuedCount = items.filter((item) => item.status === 'want_to_start').length;
        const completedItems = items.filter((item) => item.status === 'completed');
        const averageScore = this.averageScore(completedItems);

        container.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Active</span>
                <div class="life-metric-value">${activeCount}</div>
                <span class="badge">${items.filter((item) => item.status === 'paused').length} paused</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Queued</span>
                <div class="life-metric-value">${queuedCount}</div>
                <span class="badge">${items.length} total tracked</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Finished</span>
                <div class="life-metric-value">${completedItems.length}</div>
                <span class="badge">${averageScore == null ? 'No ratings yet' : `Avg ${averageScore}/10`}</span>
            </div>
        `;
    },

    renderTypeCount(type, count) {
        const container = document.getElementById(`library-count-${type}`);
        if (!container) return;
        container.textContent = `${count} ${count === 1 ? 'title' : 'titles'}`;
    },

    renderTypeBoard(type, items) {
        const container = document.getElementById(`library-board-${type}`);
        if (!container) return;

        container.innerHTML = this.statusConfig.map((status) => {
            const matchingItems = items.filter((item) => item.status === status.key);
            return `
                <div class="library-status-column">
                    <div class="library-status-head">
                        <span class="library-status-title">${status.label}</span>
                        <span class="badge">${matchingItems.length}</span>
                    </div>
                    <div class="library-status-body">
                        ${matchingItems.length ? matchingItems.map((item) => this.renderItemCard(item)).join('') : `<div class="library-empty-state">${status.empty}</div>`}
                    </div>
                </div>
            `;
        }).join('');
    },

    renderItemCard(item) {
        const creator = item.creator ? `<span class="library-pill"><i class="ph ph-user"></i> ${CoreUI.escapeHtml(item.creator)}</span>` : '';
        const platform = item.platform ? `<span class="library-pill"><i class="ph ph-device-mobile-speaker"></i> ${CoreUI.escapeHtml(item.platform)}</span>` : '';
        const score = item.score ? `<span class="library-pill score"><i class="ph ph-star"></i> ${item.score}/10</span>` : '';
        const dates = this.renderDates(item);
        const progress = this.renderProgress(item);

        return `
            <article class="library-entry">
                <div class="library-entry-top">
                    <div>
                        <h3 class="library-entry-title">${CoreUI.escapeHtml(item.title)}</h3>
                        ${dates ? `<div class="item-desc mt-1">${dates}</div>` : ''}
                    </div>
                    <div class="library-entry-actions">
                        <button type="button" class="btn btn-icon" onclick="LibraryUI.editItem(${item.id})" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                        <button type="button" class="btn btn-icon btn-danger" onclick="LibraryUI.deleteItem(${item.id})" title="Delete"><i class="ph ph-trash"></i></button>
                    </div>
                </div>
                ${(creator || platform || score) ? `<div class="library-entry-meta">${creator}${platform}${score}</div>` : ''}
                ${progress}
                ${item.notes ? `<div class="library-entry-notes">${CoreUI.escapeHtml(item.notes)}</div>` : ''}
            </article>
        `;
    },

    renderDates(item) {
        const parts = [];
        if (item.started_on) parts.push(`Started ${CoreUI.formatDate(item.started_on)}`);
        if (item.completed_on) parts.push(`Finished ${CoreUI.formatDate(item.completed_on)}`);
        return parts.join(' &middot; ');
    },

    renderProgress(item) {
        if (item.current_unit == null && item.total_units == null) {
            return '';
        }

        const current = Number(item.current_unit || 0);
        const total = item.total_units == null ? null : Number(item.total_units);
        const percentage = total && total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
        const label = total ? `${current} / ${total}` : `${current} tracked`;

        return `
            <div class="library-progress">
                <div>Progress ${label}</div>
                ${percentage != null ? `
                    <div class="library-progress-track">
                        <div class="library-progress-fill" style="width: ${percentage}%"></div>
                    </div>
                ` : ''}
            </div>
        `;
    },

    switchPanel(panelId) {
        this.activePanel = panelId;
        document.querySelectorAll('.life-nav-item').forEach((element) => {
            element.classList.toggle('active', element.dataset.panel === panelId);
        });
        document.querySelectorAll('.life-content-panel').forEach((element) => {
            element.classList.toggle('active', element.id === `panel-${panelId}`);
        });
    },

    openModal(defaultType) {
        this.resetForm(defaultType || this.activePanel);
        document.getElementById('modal-library').style.display = 'flex';
        this.updateModalTitle();
    },

    closeModal() {
        const modal = document.getElementById('modal-library');
        if (modal) {
            modal.style.display = 'none';
        }
        this.resetForm(this.activePanel);
    },

    openQuickAdd() {
        this.openModal(this.activePanel);
    },

    updateModalTitle(isEdit = false) {
        const mediaType = document.getElementById('library-media-type').value || this.activePanel;
        const config = this.typeConfig[mediaType] || this.typeConfig.book;
        document.getElementById('library-modal-title').textContent = isEdit ? `Edit ${config.singular}` : `Add ${config.singular}`;
    },

    resetForm(defaultType = 'book') {
        document.getElementById('library-form')?.reset();
        document.getElementById('library-item-id').value = '';
        document.getElementById('library-media-type').value = defaultType;
        document.getElementById('library-status').value = 'want_to_start';
        this.updateModalTitle(false);
    },

    editItem(itemId) {
        const item = this.items.find((entry) => entry.id === itemId);
        if (!item) return;

        document.getElementById('library-item-id').value = item.id;
        document.getElementById('library-media-type').value = item.media_type;
        document.getElementById('library-status').value = item.status;
        document.getElementById('library-title').value = item.title || '';
        document.getElementById('library-creator').value = item.creator || '';
        document.getElementById('library-platform').value = item.platform || '';
        document.getElementById('library-current-unit').value = item.current_unit ?? '';
        document.getElementById('library-total-units').value = item.total_units ?? '';
        document.getElementById('library-score').value = item.score ?? '';
        document.getElementById('library-started-on').value = item.started_on || '';
        document.getElementById('library-completed-on').value = item.completed_on || '';
        document.getElementById('library-notes').value = item.notes || '';

        document.getElementById('modal-library').style.display = 'flex';
        this.updateModalTitle(true);
    },

    async saveItem(event) {
        event.preventDefault();
        const itemId = document.getElementById('library-item-id').value;
        const payload = {
            title: document.getElementById('library-title').value,
            media_type: document.getElementById('library-media-type').value,
            status: document.getElementById('library-status').value,
            creator: document.getElementById('library-creator').value,
            platform: document.getElementById('library-platform').value,
            current_unit: this.intOrNull('library-current-unit'),
            total_units: this.intOrNull('library-total-units'),
            score: this.intOrNull('library-score'),
            started_on: document.getElementById('library-started-on').value || null,
            completed_on: document.getElementById('library-completed-on').value || null,
            notes: document.getElementById('library-notes').value
        };

        try {
            if (itemId) {
                await API.put(`/api/library/items/${itemId}`, payload);
            } else {
                await API.post('/api/library/items', payload);
            }
            this.closeModal();
            await this.loadAll();
            this.switchPanel(payload.media_type || this.activePanel);
            CoreUI.showError('Library updated.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save library item.');
        }
    },

    async deleteItem(itemId) {
        const confirmed = await CoreUI.confirm({
            title: 'Delete library item?',
            message: 'This title will be removed permanently.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/library/items/${itemId}`);
            await this.loadAll();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete library item.');
        }
    },

    intOrNull(id) {
        const value = document.getElementById(id)?.value;
        return value === '' || value == null ? null : Math.trunc(Number(value));
    },

    averageScore(items) {
        const scores = items.map((item) => Number(item.score)).filter((value) => Number.isFinite(value));
        if (!scores.length) return null;
        const total = scores.reduce((sum, value) => sum + value, 0);
        return (total / scores.length).toFixed(1);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    LibraryUI.init();
    document.getElementById('library-media-type')?.addEventListener('change', () => LibraryUI.updateModalTitle(Boolean(document.getElementById('library-item-id').value)));
});
