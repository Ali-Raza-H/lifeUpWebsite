const CoreUI = {
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

    destroyChart(instance) {
        if (instance && typeof instance.destroy === 'function') {
            instance.destroy();
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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CoreUI.initClock();
});
