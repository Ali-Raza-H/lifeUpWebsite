const HubUI = {
    quickAddHandlers: {
        habits: ['HabitUI', 'openQuickAdd'],
        tasks: ['TaskUI', 'openQuickAdd'],
        calendar: ['CalendarUI', 'openQuickAdd'],
        projects: ['ProjectUI', 'openQuickAdd'],
        goals: ['GoalUI', 'openQuickAdd'],
        work: ['WorkUI', 'openQuickAdd']
    },

    switchFrame(panel) {
        const tab = document.querySelector(`[data-hub-frame="${panel}"]`);
        const frame = document.getElementById('hub-frame');
        if (!tab || !frame) return;
        document.querySelectorAll('[data-hub-frame]').forEach((item) => {
            item.classList.toggle('active', item.dataset.hubFrame === panel);
        });
        frame.src = tab.dataset.hubSrc;
        if (window.location.hash !== `#${tab.dataset.hubFrame}`) {
            history.replaceState(null, '', `#${tab.dataset.hubFrame}`);
        }
        this.updateQuickAdd(tab);
    },

    activePanel() {
        const activeTab = document.querySelector('[data-hub-frame].active');
        return activeTab?.dataset.hubFrame || '';
    },

    updateQuickAdd(tab = null) {
        const activeTab = tab || document.querySelector('[data-hub-frame].active');
        const button = document.getElementById('hub-quick-add-btn');
        const label = document.getElementById('hub-quick-add-label');
        if (!button || !activeTab) return;

        const panel = activeTab.dataset.hubFrame;
        const quickLabel = activeTab.dataset.hubQuickLabel || '';
        const hasHandler = Boolean(this.quickAddHandlers[panel]);
        button.style.display = hasHandler ? '' : 'none';
        button.disabled = !hasHandler;
        if (label && quickLabel) label.textContent = quickLabel;
    },

    openQuickAdd() {
        const panel = this.activePanel();
        const handler = this.quickAddHandlers[panel];
        const frame = document.getElementById('hub-frame');
        if (!handler || !frame?.contentWindow) return;

        const [namespace, method] = handler;
        const target = frame.contentWindow[namespace];
        if (target && typeof target[method] === 'function') {
            target[method]();
            return;
        }
        CoreUI.showError('That section is still loading. Try again in a moment.');
    },

    applyHash() {
        const hash = window.location.hash.replace('#', '');
        if (hash && document.querySelector(`[data-hub-frame="${hash}"]`)) {
            this.switchFrame(hash);
        }
    },

    init() {
        this.applyHash();
        this.updateQuickAdd();
        window.addEventListener('hashchange', () => this.applyHash());
    }
};

document.addEventListener('DOMContentLoaded', () => HubUI.init());
