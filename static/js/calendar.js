const CalendarUI = {
    selectedWeek: null,
    eventsById: new Map(),
    weekData: null,
    projects: [],
    goals: [],

    async loadWeek(start = this.selectedWeek) {
        try {
            const suffix = start ? `?start=${encodeURIComponent(start)}` : '';
            const [payload, projects, goals] = await Promise.all([
                API.get(`/api/calendar/week${suffix}`),
                API.get('/api/projects/'),
                API.get('/api/goals/')
            ]);
            this.selectedWeek = payload.week_start;
            this.weekData = payload;
            this.projects = projects;
            this.goals = goals;
            this.eventsById = new Map();
            payload.days.forEach((day) => day.events.forEach((event) => this.eventsById.set(event.id, event)));
            this.renderToolbar(payload);
            this.renderWeek(payload);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load weekly calendar.');
        }
    },

    renderToolbar(payload) {
        const label = document.getElementById('calendar-week-label');
        const prevButton = document.getElementById('calendar-prev-week');
        const nextButton = document.getElementById('calendar-next-week');
        const thisWeekButton = document.getElementById('calendar-this-week');
        if (label) label.textContent = payload.week_label;
        if (prevButton) prevButton.onclick = () => this.loadWeek(payload.previous_week);
        if (nextButton) nextButton.onclick = () => this.loadWeek(payload.next_week);
        if (thisWeekButton) thisWeekButton.onclick = () => this.loadWeek(null);
    },

    renderWeek(payload) {
        const container = document.getElementById('calendar-week-view');
        if (!container) return;

        const header = payload.days.map((day) => `
            <div class="week-day-header ${day.is_today ? 'is-today' : ''}">
                <div class="week-day-name">${CoreUI.escapeHtml(day.label)}</div>
                <div class="week-day-number">${day.day_number}</div>
            </div>
        `).join('');

        const timeLabels = payload.time_labels.map((label) => `<div class="week-time-label">${label}</div>`).join('');
        const columns = payload.days.map((day) => {
            const grid = payload.time_labels.map(() => '<div class="week-grid-cell"></div>').join('');
            const events = day.events.map((event) => this.renderEventBlock(event)).join('');
            return `<div class="week-day-column">${grid}${events}</div>`;
        }).join('');

        container.innerHTML = `
            <div class="week-view-shell">
                <div class="week-view">
                    <div class="week-header-row">
                        <div class="week-time-spacer"></div>
                        ${header}
                    </div>
                    <div class="week-body">
                        <div class="week-time-column">${timeLabels}</div>
                        <div class="week-columns">${columns}</div>
                    </div>
                </div>
            </div>
        `;
    },

    renderEventBlock(event) {
        const startMinutes = Math.max(event.start_minutes, 360);
        const endMinutes = Math.min(event.end_minutes, 1440);
        const top = ((startMinutes - 360) / 60) * 56;
        const height = Math.max(32, ((endMinutes - startMinutes) / 60) * 56);
        const meta = [event.category || 'general', event.project_name, event.goal_title].filter(Boolean).join(' - ');
        return `
            <button
                type="button"
                class="week-event"
                style="top:${top}px; height:${height}px;"
                onclick="CalendarUI.openEventModal(${event.id})"
            >
                <div class="week-event-title">${CoreUI.escapeHtml(event.title)}</div>
                <div class="week-event-meta">
                    ${CoreUI.escapeHtml(event.start_time)} - ${CoreUI.escapeHtml(event.end_time)}<br>
                    ${CoreUI.escapeHtml(meta)}
                </div>
            </button>
        `;
    },

    populateRelationOptions() {
        const projectSelect = document.getElementById('calendar-event-project');
        const goalSelect = document.getElementById('calendar-event-goal');
        if (projectSelect) {
            projectSelect.innerHTML = '<option value="">No project</option>';
            this.projects.forEach((project) => {
                projectSelect.innerHTML += `<option value="${project.id}">${CoreUI.escapeHtml(project.name)}</option>`;
            });
        }
        if (goalSelect) {
            goalSelect.innerHTML = '<option value="">No goal</option>';
            this.goals.forEach((goal) => {
                goalSelect.innerHTML += `<option value="${goal.id}">${CoreUI.escapeHtml(goal.title)}</option>`;
            });
        }
    },

    openEventModal(eventId = null) {
        const modal = document.getElementById('calendar-event-modal');
        const title = document.getElementById('calendar-modal-title');
        const deleteBtn = document.getElementById('calendar-delete-btn');
        const form = document.getElementById('calendar-event-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        this.populateRelationOptions();
        document.getElementById('calendar-event-id').value = '';
        deleteBtn.style.display = 'none';

        if (eventId) {
            const event = this.eventsById.get(eventId);
            if (!event) return;
            title.textContent = 'Edit Event';
            document.getElementById('calendar-event-id').value = event.id;
            document.getElementById('calendar-event-title').value = event.title;
            document.getElementById('calendar-event-category').value = event.category || '';
            document.getElementById('calendar-event-location').value = event.location || '';
            document.getElementById('calendar-event-project').value = event.project_id || '';
            document.getElementById('calendar-event-goal').value = event.goal_id || '';
            document.getElementById('calendar-event-recurrence').value = event.recurrence || 'none';
            document.getElementById('calendar-event-recurrence-until').value = event.recurrence_until || '';
            document.getElementById('calendar-event-start').value = this.toDateTimeLocal(event.start_at);
            document.getElementById('calendar-event-end').value = this.toDateTimeLocal(event.end_at);
            document.getElementById('calendar-event-description').value = event.description || '';
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'New Event';
            const defaultStart = this.getDefaultStart();
            const defaultEnd = new Date(defaultStart.getTime() + (60 * 60 * 1000));
            document.getElementById('calendar-event-start').value = this.formatLocalDateTime(defaultStart);
            document.getElementById('calendar-event-end').value = this.formatLocalDateTime(defaultEnd);
        }

        modal.style.display = 'flex';
    },

    closeEventModal() {
        const modal = document.getElementById('calendar-event-modal');
        if (modal) modal.style.display = 'none';
    },

    getDefaultStart() {
        if (this.weekData?.days?.length) {
            const firstDay = this.weekData.days[0].date;
            return new Date(`${firstDay}T09:00`);
        }
        const now = new Date();
        now.setHours(9, 0, 0, 0);
        return now;
    },

    toDateTimeLocal(value) {
        if (!value) return '';
        return String(value).replace(' ', 'T').slice(0, 16);
    },

    formatLocalDateTime(date) {
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    async submitEvent(event) {
        event.preventDefault();
        const eventId = document.getElementById('calendar-event-id').value;
        const payload = {
            title: document.getElementById('calendar-event-title').value,
            category: document.getElementById('calendar-event-category').value,
            location: document.getElementById('calendar-event-location').value,
            project_id: document.getElementById('calendar-event-project').value ? parseInt(document.getElementById('calendar-event-project').value, 10) : null,
            goal_id: document.getElementById('calendar-event-goal').value ? parseInt(document.getElementById('calendar-event-goal').value, 10) : null,
            recurrence: document.getElementById('calendar-event-recurrence').value || 'none',
            recurrence_until: document.getElementById('calendar-event-recurrence-until').value || null,
            start_at: document.getElementById('calendar-event-start').value,
            end_at: document.getElementById('calendar-event-end').value,
            description: document.getElementById('calendar-event-description').value
        };

        try {
            if (eventId) {
                await API.put(`/api/calendar/events/${eventId}`, payload);
            } else {
                await API.post('/api/calendar/events', payload);
            }
            this.closeEventModal();
            await this.loadWeek(this.selectedWeek);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save calendar event.');
        }
    },

    async deleteCurrentEvent() {
        const eventId = document.getElementById('calendar-event-id').value;
        if (!eventId || !(await CoreUI.confirm({
            title: 'Delete event?',
            message: 'This calendar event will be removed permanently.',
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/calendar/events/${eventId}`);
            this.closeEventModal();
            await this.loadWeek(this.selectedWeek);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete event.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CalendarUI.loadWeek();
});
