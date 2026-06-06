const CoreUI = {
    sidebarStorageKey: 'lifeos.sidebar.collapsed',
    notificationsLoaded: false,
    commandSearchTimer: null,
    commandResults: [],
    commandSelectedIndex: -1,

    escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },

    formatDate(dateString) {
        if (!dateString) return 'No date';
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return 'Invalid date';
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    },

    getPriorityLabel(priority) {
        const labels = {
            1: '<i class="ph ph-warning-circle" style="color:var(--accent-red)"></i> Highest',
            2: '<i class="ph ph-arrow-up" style="color:var(--accent-amber)"></i> High',
            3: '<i class="ph ph-minus" style="color:var(--text-muted)"></i> Normal',
            4: '<i class="ph ph-arrow-down" style="color:var(--text-muted)"></i> Low'
        };
        return labels[priority] || 'Normal';
    },

    getStatusBadge(status) {
        return `<span class="badge badge-${status.replace('_', '-')}">${status.replace('_', ' ')}</span>`;
    },

    setEmptyState(element, message, span = null) {
        if (!element) return;
        const spanStyle = span ? ` style="grid-column: span ${span};"` : '';
        element.innerHTML = `<div class="compact-item"${spanStyle}><span class="item-desc">${this.escapeHtml(message)}</span></div>`;
    },

    showError(message, isSuccess = false) {
        const region = document.getElementById('app-alert-region');
        if (!region) {
            alert(message);
            return;
        }

        const alertEl = document.createElement('div');
        alertEl.className = isSuccess ? 'app-alert app-alert-success' : 'app-alert';
        alertEl.textContent = message;
        region.innerHTML = '';
        region.appendChild(alertEl);
        window.setTimeout(() => {
            if (region.contains(alertEl)) {
                alertEl.remove();
            }
        }, 4000);
    },

    async copyText(text) {
        const value = String(text ?? '');
        if (!value) {
            throw new Error('Nothing to copy.');
        }

        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch (error) {
                console.warn('Clipboard API copy failed, falling back.', error);
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        let copied = false;
        try {
            copied = document.execCommand('copy');
        } finally {
            textarea.remove();
        }

        if (!copied) {
            throw new Error('Copy command failed.');
        }
        return true;
    },

    confirm({ title = 'Confirm action', message = 'Are you sure?', confirmText = 'Confirm', cancelText = 'Cancel', danger = true } = {}) {
        const modal = document.getElementById('app-confirm-modal');
        const titleEl = document.getElementById('app-confirm-title');
        const messageEl = document.getElementById('app-confirm-message');
        const confirmBtn = document.getElementById('app-confirm-ok');
        const cancelBtn = document.getElementById('app-confirm-cancel');

        if (!modal || !titleEl || !messageEl || !confirmBtn || !cancelBtn) {
            return Promise.resolve(false);
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;
        confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
        modal.style.display = 'flex';

        return new Promise((resolve) => {
            let settled = false;

            const close = (result) => {
                if (settled) return;
                settled = true;
                modal.style.display = 'none';
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKeydown);
                resolve(result);
            };

            const onConfirm = () => close(true);
            const onCancel = () => close(false);
            const onBackdrop = (event) => {
                if (event.target === modal) close(false);
            };
            const onKeydown = (event) => {
                if (event.key === 'Escape') close(false);
                if (event.key === 'Enter') close(true);
            };

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKeydown);
            confirmBtn.focus();
        });
    },

    destroyChart(instance) {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
        }
    },

    isCommandPaletteOpen() {
        const overlay = document.getElementById('command-palette-overlay');
        return Boolean(overlay && overlay.style.display !== 'none');
    },

    async openCommandPalette() {
        const overlay = document.getElementById('command-palette-overlay');
        const input = document.getElementById('command-palette-input');
        const button = document.querySelector('.command-button');
        if (!overlay || !input) return;

        const notificationPanel = document.getElementById('notification-panel');
        const notificationButton = document.getElementById('notification-toggle');
        if (notificationPanel) notificationPanel.style.display = 'none';
        if (notificationButton) notificationButton.classList.remove('is-active');

        overlay.style.display = 'flex';
        button?.classList.add('is-active');
        input.value = '';
        window.setTimeout(() => input.focus(), 0);
        await this.loadCommandPaletteResults('');
    },

    closeCommandPalette() {
        const overlay = document.getElementById('command-palette-overlay');
        const button = document.querySelector('.command-button');
        if (!overlay) return;

        overlay.style.display = 'none';
        button?.classList.remove('is-active');
        this.commandResults = [];
        this.commandSelectedIndex = -1;
        if (this.commandSearchTimer) {
            window.clearTimeout(this.commandSearchTimer);
            this.commandSearchTimer = null;
        }
    },

    handleCommandPaletteInput() {
        const input = document.getElementById('command-palette-input');
        if (!input) return;

        if (this.commandSearchTimer) {
            window.clearTimeout(this.commandSearchTimer);
        }
        this.commandSearchTimer = window.setTimeout(() => {
            this.loadCommandPaletteResults(input.value);
        }, 160);
    },

    async loadCommandPaletteResults(query) {
        const resultsEl = document.getElementById('command-palette-results');
        if (!resultsEl || typeof API === 'undefined') return;

        resultsEl.innerHTML = '<div class="command-palette-empty">Searching LifeOS...</div>';
        try {
            const payload = await API.get(`/api/os/command?q=${encodeURIComponent(query || '')}`);
            this.commandResults = payload.results || [];
            this.renderCommandPaletteResults();
        } catch (error) {
            resultsEl.innerHTML = '<div class="command-palette-empty">Command search unavailable.</div>';
        }
    },

    renderCommandPaletteResults() {
        const resultsEl = document.getElementById('command-palette-results');
        if (!resultsEl) return;

        if (!this.commandResults.length) {
            resultsEl.innerHTML = '<div class="command-palette-empty">No matching records found.</div>';
            this.commandSelectedIndex = -1;
            return;
        }

        resultsEl.innerHTML = this.commandResults.map((item, index) => `
            <button type="button" class="command-result" data-command-index="${index}">
                <span class="command-result-icon"><i class="${CoreUI.escapeHtml(item.icon || 'ph ph-circle')}"></i></span>
                <span class="command-result-main">
                    <span class="command-result-title">${CoreUI.escapeHtml(item.title)}</span>
                    <span class="command-result-subtitle">${CoreUI.escapeHtml(item.subtitle || item.action_url || '')}</span>
                </span>
                <span class="command-result-type">${CoreUI.escapeHtml(item.type || 'item')}</span>
            </button>
        `).join('');
        this.setCommandSelection(0);
    },

    setCommandSelection(index) {
        const buttons = Array.from(document.querySelectorAll('.command-result'));
        if (!buttons.length) {
            this.commandSelectedIndex = -1;
            return;
        }

        const boundedIndex = Math.max(0, Math.min(index, buttons.length - 1));
        this.commandSelectedIndex = boundedIndex;
        buttons.forEach((button, buttonIndex) => {
            button.classList.toggle('is-selected', buttonIndex === boundedIndex);
        });
        buttons[boundedIndex]?.scrollIntoView({ block: 'nearest' });
    },

    moveCommandSelection(delta) {
        if (!this.commandResults.length) return;
        const nextIndex = this.commandSelectedIndex + delta;
        if (nextIndex < 0) {
            this.setCommandSelection(this.commandResults.length - 1);
            return;
        }
        if (nextIndex >= this.commandResults.length) {
            this.setCommandSelection(0);
            return;
        }
        this.setCommandSelection(nextIndex);
    },

    activateSelectedCommand() {
        if (this.commandSelectedIndex < 0) return;
        this.activateCommandResult(this.commandResults[this.commandSelectedIndex]);
    },

    activateCommandResult(item) {
        if (!item) return;

        if (item.action_type === 'quick_add') {
            this.closeCommandPalette();
            if (window.DashboardUI && typeof window.DashboardUI.openQuickAdd === 'function') {
                window.DashboardUI.openQuickAdd();
                return;
            }
            window.location.href = item.action_url || '/?quick_add=1';
            return;
        }

        const actionUrl = item.action_url || '#';
        this.closeCommandPalette();
        if (actionUrl !== '#') {
            window.location.href = actionUrl;
        }
    },

    initCommandPalette() {
        const overlay = document.getElementById('command-palette-overlay');
        const input = document.getElementById('command-palette-input');
        const resultsEl = document.getElementById('command-palette-results');
        if (!overlay || !input || !resultsEl) return;

        input.addEventListener('input', () => this.handleCommandPaletteInput());
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.moveCommandSelection(1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                this.moveCommandSelection(-1);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                this.activateSelectedCommand();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.closeCommandPalette();
            }
        });

        resultsEl.addEventListener('click', (event) => {
            const button = event.target.closest?.('.command-result');
            if (!button) return;
            const index = Number(button.dataset.commandIndex);
            this.activateCommandResult(this.commandResults[index]);
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                this.closeCommandPalette();
            }
        });

        document.addEventListener('keydown', (event) => {
            const key = String(event.key || '').toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === 'k') {
                event.preventDefault();
                if (this.isCommandPaletteOpen()) {
                    this.closeCommandPalette();
                } else {
                    this.openCommandPalette();
                }
            } else if (event.key === 'Escape' && this.isCommandPaletteOpen()) {
                event.preventDefault();
                this.closeCommandPalette();
            }
        });
    },

    async loadNotifications() {
        const countEl = document.getElementById('notification-count');
        const listEl = document.getElementById('notification-list');
        if (!countEl || !listEl || typeof API === 'undefined') return;

        try {
            const payload = await API.get('/api/notifications/');
            const items = payload.items || [];
            countEl.textContent = String(payload.count || items.length);
            countEl.style.display = items.length ? 'inline-flex' : 'none';
            if (!items.length) {
                listEl.innerHTML = '<div class="notification-item"><span class="notification-item-meta">No active notifications.</span></div>';
                this.notificationsLoaded = true;
                return;
            }
            listEl.innerHTML = items.map((item) => `
                <a class="notification-item is-${CoreUI.escapeHtml(item.severity || 'low')}" href="${CoreUI.escapeHtml(item.action_url || '#')}">
                    <span class="notification-item-title">${CoreUI.escapeHtml(item.title)}</span>
                    <span class="notification-item-meta">${CoreUI.escapeHtml(item.message || '')}</span>
                    <span class="notification-item-meta">${CoreUI.escapeHtml(item.when ? CoreUI.formatDate(item.when) : '')}</span>
                </a>
            `).join('');
            this.notificationsLoaded = true;
        } catch (error) {
            listEl.innerHTML = '<div class="notification-item"><span class="notification-item-meta">Notifications unavailable.</span></div>';
        }
    },

    async toggleNotifications() {
        const panel = document.getElementById('notification-panel');
        const button = document.getElementById('notification-toggle');
        if (!panel || !button) return;

        const shouldOpen = panel.style.display === 'none';
        panel.style.display = shouldOpen ? 'block' : 'none';
        button.classList.toggle('is-active', shouldOpen);
        if (shouldOpen && !this.notificationsLoaded) {
            await this.loadNotifications();
        }
    },
    
    initClock() {
        const clockEl = document.getElementById('os-clock');
        if (!clockEl) return;
        
        const updateClock = () => {
            const now = new Date();
            const time = now.toLocaleTimeString('en-US', { hour12: false });
            const date = now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
            clockEl.textContent = `${date} [${time}]`;
        };

        updateClock();
        setInterval(updateClock, 1000);
    },

    initSidebarToggle() {
        const toggleBtn = document.getElementById('sidebar-toggle');
        const sidebar = document.getElementById('sidebar');
        if (!toggleBtn || !sidebar) return;

        let isCollapsed = false;

        try {
            isCollapsed = localStorage.getItem(this.sidebarStorageKey) === 'true';
        } catch (error) {
            console.warn('Unable to read sidebar state from localStorage.', error);
        }

        sidebar.classList.toggle('collapsed', isCollapsed);

        toggleBtn.addEventListener('click', () => {
            const nextState = !sidebar.classList.contains('collapsed');
            sidebar.classList.toggle('collapsed', nextState);

            try {
                localStorage.setItem(this.sidebarStorageKey, String(nextState));
            } catch (error) {
                console.warn('Unable to save sidebar state to localStorage.', error);
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CoreUI.initClock();
    CoreUI.initSidebarToggle();
    CoreUI.initCommandPalette();
    CoreUI.loadNotifications();
    document.addEventListener('click', (event) => {
        const shell = event.target.closest?.('.notification-shell');
        if (shell) return;
        const panel = document.getElementById('notification-panel');
        const button = document.getElementById('notification-toggle');
        if (panel) panel.style.display = 'none';
        if (button) button.classList.remove('is-active');
    });
});
