const CalendarUI = {
    activeView: 'week',
    selectedWeek: null,
    selectedMonth: null,
    selectedDate: null,
    weekData: null,
    monthData: null,
    dragState: null,
    eventsById: new Map(),
    projects: [],
    goals: [],

    async init() {
        this.bindEvents();
        await this.loadRelations();
        await Promise.all([this.loadWeek(), this.loadMonth()]);
        this.renderActiveView();
    },

    bindEvents() {
        document.getElementById('calendar-prev')?.addEventListener('click', () => this.navigate(-1));
        document.getElementById('calendar-next')?.addEventListener('click', () => this.navigate(1));
        document.getElementById('calendar-today')?.addEventListener('click', () => this.goToday());
        document.getElementById('calendar-view-week')?.addEventListener('click', () => this.switchView('week'));
        document.getElementById('calendar-view-month')?.addEventListener('click', () => this.switchView('month'));
        document.getElementById('calendar-category-filter')?.addEventListener('change', () => {
            this.renderActiveView();
        });
        document.getElementById('calendar-week-view')?.addEventListener('mousedown', (event) => this.handleWeekMouseDown(event));
        document.addEventListener('mousemove', (event) => this.handleWeekMouseMove(event));
        document.addEventListener('mouseup', (event) => this.handleWeekMouseUp(event));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.clearWeekDraft();
        });

        window.addEventListener('click', (event) => {
            if (event.target.classList.contains('modal-overlay')) {
                event.target.style.display = 'none';
            }
        });
    },

    async loadRelations() {
        try {
            const [projects, goals] = await Promise.all([
                API.get('/api/projects/'),
                API.get('/api/goals/')
            ]);
            this.projects = projects;
            this.goals = goals;
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load calendar relations.');
        }
    },

    async loadWeek(start = null, silent = false) {
        const suffix = start ? `?start=${encodeURIComponent(start)}` : '';
        const payload = await API.get(`/api/calendar/week${suffix}`);
        this.selectedWeek = payload.week_start;
        this.weekData = payload;
        this.indexPayloadEvents(payload);
        if (!silent && this.activeView === 'week') this.renderActiveView();
        return payload;
    },

    async loadMonth(month = null, silent = false) {
        const suffix = month ? `?month=${encodeURIComponent(month)}` : '';
        const payload = await API.get(`/api/calendar/month${suffix}`);
        this.selectedMonth = payload.month;
        this.monthData = payload;
        this.indexPayloadEvents(payload);
        if (!silent && this.activeView === 'month') this.renderActiveView();
        return payload;
    },

    async refreshCurrentRanges() {
        await Promise.all([
            this.loadWeek(this.selectedWeek, true),
            this.loadMonth(this.selectedMonth, true)
        ]);
        this.renderActiveView();
    },

    indexPayloadEvents(payload) {
        if (!payload?.days) return;
        payload.days.forEach((day) => {
            day.events.forEach((event) => {
                this.eventsById.set(event.id, event);
            });
        });
    },

    switchView(view) {
        if (view === this.activeView) return;
        this.clearWeekDraft();
        this.activeView = view;
        this.renderActiveView();
    },

    async navigate(step) {
        try {
            if (this.activeView === 'week') {
                const base = this.parseIsoDate(this.selectedWeek) || this.startOfWeek(new Date());
                const next = new Date(base);
                next.setDate(base.getDate() + (step * 7));
                await this.loadWeek(this.formatDate(next), true);
            } else {
                const base = this.parseMonth(this.selectedMonth) || this.firstOfMonth(new Date());
                const next = new Date(base.getFullYear(), base.getMonth() + step, 1);
                await this.loadMonth(this.formatMonth(next), true);
            }
            this.renderActiveView();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to navigate calendar.');
        }
    },

    async goToday() {
        try {
            await Promise.all([this.loadWeek(null, true), this.loadMonth(null, true)]);
            this.selectedDate = this.formatDate(new Date());
            this.renderActiveView();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to jump to today.');
        }
    },

    renderActiveView() {
        this.renderToolbar();
        this.toggleViewButtons();
        this.toggleViewPanels();
        this.renderCategoryFilter();

        if (this.activeView === 'week') {
            if (!this.weekData) return;
            this.ensureSelectedDate(this.weekData.days);
            this.renderWeek(this.weekData);
        } else {
            if (!this.monthData) return;
            this.ensureSelectedDate(this.monthData.days);
            this.renderMonth(this.monthData);
        }

        this.renderAgenda();
    },

    toggleViewButtons() {
        const weekBtn = document.getElementById('calendar-view-week');
        const monthBtn = document.getElementById('calendar-view-month');
        if (weekBtn) {
            weekBtn.classList.toggle('active', this.activeView === 'week');
            weekBtn.setAttribute('aria-selected', this.activeView === 'week' ? 'true' : 'false');
        }
        if (monthBtn) {
            monthBtn.classList.toggle('active', this.activeView === 'month');
            monthBtn.setAttribute('aria-selected', this.activeView === 'month' ? 'true' : 'false');
        }
    },

    toggleViewPanels() {
        const weekView = document.getElementById('calendar-week-view');
        const monthView = document.getElementById('calendar-month-view');
        if (weekView) weekView.style.display = this.activeView === 'week' ? 'block' : 'none';
        if (monthView) monthView.style.display = this.activeView === 'month' ? 'block' : 'none';
    },

    renderToolbar() {
        const labelEl = document.getElementById('calendar-period-label');
        if (!labelEl) return;
        if (this.activeView === 'week' && this.weekData) {
            labelEl.textContent = this.weekData.week_label;
            return;
        }
        if (this.activeView === 'month' && this.monthData) {
            labelEl.textContent = this.monthData.month_label;
            return;
        }
        labelEl.textContent = 'Loading...';
    },

    renderCategoryFilter() {
        const select = document.getElementById('calendar-category-filter');
        if (!select) return;
        const previous = select.value;
        const categories = new Set();
        this.getActiveDays().forEach((day) => {
            day.events.forEach((event) => {
                const category = (event.category || '').trim();
                if (category) categories.add(category);
            });
        });
        select.innerHTML = '<option value="">All categories</option>';
        [...categories].sort((left, right) => left.localeCompare(right)).forEach((category) => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = this.labelize(category);
            select.appendChild(option);
        });
        if ([...select.options].some((option) => option.value === previous)) {
            select.value = previous;
        }
    },

    getActiveDays() {
        if (this.activeView === 'week') return this.weekData?.days || [];
        return this.monthData?.days || [];
    },

    filterEvents(events) {
        const category = document.getElementById('calendar-category-filter')?.value || '';
        if (!category) return events;
        return events.filter((event) => (event.category || '') === category);
    },

    ensureSelectedDate(days) {
        if (!days.length) {
            this.selectedDate = null;
            return;
        }
        if (this.selectedDate && days.some((day) => day.date === this.selectedDate)) return;

        const today = this.formatDate(new Date());
        const todayMatch = days.find((day) => day.date === today);
        if (todayMatch) {
            this.selectedDate = today;
            return;
        }

        const currentMonthDay = days.find((day) => day.is_current_month);
        this.selectedDate = (currentMonthDay || days[0]).date;
    },

    selectDate(dateString) {
        this.selectedDate = dateString;
        if (this.activeView === 'week') this.renderWeek(this.weekData);
        if (this.activeView === 'month') this.renderMonth(this.monthData);
        this.renderAgenda();
    },

    renderWeek(payload) {
        const container = document.getElementById('calendar-week-view');
        if (!container) return;

        const header = payload.days.map((day) => `
            <button
                type="button"
                class="week-day-header ${day.is_today ? 'is-today' : ''} ${day.date === this.selectedDate ? 'is-selected' : ''}"
                onclick="CalendarUI.selectDate('${day.date}')"
            >
                <div class="week-day-name">${CoreUI.escapeHtml(day.label)}</div>
                <div class="week-day-number">${day.day_number}</div>
            </button>
        `).join('');

        const timeLabels = payload.time_labels.map((label) => `<div class="week-time-label">${label}</div>`).join('');
        const columns = payload.days.map((day) => {
            const grid = payload.time_labels.map(() => '<div class="week-grid-cell"></div>').join('');
            const events = this.layoutDayEvents(this.filterEvents(day.events))
                .map((event) => this.renderEventBlock(event))
                .join('');
            return `<div class="week-day-column ${day.date === this.selectedDate ? 'is-selected' : ''}" data-date="${day.date}">${grid}${events}</div>`;
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

    handleWeekMouseDown(event) {
        if (this.activeView !== 'week') return;
        const column = event.target.closest('.week-day-column');
        if (!column) return;
        if (event.target.closest('.week-event')) return;

        event.preventDefault();
        const date = column.dataset.date;
        if (!date) return;

        const minutes = this.pointerToMinutes(event.clientY, column);
        const previewEl = document.createElement('div');
        previewEl.className = 'week-draft-block';
        column.appendChild(previewEl);

        this.dragState = {
            date,
            column,
            startMinutes: minutes,
            currentMinutes: minutes,
            moved: false,
            previewEl
        };
        this.updateWeekDraftPreview();
    },

    handleWeekMouseMove(event) {
        if (!this.dragState) return;
        event.preventDefault();

        const minutes = this.pointerToMinutes(event.clientY, this.dragState.column);
        if (minutes !== this.dragState.currentMinutes) this.dragState.moved = true;
        this.dragState.currentMinutes = minutes;
        this.updateWeekDraftPreview();
    },

    handleWeekMouseUp(_event) {
        if (!this.dragState) return;

        const draft = this.dragState;
        let startMinutes = Math.min(draft.startMinutes, draft.currentMinutes);
        let endMinutes = Math.max(draft.startMinutes, draft.currentMinutes);
        if (endMinutes <= startMinutes) endMinutes = startMinutes + 30;
        if (endMinutes > 1440) {
            endMinutes = 1440;
            startMinutes = Math.max(360, endMinutes - 30);
        }

        const shouldCreate = draft.moved;
        this.clearWeekDraft();

        if (!shouldCreate) return;

        this.selectDate(draft.date);
        this.openEventModal(null, {
            date: draft.date,
            startMinutes,
            endMinutes
        });
    },

    clearWeekDraft() {
        if (!this.dragState) return;
        this.dragState.previewEl?.remove();
        this.dragState = null;
    },

    updateWeekDraftPreview() {
        if (!this.dragState) return;

        let startMinutes = Math.min(this.dragState.startMinutes, this.dragState.currentMinutes);
        let endMinutes = Math.max(this.dragState.startMinutes, this.dragState.currentMinutes);
        if (endMinutes <= startMinutes) endMinutes = startMinutes + 30;
        if (endMinutes > 1440) {
            endMinutes = 1440;
            startMinutes = Math.max(360, endMinutes - 30);
        }

        const top = ((startMinutes - 360) / 60) * 56;
        const height = Math.max(28, ((endMinutes - startMinutes) / 60) * 56);
        this.dragState.previewEl.style.top = `${top}px`;
        this.dragState.previewEl.style.height = `${height}px`;
    },

    pointerToMinutes(clientY, column) {
        const rect = column.getBoundingClientRect();
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const rawMinutes = 360 + ((y / 56) * 60);
        return this.snapToStep(rawMinutes, 30);
    },

    snapToStep(minutes, step) {
        const snapped = Math.round(minutes / step) * step;
        return Math.max(360, Math.min(1440, snapped));
    },

    layoutDayEvents(events) {
        const sortedEvents = [...events].sort((left, right) => {
            return (left.start_minutes - right.start_minutes) || (left.end_minutes - right.end_minutes) || (left.id - right.id);
        });
        const groups = [];
        let currentGroup = null;

        sortedEvents.forEach((event) => {
            const start = Number(event.start_minutes) || 0;
            const end = Math.max(start + 1, Number(event.end_minutes) || start + 1);
            if (!currentGroup || start >= currentGroup.end) {
                currentGroup = { events: [], end };
                groups.push(currentGroup);
            }
            currentGroup.events.push(event);
            currentGroup.end = Math.max(currentGroup.end, end);
        });

        return groups.flatMap((group) => {
            const laneEnds = [];
            const laidOut = group.events.map((event) => {
                const start = Number(event.start_minutes) || 0;
                const end = Math.max(start + 1, Number(event.end_minutes) || start + 1);
                let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
                if (lane === -1) {
                    lane = laneEnds.length;
                    laneEnds.push(end);
                } else {
                    laneEnds[lane] = end;
                }
                return { ...event, layoutLane: lane };
            });
            const laneCount = Math.max(1, laneEnds.length);
            return laidOut.map((event) => ({
                ...event,
                layoutLaneCount: laneCount
            }));
        });
    },

    renderEventBlock(event) {
        const startMinutes = Math.max(event.start_minutes, 360);
        const endMinutes = Math.min(event.end_minutes, 1440);
        const top = ((startMinutes - 360) / 60) * 56;
        const height = Math.max(30, ((endMinutes - startMinutes) / 60) * 56);
        const meta = [event.category || 'general', event.project_name, event.goal_title].filter(Boolean).join(' - ');
        const laneCount = Math.max(1, event.layoutLaneCount || 1);
        const lane = Math.min(Math.max(0, event.layoutLane || 0), laneCount - 1);
        const width = 100 / laneCount;
        const left = lane * width;
        const overlapClass = laneCount > 1 ? ' is-overlapping' : '';
        const compressedClass = width < 48 ? ' is-compressed' : '';
        return `
            <button
                type="button"
                class="week-event${overlapClass}${compressedClass}"
                style="top:${top}px; height:${height}px; --event-left:${left}%; --event-width:${width}%;"
                onclick="CalendarUI.openEventModal(${event.id})"
                title="${CoreUI.escapeHtml(`${event.title} | ${event.start_time} - ${event.end_time}`)}"
            >
                <div class="week-event-title">${CoreUI.escapeHtml(event.title)}</div>
                <div class="week-event-meta">
                    ${CoreUI.escapeHtml(event.start_time)} - ${CoreUI.escapeHtml(event.end_time)}<br>
                    ${CoreUI.escapeHtml(meta)}
                </div>
            </button>
        `;
    },

    renderMonth(payload) {
        const container = document.getElementById('calendar-month-view');
        if (!container) return;

        const weekdayRow = payload.weekday_labels.map((label) => `
            <div class="calendar-month-weekday" role="columnheader">${CoreUI.escapeHtml(label)}</div>
        `).join('');

        const dayCells = payload.days.map((day) => {
            const visibleEvents = this.filterEvents(day.events);
            const events = visibleEvents.map((event) => {
                const meta = [event.category || 'general', event.location].filter(Boolean).join(' - ');
                return `
                <button
                    type="button"
                    class="calendar-month-event-pill"
                    onclick="event.stopPropagation(); CalendarUI.openEventModal(${event.id})"
                    title="${CoreUI.escapeHtml(`${event.title} | ${event.start_time} - ${event.end_time}`)}"
                >
                    <span class="calendar-month-event-time">${CoreUI.escapeHtml(event.start_time)}</span>
                    <span class="calendar-month-event-main">
                        <span class="calendar-month-event-title">${CoreUI.escapeHtml(event.title)}</span>
                        <span class="calendar-month-event-meta">${CoreUI.escapeHtml(meta)}</span>
                    </span>
                </button>
            `;
            }).join('');

            return `
                <div
                    class="calendar-month-day ${day.is_today ? 'is-today' : ''} ${day.is_current_month ? '' : 'is-muted'} ${day.date === this.selectedDate ? 'is-selected' : ''}"
                    role="gridcell"
                    tabindex="0"
                    aria-selected="${day.date === this.selectedDate ? 'true' : 'false'}"
                    aria-label="${CoreUI.escapeHtml(`${day.label || 'Day'} ${day.day_number}, ${visibleEvents.length} event${visibleEvents.length === 1 ? '' : 's'}`)}"
                    onclick="CalendarUI.selectDate('${day.date}')"
                    onkeydown="CalendarUI.handleMonthDayKeydown(event, '${day.date}')"
                >
                    <div class="calendar-month-day-head">
                        <span class="calendar-month-day-number">${day.day_number}</span>
                        <span class="calendar-month-day-count" aria-label="${visibleEvents.length} events">${visibleEvents.length || ''}</span>
                    </div>
                    <div class="calendar-month-day-events">
                        ${events}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="calendar-month-shell">
                <div class="calendar-month-grid" role="grid" aria-label="${CoreUI.escapeHtml(payload.month_label || 'Month calendar')}">
                    ${weekdayRow}
                    ${dayCells}
                </div>
            </div>
        `;
    },

    handleMonthDayKeydown(event, dateString) {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.selectDate(dateString);
    },

    renderAgenda() {
        const labelEl = document.getElementById('calendar-selected-date-label');
        const listEl = document.getElementById('calendar-agenda-list');
        if (!labelEl || !listEl) return;

        if (!this.selectedDate) {
            labelEl.textContent = 'No date selected';
            CoreUI.setEmptyState(listEl, 'Select a day to view events.');
            return;
        }

        labelEl.textContent = this.formatReadableDate(this.selectedDate);
        const day = this.getActiveDays().find((item) => item.date === this.selectedDate);
        const dayEvents = this.filterEvents((day?.events || [])).sort((left, right) => {
            return (left.start_minutes - right.start_minutes) || (left.end_minutes - right.end_minutes);
        });

        if (!dayEvents.length) {
            CoreUI.setEmptyState(listEl, 'No events for this day.');
            return;
        }

        listEl.innerHTML = dayEvents.map((event) => `
            <div class="compact-item calendar-agenda-item">
                <div class="calendar-agenda-main">
                    <div class="item-title">${CoreUI.escapeHtml(event.title)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml(event.start_time)} - ${CoreUI.escapeHtml(event.end_time)}</div>
                    <div class="item-desc">${CoreUI.escapeHtml([event.category, event.location].filter(Boolean).join(' - ') || 'No metadata')}</div>
                </div>
                <button class="btn btn-icon" type="button" onclick="CalendarUI.openEventModal(${event.id})" title="Edit event"><i class="ph ph-pencil-simple"></i></button>
            </div>
        `).join('');
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

    openEventModal(eventId = null, preset = null) {
        const modal = document.getElementById('calendar-event-modal');
        const title = document.getElementById('calendar-modal-title');
        const deleteBtn = document.getElementById('calendar-delete-btn');
        const form = document.getElementById('calendar-event-form');
        if (!modal || !title || !deleteBtn || !form) return;

        form.reset();
        this.populateRelationOptions();
        document.getElementById('calendar-event-id').value = '';
        document.getElementById('calendar-event-sync-task').checked = true;
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
            document.getElementById('calendar-event-sync-task').checked = Boolean(event.linked_task_id);
            deleteBtn.style.display = 'inline-flex';
        } else {
            title.textContent = 'New Event';
            let start = this.getDefaultStartDateTime();
            let end = new Date(start.getTime() + (60 * 60 * 1000));

            if (preset?.date && Number.isFinite(preset.startMinutes) && Number.isFinite(preset.endMinutes)) {
                start = this.dateWithMinutes(preset.date, preset.startMinutes);
                end = this.dateWithMinutes(preset.date, preset.endMinutes);
            }

            document.getElementById('calendar-event-start').value = this.formatLocalDateTime(start);
            document.getElementById('calendar-event-end').value = this.formatLocalDateTime(end);
        }

        modal.style.display = 'flex';
    },

    closeEventModal() {
        const modal = document.getElementById('calendar-event-modal');
        if (modal) modal.style.display = 'none';
    },

    openQuickAdd() {
        this.openEventModal();
    },

    getDefaultStartDateTime() {
        const baseDate = this.selectedDate ? this.parseIsoDate(this.selectedDate) : new Date();
        const target = new Date(baseDate || new Date());
        target.setHours(9, 0, 0, 0);
        return target;
    },

    dateWithMinutes(dateString, minutes) {
        const date = this.parseIsoDate(dateString) || new Date();
        const safeMinutes = Math.max(0, Math.min((24 * 60) - 1, Math.trunc(minutes)));
        const hours = Math.floor(safeMinutes / 60);
        const mins = safeMinutes % 60;
        date.setHours(hours, mins, 0, 0);
        return date;
    },

    async submitEvent(event) {
        event.preventDefault();
        const eventId = document.getElementById('calendar-event-id').value;
        const payload = {
            title: document.getElementById('calendar-event-title').value,
            category: document.getElementById('calendar-event-category').value,
            location: document.getElementById('calendar-event-location').value,
            project_id: this.intOrNull('calendar-event-project'),
            goal_id: this.intOrNull('calendar-event-goal'),
            recurrence: document.getElementById('calendar-event-recurrence').value || 'none',
            recurrence_until: document.getElementById('calendar-event-recurrence-until').value || null,
            start_at: document.getElementById('calendar-event-start').value,
            end_at: document.getElementById('calendar-event-end').value,
            description: document.getElementById('calendar-event-description').value,
            sync_task: document.getElementById('calendar-event-sync-task').checked
        };

        try {
            if (eventId) {
                await API.put(`/api/calendar/events/${eventId}`, payload);
            } else {
                await API.post('/api/calendar/events', payload);
            }
            this.closeEventModal();
            await this.refreshCurrentRanges();
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
            await this.refreshCurrentRanges();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete event.');
        }
    },

    intOrNull(id) {
        const raw = document.getElementById(id)?.value;
        if (raw == null || raw === '') return null;
        const parsed = parseInt(raw, 10);
        return Number.isNaN(parsed) ? null : parsed;
    },

    parseIsoDate(value) {
        if (!value) return null;
        const parsed = new Date(`${value}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    },

    parseMonth(value) {
        if (!value) return null;
        const [year, month] = String(value).split('-').map((part) => parseInt(part, 10));
        if (!year || !month) return null;
        return new Date(year, month - 1, 1);
    },

    firstOfMonth(value) {
        return new Date(value.getFullYear(), value.getMonth(), 1);
    },

    startOfWeek(value) {
        const day = value.getDay();
        const mondayDiff = day === 0 ? -6 : 1 - day;
        const out = new Date(value);
        out.setDate(out.getDate() + mondayDiff);
        out.setHours(0, 0, 0, 0);
        return out;
    },

    formatDate(value) {
        const date = value instanceof Date ? value : new Date(value);
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },

    formatMonth(value) {
        const date = value instanceof Date ? value : new Date(value);
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    },

    formatReadableDate(value) {
        const date = this.parseIsoDate(value);
        if (!date) return 'Invalid date';
        return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    },

    toDateTimeLocal(value) {
        if (!value) return '';
        return String(value).replace(' ', 'T').slice(0, 16);
    },

    formatLocalDateTime(date) {
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => {
    CalendarUI.init();
});
