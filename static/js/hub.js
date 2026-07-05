const HubUI = {
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
    },

    applyHash() {
        const hash = window.location.hash.replace('#', '');
        if (hash && document.querySelector(`[data-hub-frame="${hash}"]`)) {
            this.switchFrame(hash);
        }
    },

    init() {
        this.applyHash();
        window.addEventListener('hashchange', () => this.applyHash());
    }
};

document.addEventListener('DOMContentLoaded', () => HubUI.init());
