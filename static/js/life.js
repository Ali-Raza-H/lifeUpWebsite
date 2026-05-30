const LifeUI = {
    health: [],
    finance: [],
    contacts: [],
    reviews: [],
    attachments: [],
    summary: {},
    activePanel: 'health',

    async init() {
        this.setDefaultDates();
        await this.loadAll();
        this.setupModalClosures();
    },

    setupModalClosures() {
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                e.target.style.display = 'none';
            }
        });
    },

    setDefaultDates() {
        const today = new Date().toISOString().slice(0, 10);
        ['health-date', 'finance-date', 'review-start', 'contact-last', 'contact-next'].forEach((id) => {
            const field = document.getElementById(id);
            if (field && !field.value) field.value = today;
        });
    },

    async loadAll() {
        try {
            const [summary, health, finance, contacts, reviews, attachments] = await Promise.all([
                API.get('/api/life/summary'),
                API.get('/api/life/health'),
                API.get('/api/life/finance'),
                API.get('/api/life/contacts'),
                API.get('/api/life/reviews'),
                API.get('/api/life/attachments')
            ]);
            this.summary = summary;
            this.health = health;
            this.finance = finance;
            this.contacts = contacts;
            this.reviews = reviews;
            this.attachments = attachments;
            this.render();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load life tracker.');
        }
    },

    render() {
        this.renderSummary();
        this.renderHealth();
        this.renderFinance();
        this.renderContacts();
        this.renderReviews();
        this.renderAttachments();
    },

    renderSummary() {
        const container = document.getElementById('life-summary-grid');
        if (!container) return;

        const latest = this.summary.latest_health || {};
        const finance = this.summary.finance || {};
        const spending = Number(finance.spending || 0);
        const income = Number(finance.income || 0);
        const savings = Number(finance.savings || 0);
        const balance = income + savings - spending;

        container.innerHTML = `
            <div class="compact-item metric-card">
                <span class="item-desc">Sleep & Energy</span>
                <div class="life-metric-value">${latest.sleep_hours ?? '--'}h / ${latest.energy_score ?? '--'}</div>
                <span class="badge">${latest.exercise_minutes ?? 0}m exercise</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Tracked Balance</span>
                <div class="life-metric-value">${this.formatMoney(balance)}</div>
                <span class="badge">${finance.entry_count || 0} entries</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Follow-ups Due</span>
                <div class="life-metric-value">${this.summary.contacts_due || 0}</div>
                <span class="badge">${this.contacts.length} total contacts</span>
            </div>
            <div class="compact-item metric-card">
                <span class="item-desc">Last Review</span>
                <div class="life-metric-value">${this.reviews[0]?.score ?? '--'}/10</div>
                <span class="badge">${this.reviews[0] ? CoreUI.formatDate(this.reviews[0].period_start) : 'None'}</span>
            </div>
        `;
    },

    renderHealth() {
        const container = document.getElementById('life-health-list');
        if (!container) return;
        if (!this.health.length) {
            CoreUI.setEmptyState(container, 'No health logs yet.');
            return;
        }

        container.innerHTML = this.health.slice(0, 15).map((log) => `
            <div class="life-row compact-item">
                <div class="item-main">
                    <div class="item-title">${CoreUI.formatDate(log.log_date)}</div>
                    <div class="item-desc">
                        Sleep <strong>${log.sleep_hours ?? '--'}h</strong> • 
                        Energy <strong>${log.energy_score ?? '--'}/10</strong> • 
                        Exercise <strong>${log.exercise_minutes ?? 0}m</strong> • 
                        Weight <strong>${log.weight_kg ?? '--'}kg</strong>
                    </div>
                    ${log.symptoms ? `<div class="item-desc mt-1"><i class="ph ph-warning-circle"></i> ${CoreUI.escapeHtml(log.symptoms)}</div>` : ''}
                    ${log.notes ? `<div class="item-desc text-muted">${CoreUI.escapeHtml(log.notes)}</div>` : ''}
                </div>
                <button type="button" class="btn btn-icon btn-danger" onclick="LifeUI.deleteItem('health', ${log.id})" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
        `).join('');
    },

    renderFinance() {
        const container = document.getElementById('life-finance-list');
        if (!container) return;
        if (!this.finance.length) {
            CoreUI.setEmptyState(container, 'No finance entries yet.');
            return;
        }

        container.innerHTML = this.finance.slice(0, 20).map((entry) => `
            <div class="life-row compact-item">
                <div class="item-main">
                    <div class="item-title d-flex justify-content-between">
                        <span>${CoreUI.escapeHtml(entry.category || entry.type)}</span>
                        <span class="finance-${entry.type}">${entry.type === 'expense' ? '-' : '+'}${this.formatMoney(entry.amount)}</span>
                    </div>
                    <div class="item-desc">
                        ${CoreUI.formatDate(entry.entry_date)} • <span class="badge btn-sm">${entry.type}</span> ${entry.is_recurring ? '<i class="ph ph-repeat"></i>' : ''}
                    </div>
                    ${entry.description ? `<div class="item-desc text-muted">${CoreUI.escapeHtml(entry.description)}</div>` : ''}
                </div>
                <button type="button" class="btn btn-icon btn-danger" onclick="LifeUI.deleteItem('finance', ${entry.id})" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
        `).join('');
    },

    renderContacts() {
        const container = document.getElementById('life-contact-list');
        if (!container) return;
        if (!this.contacts.length) {
            CoreUI.setEmptyState(container, 'No contacts yet.');
            return;
        }

        container.innerHTML = this.contacts.map((contact) => `
            <div class="life-row compact-item">
                <div class="item-main">
                    <div class="item-title">${CoreUI.escapeHtml(contact.name)} <span class="badge">${contact.priority}</span></div>
                    <div class="item-desc">
                        ${CoreUI.escapeHtml(contact.relation || 'No relation')} • 
                        Last: ${CoreUI.formatDate(contact.last_contacted) || 'Never'} • 
                        <strong>Next: ${CoreUI.formatDate(contact.next_follow_up) || 'Not set'}</strong>
                    </div>
                    ${contact.notes ? `<div class="item-desc text-muted">${CoreUI.escapeHtml(contact.notes)}</div>` : ''}
                </div>
                <div class="life-row-actions">
                    <button type="button" class="btn btn-icon" onclick="LifeUI.editContact(${contact.id})" title="Edit"><i class="ph ph-pencil-simple"></i></button>
                    <button type="button" class="btn btn-icon btn-danger" onclick="LifeUI.deleteItem('contacts', ${contact.id})" title="Delete"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `).join('');
    },

    renderReviews() {
        const container = document.getElementById('life-review-list');
        if (!container) return;
        if (!this.reviews.length) {
            CoreUI.setEmptyState(container, 'No reviews yet.');
            return;
        }

        container.innerHTML = this.reviews.map((review) => `
            <div class="life-row compact-item">
                <div class="item-main">
                    <div class="item-title">${CoreUI.escapeHtml(review.period_type)} review - ${CoreUI.formatDate(review.period_start)}</div>
                    <div class="item-desc">Score <strong>${review.score ?? '--'}/10</strong></div>
                    ${review.wins ? `<div class="item-desc"><strong>Wins:</strong> ${CoreUI.escapeHtml(review.wins)}</div>` : ''}
                    ${review.next_focus ? `<div class="item-desc"><strong>Focus:</strong> ${CoreUI.escapeHtml(review.next_focus)}</div>` : ''}
                </div>
                <button type="button" class="btn btn-icon btn-danger" onclick="LifeUI.deleteItem('reviews', ${review.id})" title="Delete"><i class="ph ph-trash"></i></button>
            </div>
        `).join('');
    },

    renderAttachments() {
        const container = document.getElementById('life-attachment-list');
        if (!container) return;
        if (!this.attachments.length) {
            CoreUI.setEmptyState(container, 'No resources saved yet.');
            return;
        }

        container.innerHTML = this.attachments.map((item) => `
            <div class="compact-item life-resource card">
                <div class="item-main">
                    <div class="life-resource-head">
                        <span class="badge">${CoreUI.escapeHtml(item.entity_type)}</span>
                        ${item.entity_id ? `<span class="badge">#${item.entity_id}</span>` : ''}
                    </div>
                    <a class="item-title life-resource-link" href="${CoreUI.escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
                        <i class="ph ph-arrow-square-out"></i> ${CoreUI.escapeHtml(item.title)}
                    </a>
                    ${item.notes ? `<div class="item-desc">${CoreUI.escapeHtml(item.notes)}</div>` : ''}
                </div>
                <div class="mt-3 d-flex justify-content-end">
                    <button type="button" class="btn btn-icon btn-danger btn-sm" onclick="LifeUI.deleteItem('attachments', ${item.id})" title="Delete"><i class="ph ph-trash"></i></button>
                </div>
            </div>
        `).join('');
    },

    // UI Logic
    switchPanel(panelId) {
        this.activePanel = panelId;
        
        // Update nav
        document.querySelectorAll('.life-nav-item').forEach(el => {
            el.classList.toggle('active', el.dataset.panel === panelId);
        });

        // Update panels
        document.querySelectorAll('.life-content-panel').forEach(el => {
            el.classList.toggle('active', el.id === `panel-${panelId}`);
        });
    },

    openModal(panelId) {
        const modal = document.getElementById(`modal-${panelId}`);
        if (modal) {
            modal.style.display = 'flex';
            this.setDefaultDates();
        }
    },

    closeModal(panelId) {
        const modal = document.getElementById(`modal-${panelId}`);
        if (modal) {
            modal.style.display = 'none';
        }
    },

    openQuickAdd() {
        // Just open the active panel's modal for now, or health by default
        this.openModal(this.activePanel || 'health');
    },

    // Form Submissions
    async saveHealth(event) {
        event.preventDefault();
        const payload = {
            log_date: document.getElementById('health-date').value,
            sleep_hours: this.valueOrNull('health-sleep'),
            weight_kg: this.valueOrNull('health-weight'),
            exercise_minutes: this.intOrNull('health-exercise'),
            energy_score: this.intOrNull('health-energy'),
            symptoms: document.getElementById('health-symptoms').value,
            notes: document.getElementById('health-notes').value
        };
        await this.postForm('/api/life/health', payload, 'Health log saved.', 'life-health-form', 'health');
    },

    async saveFinance(event) {
        event.preventDefault();
        const payload = {
            entry_date: document.getElementById('finance-date').value,
            type: document.getElementById('finance-type').value,
            category: document.getElementById('finance-category').value,
            amount: this.valueOrNull('finance-amount'),
            description: document.getElementById('finance-description').value,
            is_recurring: document.getElementById('finance-recurring').checked
        };
        await this.postForm('/api/life/finance', payload, 'Finance entry saved.', 'life-finance-form', 'finance');
    },

    async saveContact(event) {
        event.preventDefault();
        const contactId = document.getElementById('contact-id').value;
        const payload = {
            name: document.getElementById('contact-name').value,
            relation: document.getElementById('contact-relation').value,
            priority: document.getElementById('contact-priority').value,
            last_contacted: document.getElementById('contact-last').value || null,
            next_follow_up: document.getElementById('contact-next').value || null,
            notes: document.getElementById('contact-notes').value
        };
        try {
            if (contactId) {
                await API.put(`/api/life/contacts/${contactId}`, payload);
            } else {
                await API.post('/api/life/contacts', payload);
            }
            this.closeModal('contacts');
            this.resetContactForm();
            await this.loadAll();
            CoreUI.showError('Contact saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save contact.');
        }
    },

    async saveReview(event) {
        event.preventDefault();
        const payload = {
            period_type: document.getElementById('review-type').value,
            period_start: document.getElementById('review-start').value,
            score: this.intOrNull('review-score'),
            wins: document.getElementById('review-wins').value,
            challenges: document.getElementById('review-challenges').value,
            next_focus: document.getElementById('review-focus').value
        };
        await this.postForm('/api/life/reviews', payload, 'Review saved.', 'life-review-form', 'reviews');
    },

    async saveAttachment(event) {
        event.preventDefault();
        const payload = {
            entity_type: document.getElementById('attachment-type').value,
            entity_id: this.intOrNull('attachment-entity-id'),
            title: document.getElementById('attachment-title').value,
            url: document.getElementById('attachment-url').value,
            notes: document.getElementById('attachment-notes').value
        };
        await this.postForm('/api/life/attachments', payload, 'Resource saved.', 'life-attachment-form', 'attachments');
    },

    async postForm(endpoint, payload, message, formId, modalId) {
        try {
            await API.post(endpoint, payload);
            this.closeModal(modalId);
            document.getElementById(formId)?.reset();
            this.setDefaultDates();
            await this.loadAll();
            CoreUI.showError(message, true);
        } catch (error) {
            CoreUI.showError(error.message || message.replace('saved', 'failed'));
        }
    },

    editContact(contactId) {
        const contact = this.contacts.find((item) => item.id === contactId);
        if (!contact) return;
        document.getElementById('contact-id').value = contact.id;
        document.getElementById('contact-name').value = contact.name || '';
        document.getElementById('contact-relation').value = contact.relation || '';
        document.getElementById('contact-priority').value = contact.priority || 'normal';
        document.getElementById('contact-last').value = contact.last_contacted || '';
        document.getElementById('contact-next').value = contact.next_follow_up || '';
        document.getElementById('contact-notes').value = contact.notes || '';
        document.getElementById('contact-modal-title').textContent = 'Edit Contact';
        this.openModal('contacts');
    },

    resetContactForm() {
        document.getElementById('life-contact-form')?.reset();
        document.getElementById('contact-id').value = '';
        document.getElementById('contact-priority').value = 'normal';
        document.getElementById('contact-modal-title').textContent = 'Relationship Contact';
    },

    async deleteItem(kind, id) {
        const labels = {
            health: 'health log',
            finance: 'finance entry',
            contacts: 'contact',
            reviews: 'review',
            attachments: 'resource'
        };
        if (!(await CoreUI.confirm({
            title: `Delete ${labels[kind]}?`,
            message: `This ${labels[kind]} will be removed permanently.`,
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/life/${kind}/${id}`);
            await this.loadAll();
        } catch (error) {
            CoreUI.showError(error.message || `Failed to delete ${labels[kind]}.`);
        }
    },

    valueOrNull(id) {
        const value = document.getElementById(id)?.value;
        return value === '' || value == null ? null : Number(value);
    },

    intOrNull(id) {
        const value = this.valueOrNull(id);
        return value == null ? null : Math.trunc(value);
    },

    formatMoney(value) {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: 'GBP',
            maximumFractionDigits: 0
        }).format(Number(value || 0));
    }
};

document.addEventListener('DOMContentLoaded', () => {
    LifeUI.init();
});
