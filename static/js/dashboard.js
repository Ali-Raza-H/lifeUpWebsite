const DashboardUI = {
    habitChartInstance: null,
    taskChartInstance: null,
    clockInterval: null,
    projects: [],
    goals: [],
    foodPresets: [],

    async loadData() {
        this.setGreeting();
        this.initClock();

        try {
            const [dashboardResult, dailyPlanResult, weeklyReviewResult] = await Promise.allSettled([
                API.get('/api/analytics/dashboard'),
                API.get('/api/os/daily-plan'),
                API.get('/api/os/weekly-review')
            ]);
            if (dashboardResult.status !== 'fulfilled') {
                throw dashboardResult.reason;
            }

            const payload = dashboardResult.value;
            const dailyPlan = dailyPlanResult.status === 'fulfilled' ? dailyPlanResult.value : null;
            const weeklyReview = weeklyReviewResult.status === 'fulfilled' ? weeklyReviewResult.value : null;
            const tasks = payload.tasks || [];
            const projects = payload.projects || [];
            const habits = payload.habits || [];
            const overview = payload.overview || {};
            const habitsMonthly = payload.habits_monthly || [];
            const taskAnalytics = payload.task_analytics || {};
            const todayPayload = payload.today || {};

            this.projects = projects;
            await this.loadQuickAddMeta();
            this.renderOverview(overview, tasks, todayPayload);
            this.renderDailyPlan(dailyPlan);
            this.renderWeeklyReview(weeklyReview);
            this.renderToday(todayPayload);
            this.renderTasks(tasks);
            this.renderProjects(projects);
            this.renderHabits(habits);
            this.renderNextEvent(todayPayload);
            this.initHabitChart(habitsMonthly);
            this.initTaskChart(taskAnalytics);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load dashboard data.');
        }
    },

    async loadQuickAddMeta() {
        const [goalsResult, presetsResult] = await Promise.allSettled([
            API.get('/api/goals/'),
            API.get('/api/life/diet/presets')
        ]);

        this.goals = goalsResult.status === 'fulfilled' ? goalsResult.value : [];
        this.foodPresets = presetsResult.status === 'fulfilled' ? presetsResult.value : [];
        this.populateQuickAddRelations();
    },

    initClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        const updateClock = () => {
            const now = new Date();
            const timeEl = document.getElementById('current-time');
            const dateEl = document.getElementById('current-date');
            if (timeEl) {
                timeEl.textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            }
            if (dateEl) {
                dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            }
        };
        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    },

    setGreeting() {
        const hour = new Date().getHours();
        let greeting = 'System Overview';
        if (hour >= 5 && hour < 12) greeting = 'Morning Protocol';
        else if (hour >= 12 && hour < 18) greeting = 'Afternoon Execution';
        else greeting = 'Evening Reflection';
        const el = document.getElementById('greeting');
        if (el) el.textContent = greeting;
    },

    renderOverview(overview, tasks, todayPayload) {
        const activeTaskCount = tasks.length;
        const activeProjectCount = overview?.active_projects ?? 0;
        const overdueCount = todayPayload?.overdue_tasks ?? 0;
        const consistency = overview?.consistency ?? 0;

        const grid = document.getElementById('dashboard-summary-grid');
        if (grid) {
            grid.innerHTML = `
                <div class="compact-item metric-card">
                    <span class="item-desc">Active Tasks</span>
                    <div class="stat-value">${activeTaskCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Active Projects</span>
                    <div class="stat-value">${activeProjectCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Overdue</span>
                    <div class="stat-value">${overdueCount}</div>
                </div>
                <div class="compact-item metric-card">
                    <span class="item-desc">Consistency</span>
                    <div class="stat-value">${consistency}%</div>
                </div>
            `;
        }

        const activeTasksEl = document.getElementById('active-tasks-count');
        if (activeTasksEl) activeTasksEl.textContent = String(activeTaskCount);

        const activeProjectsEl = document.getElementById('active-projects-count');
        if (activeProjectsEl) activeProjectsEl.textContent = String(activeProjectCount);

        const consistencyEl = document.getElementById('habit-consistency');
        if (consistencyEl) consistencyEl.textContent = `${consistency}%`;
    },

    renderDailyPlan(plan) {
        const list = document.getElementById('daily-plan-list');
        if (!list) return;

        if (!plan) {
            CoreUI.setEmptyState(list, 'Daily operating plan unavailable.');
            return;
        }

        const headline = plan.headline || {};
        const metrics = plan.metrics || {};
        const metricItems = [
            { label: 'Overdue', value: metrics.overdue_tasks ?? 0 },
            { label: 'Due Today', value: metrics.due_today ?? 0 },
            { label: 'Habits', value: metrics.open_habits ?? 0 },
            { label: 'Follow Ups', value: metrics.follow_ups_due ?? 0 },
            { label: 'Events', value: metrics.remaining_events_today ?? 0 }
        ];
        const blocks = plan.blocks || [];
        const actions = plan.actions || [];
        const risks = plan.risks || [];

        list.innerHTML = `
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                <div class="item-title">${CoreUI.escapeHtml(headline.title || 'Daily plan ready')}</div>
                <div class="item-desc">${CoreUI.escapeHtml(headline.message || 'Use this panel as the start-of-day operating brief.')}</div>
                <div style="display:grid; grid-template-columns:repeat(5, minmax(0, 1fr)); gap:8px; width:100%;">
                    ${metricItems.map((item) => `
                        <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:4px; min-height:auto;">
                            <span class="item-desc">${CoreUI.escapeHtml(item.label)}</span>
                            <span class="badge">${CoreUI.escapeHtml(item.value)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            ${blocks.slice(0, 3).map((block) => `
                <a class="compact-item" href="${CoreUI.escapeHtml(block.action_url || '#')}" style="text-decoration:none; flex-direction:column; align-items:flex-start; gap:7px;">
                    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; width:100%;">
                        <div>
                            <div class="item-desc">${CoreUI.escapeHtml(block.label || 'Block')}</div>
                            <div class="item-title" style="margin-top:4px;">${CoreUI.escapeHtml(block.title || 'Untitled block')}</div>
                        </div>
                        <span class="badge">${CoreUI.escapeHtml(block.severity || 'low')}</span>
                    </div>
                    <div class="item-desc">${CoreUI.escapeHtml(block.description || '')}</div>
                </a>
            `).join('')}
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div class="item-title">Next moves</div>
                ${actions.slice(0, 3).map((action) => `
                    <a href="${CoreUI.escapeHtml(action.action_url || '#')}" class="item-desc" style="color:var(--text-primary); text-decoration:none;">
                        <i class="ph ph-arrow-right"></i> ${CoreUI.escapeHtml(action.title)}
                        <span style="color:var(--text-secondary);"> - ${CoreUI.escapeHtml(action.detail || '')}</span>
                    </a>
                `).join('')}
            </div>
            ${risks.length ? `
                <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                    <div class="item-title">Watchouts</div>
                    ${risks.map((risk) => `
                        <a href="${CoreUI.escapeHtml(risk.action_url || '#')}" class="item-desc" style="color:var(--text-primary); text-decoration:none;">
                            <span class="badge">${CoreUI.escapeHtml(risk.severity || 'risk')}</span>
                            ${CoreUI.escapeHtml(risk.title)}
                            <span style="color:var(--text-secondary);"> - ${CoreUI.escapeHtml(risk.detail || '')}</span>
                        </a>
                    `).join('')}
                </div>
            ` : ''}
        `;
    },

    renderWeeklyReview(review) {
        const list = document.getElementById('weekly-review-list');
        if (!list) return;

        if (!review) {
            CoreUI.setEmptyState(list, 'Weekly review unavailable.');
            return;
        }

        const scorecard = review.scorecard || [];
        const wins = review.wins || [];
        const risks = review.risks || [];
        const nextFocus = review.next_focus || [];
        const period = review.period || {};

        list.innerHTML = `
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                <div style="display:flex; justify-content:space-between; gap:12px; width:100%; align-items:flex-start;">
                    <div>
                        <div class="item-title">Last 7 days</div>
                        <div class="item-desc">${CoreUI.escapeHtml(period.label || '')}</div>
                    </div>
                    <span class="badge">${CoreUI.escapeHtml(nextFocus.length ? 'Actionable' : 'Quiet')}</span>
                </div>
                <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; width:100%;">
                    ${scorecard.slice(0, 4).map((item) => `
                        <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:4px; min-height:auto;">
                            <span class="item-desc">${CoreUI.escapeHtml(item.label)}</span>
                            <span class="item-title">${CoreUI.escapeHtml(item.value)}</span>
                            <span class="item-desc">${CoreUI.escapeHtml(item.detail || '')}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div class="item-title">Wins</div>
                ${wins.slice(0, 2).map((win) => `
                    <a href="${CoreUI.escapeHtml(win.action_url || '#')}" class="item-desc" style="color:var(--text-primary); text-decoration:none;">
                        <i class="ph ph-check-circle"></i> ${CoreUI.escapeHtml(win.title)}
                        <span style="color:var(--text-secondary);"> - ${CoreUI.escapeHtml(win.detail || '')}</span>
                    </a>
                `).join('')}
            </div>
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div class="item-title">Risks</div>
                ${risks.slice(0, 2).map((risk) => `
                    <a href="${CoreUI.escapeHtml(risk.action_url || '#')}" class="item-desc" style="color:var(--text-primary); text-decoration:none;">
                        <span class="badge">${CoreUI.escapeHtml(risk.severity || 'low')}</span>
                        ${CoreUI.escapeHtml(risk.title)}
                    </a>
                `).join('')}
            </div>
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div class="item-title">Next focus</div>
                ${nextFocus.slice(0, 3).map((focus) => `
                    <a href="${CoreUI.escapeHtml(focus.action_url || '#')}" class="item-desc" style="color:var(--text-primary); text-decoration:none;">
                        <i class="ph ph-arrow-right"></i> ${CoreUI.escapeHtml(focus.title)}
                    </a>
                `).join('')}
            </div>
        `;
    },

    renderToday(todayPayload) {
        const list = document.getElementById('today-focus-list');
        if (!list) return;

        const focusTasks = todayPayload?.focus_tasks || [];
        const primaryFocus = todayPayload?.primary_focus || {};
        const currentEvent = todayPayload?.current_event || {};
        const headline = this.buildTodayHeadline(todayPayload, primaryFocus, currentEvent);
        const counters = [
            { label: 'Overdue', value: todayPayload?.overdue_tasks ?? 0 },
            { label: 'Due Today', value: todayPayload?.due_today ?? 0 },
            { label: 'Habits Open', value: todayPayload?.open_habits ?? 0 },
            { label: 'Follow Ups', value: todayPayload?.follow_ups_due ?? 0 }
        ];

        list.innerHTML = `
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                <div class="item-title">${CoreUI.escapeHtml(headline.title)}</div>
                <div class="item-desc">${CoreUI.escapeHtml(headline.message)}</div>
                <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; width:100%;">
                    ${counters.map((item) => `
                        <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:4px; min-height:auto;">
                            <span class="item-desc">${CoreUI.escapeHtml(item.label)}</span>
                            <span class="badge">${item.value}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        if (primaryFocus?.id) {
            list.innerHTML += `
                <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                    <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                        <div>
                            <div class="item-desc">Primary action</div>
                            <div class="item-title" style="margin-top:4px;">${CoreUI.escapeHtml(primaryFocus.title)}</div>
                        </div>
                        ${CoreUI.getPriorityLabel(primaryFocus.priority)}
                    </div>
                    <div class="item-desc">${CoreUI.escapeHtml(this.describeFocusTask(primaryFocus))}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${primaryFocus.project_name ? `<span class="badge"><i class="ph ph-kanban"></i>${CoreUI.escapeHtml(primaryFocus.project_name)}</span>` : ''}
                        ${primaryFocus.goal_title ? `<span class="badge"><i class="ph ph-target"></i>${CoreUI.escapeHtml(primaryFocus.goal_title)}</span>` : ''}
                        <span class="badge">${CoreUI.escapeHtml(this.focusReasonLabel(primaryFocus.focus_reason))}</span>
                    </div>
                </div>
            `;
        }

        if (focusTasks.length > 1) {
            list.innerHTML += focusTasks.slice(1, 4).map((task) => `
                <div class="compact-item" style="justify-content:space-between; gap:12px;">
                    <div style="min-width:0;">
                        <div class="item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(task.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(this.describeFocusTask(task))}</div>
                    </div>
                    <span class="badge">${CoreUI.escapeHtml(this.focusReasonLabel(task.focus_reason))}</span>
                </div>
            `).join('');
        }

        if (!focusTasks.length && !todayPayload?.open_habits && !todayPayload?.follow_ups_due) {
            list.innerHTML += `
                <div class="compact-item">
                    <span class="item-desc">No urgent task pressure right now. Use the open space to move a project forward deliberately.</span>
                </div>
            `;
        } else if ((todayPayload?.open_habit_names || []).length) {
            list.innerHTML += `
                <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:6px;">
                    <div class="item-desc">Habits still open</div>
                    <div style="display:flex; flex-wrap:wrap; gap:6px;">
                        ${todayPayload.open_habit_names.map((name) => `<span class="badge">${CoreUI.escapeHtml(name)}</span>`).join('')}
                    </div>
                </div>
            `;
        }
    },

    renderNextEvent(todayPayload) {
        const container = document.getElementById('dashboard-next-event');
        if (!container) return;
        const currentEvent = todayPayload?.current_event || {};
        const nextEvent = todayPayload?.next_event || {};
        const event = currentEvent?.id ? currentEvent : nextEvent;
        const freeWindowMinutes = Number(todayPayload?.free_window_minutes || 0);
        const remainingEventsToday = Number(todayPayload?.remaining_events_today || 0);

        if (!event || !event.id) {
            container.innerHTML = `
                <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                    <div class="item-title">Open schedule</div>
                    <div class="item-desc">No active or upcoming events are scheduled. This is a good place to protect deep work or recovery time.</div>
                </div>
            `;
            return;
        }

        const timingLabel = event.status === 'ongoing'
            ? `Ends ${this.formatRelativeMinutes(event.minutes_until_end)}`
            : `Starts ${this.formatRelativeMinutes(event.minutes_until_start)}`;
        const supportingLabel = event.status === 'ongoing'
            ? this.formatEventWindow(event)
            : `${this.formatEventWindow(event)}${freeWindowMinutes > 0 ? ` • ${this.formatDurationMinutes(freeWindowMinutes)} free before it starts` : ''}`;
        const relatedTasks = event.related_open_tasks || [];
        const followingEvent = event.following_event || {};

        container.innerHTML = `
            <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:10px;">
                <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                    <div>
                        <div class="item-title">${CoreUI.escapeHtml(event.title)}</div>
                        <div class="item-desc" style="margin-top:4px;">${CoreUI.escapeHtml(timingLabel)}</div>
                    </div>
                    <span class="badge">${CoreUI.escapeHtml(event.status === 'ongoing' ? 'In progress' : 'Next up')}</span>
                </div>
                <div class="item-desc">${CoreUI.escapeHtml(supportingLabel)}</div>
                <div class="item-desc">${CoreUI.escapeHtml(event.location || event.category || 'No location or category set')}</div>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                    ${event.project_name ? `<span class="badge"><i class="ph ph-kanban"></i>${CoreUI.escapeHtml(event.project_name)}</span>` : ''}
                    ${event.goal_title ? `<span class="badge"><i class="ph ph-target"></i>${CoreUI.escapeHtml(event.goal_title)}</span>` : ''}
                    ${event.duration_minutes ? `<span class="badge"><i class="ph ph-timer"></i>${CoreUI.escapeHtml(this.formatDurationMinutes(event.duration_minutes))}</span>` : ''}
                    <span class="badge"><i class="ph ph-stack"></i>${remainingEventsToday} event${remainingEventsToday === 1 ? '' : 's'} left today</span>
                </div>
            </div>
        `;

        if (event.related_open_task_count) {
            container.innerHTML += `
                <div class="compact-item" style="flex-direction:column; align-items:flex-start; gap:8px;">
                    <div class="item-title">Prep pressure</div>
                    <div class="item-desc">${event.related_open_task_count} open task${event.related_open_task_count === 1 ? '' : 's'} linked to this block.</div>
                    ${relatedTasks.map((task) => `
                        <div style="display:flex; justify-content:space-between; width:100%; gap:12px;">
                            <span class="item-desc" style="color:var(--text-primary);">${CoreUI.escapeHtml(task.title)}</span>
                            <span class="badge">${CoreUI.escapeHtml(this.focusReasonLabel(this.deriveTaskUrgency(task)) || 'Task')}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (followingEvent?.title) {
            const bufferLabel = event.buffer_after_minutes != null
                ? this.formatDurationMinutes(event.buffer_after_minutes)
                : 'No buffer data';
            container.innerHTML += `
                <div class="compact-item" style="justify-content:space-between; gap:12px;">
                    <div>
                        <div class="item-desc">After this</div>
                        <div class="item-title" style="margin-top:4px;">${CoreUI.escapeHtml(followingEvent.title)}</div>
                    </div>
                    <span class="badge">${CoreUI.escapeHtml(bufferLabel)} buffer</span>
                </div>
            `;
        }
    },

    buildTodayHeadline(todayPayload, primaryFocus, currentEvent) {
        const overdue = Number(todayPayload?.overdue_tasks || 0);
        const dueToday = Number(todayPayload?.due_today || 0);
        const openHabits = Number(todayPayload?.open_habits || 0);
        const followUps = Number(todayPayload?.follow_ups_due || 0);

        if (overdue > 0 && primaryFocus?.title) {
            return {
                title: 'Overdue pressure first',
                message: `Start with ${primaryFocus.title}. Clearing late work will reduce noise faster than opening anything new.`
            };
        }
        if (currentEvent?.id) {
            return {
                title: 'Protect the current block',
                message: `${currentEvent.title} is already running. Finish the block cleanly before context-switching into other work.`
            };
        }
        if (primaryFocus?.title) {
            return {
                title: 'Best next move is clear',
                message: `${primaryFocus.title} is the strongest next action based on due date, priority, and current backlog pressure.`
            };
        }
        if (openHabits > 0 || followUps > 0 || dueToday > 0) {
            return {
                title: 'Light admin pressure remains',
                message: 'Your main task queue is quiet, but habits, follow-ups, or today deadlines still need closing out.'
            };
        }
        return {
            title: 'Low-friction day state',
            message: 'Nothing critical is surfacing. Use this space for proactive project work instead of reactive cleanup.'
        };
    },

    describeFocusTask(task) {
        const parts = [];
        if (task.project_name) parts.push(task.project_name);
        if (task.due_date) parts.push(`Due ${CoreUI.formatDate(task.due_date)}`);
        if (task.estimated_minutes) parts.push(`${task.estimated_minutes} min`);
        if (task.status === 'in_progress') parts.push('Already in progress');
        return parts.join(' • ') || 'No date or estimate set';
    },

    focusReasonLabel(reason) {
        const labels = {
            overdue: 'Overdue',
            due_today: 'Due today',
            in_progress: 'In progress',
            high_priority: 'High priority',
            backlog: 'Backlog'
        };
        return labels[reason] || 'Focus';
    },

    deriveTaskUrgency(task) {
        const dueDate = task?.due_date ? new Date(task.due_date) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (dueDate) {
            const dueDay = new Date(dueDate);
            dueDay.setHours(0, 0, 0, 0);
            if (dueDay < today) return 'overdue';
            if (dueDay.getTime() === today.getTime()) return 'due_today';
        }
        if (task?.status === 'in_progress') return 'in_progress';
        if (Number(task?.priority || 3) <= 2) return 'high_priority';
        return 'backlog';
    },

    formatRelativeMinutes(minutes) {
        if (minutes == null) return 'soon';
        if (minutes <= 0) return 'now';
        if (minutes < 60) return `in ${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remainder = minutes % 60;
        return remainder ? `in ${hours}h ${remainder}m` : `in ${hours}h`;
    },

    formatDurationMinutes(minutes) {
        const safe = Math.max(0, Number(minutes || 0));
        const hours = Math.floor(safe / 60);
        const remainder = safe % 60;
        if (!hours) return `${remainder} min`;
        if (!remainder) return `${hours}h`;
        return `${hours}h ${remainder}m`;
    },

    formatEventWindow(event) {
        const start = event?.start_at ? new Date(event.start_at) : null;
        const end = event?.end_at ? new Date(event.end_at) : null;
        if (!start || Number.isNaN(start.getTime())) return 'Time not set';
        const formatTime = (value) => value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        if (!end || Number.isNaN(end.getTime())) return formatTime(start);
        return `${formatTime(start)}-${formatTime(end)}`;
    },

    renderTasks(tasks) {
        const taskList = document.getElementById('priority-tasks-list');
        if (!taskList) return;
        taskList.innerHTML = '';
        const topTasks = [...tasks].sort((a, b) => a.priority - b.priority).slice(0, 9);
        if (topTasks.length === 0) {
            CoreUI.setEmptyState(taskList, 'No active tasks.', 3);
            return;
        }

        topTasks.forEach((task) => {
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.gap = '8px';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%; gap:12px; align-items:flex-start;">
                    <span class="item-title" style="flex:1;">${CoreUI.escapeHtml(task.title)}</span>
                    ${CoreUI.getPriorityLabel(task.priority)}
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; align-items:center; margin-top:4px;">
                    <span class="item-desc">${task.due_date ? `Due ${CoreUI.escapeHtml(CoreUI.formatDate(task.due_date))}` : 'No due date'}</span>
                    <select class="form-control form-control-compact" onchange="DashboardUI.changeTaskStatus(${task.id}, this.value)">
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>Not started</option>
                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>In progress</option>
                        <option value="on_hold" ${task.status === 'on_hold' ? 'selected' : ''}>On hold</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
            `;
            taskList.appendChild(div);
        });
    },

    async changeTaskStatus(taskId, newStatus) {
        try {
            await API.put(`/api/tasks/${taskId}`, { status: newStatus });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update task status.');
            await this.loadData();
        }
    },

    renderProjects(projects) {
        const activeProjects = projects.filter((project) => !['completed', 'archived'].includes(project.status)).slice(0, 6);
        const projectList = document.getElementById('current-projects-list');
        if (!projectList) return;
        projectList.innerHTML = '';
        if (activeProjects.length === 0) {
            CoreUI.setEmptyState(projectList, 'No active projects.');
            return;
        }

        activeProjects.forEach((project) => {
            const nextAction = project.next_action;
            const nextActionLabel = nextAction
                ? `${nextAction.kind === 'milestone' ? 'Stage' : 'Task'}: ${nextAction.title}`
                : 'No next action set';
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start';
            div.style.gap = '8px';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; width:100%;">
                    <span class="item-title">${CoreUI.escapeHtml(project.name)}</span>
                    <span class="item-desc" style="font-weight:bold; color:var(--text-primary);">${project.progress}%</span>
                </div>
                <div class="progress-track" style="width:100%;">
                    <div class="progress-fill" style="width:${project.progress}%;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; width:100%; font-size:0.8rem; color:var(--text-secondary);">
                    <span>${project.completed_task_count}/${project.task_count} tasks</span>
                    <span>${project.health.replace('_', ' ')}</span>
                </div>
                <div class="item-desc" style="display:flex; align-items:center; gap:6px; width:100%;">
                    <i class="ph ph-lightning"></i>
                    <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(nextActionLabel)}</span>
                </div>
                ${project.resource_count ? `<span class="badge"><i class="ph ph-paperclip"></i>${project.resource_count} resources</span>` : ''}
            `;
            projectList.appendChild(div);
        });
    },

    renderHabits(habits) {
        const habitList = document.getElementById('daily-habits-list');
        if (!habitList) return;
        habitList.innerHTML = '';
        if (habits.length === 0) {
            CoreUI.setEmptyState(habitList, 'No active protocols.');
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        habits.slice(0, 8).forEach((habit) => {
            const isCompleted = habit.today_status === 'completed';
            const checkClass = isCompleted ? 'checked' : '';
            const icon = isCompleted ? '<i class="ph-bold ph-check"></i>' : '';
            const div = document.createElement('div');
            div.className = 'compact-item';
            div.style.alignItems = 'center';
            div.style.justifyContent = 'space-between';
            div.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px; flex:1;">
                    <button class="tick-box ${checkClass}" onclick="DashboardUI.toggleHabit(${habit.id}, '${todayStr}', ${isCompleted})" style="margin:0; width:24px; height:24px; flex-shrink:0;">
                        ${icon}
                    </button>
                    <span class="item-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${CoreUI.escapeHtml(habit.name)}</span>
                </div>
                <span class="badge">${habit.current_streak}</span>
            `;
            habitList.appendChild(div);
        });
    },

    async toggleHabit(id, date, isCurrentlyChecked) {
        try {
            const newStatus = isCurrentlyChecked ? 'skipped' : 'completed';
            await API.post(`/api/habits/${id}/log`, { date, status: newStatus });
            await this.loadData();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to log habit.');
        }
    },

    populateQuickAddRelations() {
        const projectSelect = document.getElementById('dashboard-quick-project');
        const goalSelect = document.getElementById('dashboard-quick-goal');
        const mealPresetSelect = document.getElementById('dashboard-quick-meal-preset');

        if (projectSelect) {
            const current = projectSelect.value;
            projectSelect.innerHTML = '<option value="">No project</option>';
            this.projects.forEach((project) => {
                projectSelect.innerHTML += `<option value="${project.id}">${CoreUI.escapeHtml(project.name)}</option>`;
            });
            projectSelect.value = current;
        }

        if (goalSelect) {
            const current = goalSelect.value;
            goalSelect.innerHTML = '<option value="">No goal</option>';
            this.goals.forEach((goal) => {
                goalSelect.innerHTML += `<option value="${goal.id}">${CoreUI.escapeHtml(goal.title)}</option>`;
            });
            goalSelect.value = current;
        }

        if (mealPresetSelect) {
            const current = mealPresetSelect.value;
            mealPresetSelect.innerHTML = this.foodPresets.length
                ? '<option value="">Select a preset food</option>'
                : '<option value="">No preset foods available</option>';
            this.foodPresets.forEach((preset) => {
                mealPresetSelect.innerHTML += `<option value="${preset.id}">${CoreUI.escapeHtml(preset.name)} - ${CoreUI.escapeHtml(preset.serving_label || 'serving')}</option>`;
            });
            mealPresetSelect.value = current;
        }
    },

    openQuickAddModal() {
        const form = document.getElementById('dashboard-quick-add-form');
        if (form) form.reset();
        this.populateQuickAddRelations();
        this.setQuickAddDefaults();
        this.changeQuickAddType();
        document.getElementById('dashboard-quick-add-modal').style.display = 'flex';
    },

    openQuickAdd() {
        this.openQuickAddModal();
    },

    closeQuickAddModal() {
        document.getElementById('dashboard-quick-add-modal').style.display = 'none';
    },

    setQuickAddDefaults() {
        const now = new Date();
        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
        const end = new Date(now.getTime() + (60 * 60 * 1000));
        const toLocal = (date) => {
            const pad = (value) => String(value).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        };
        const today = toLocal(now).slice(0, 10);
        const due = document.getElementById('dashboard-quick-due');
        const start = document.getElementById('dashboard-quick-start');
        const eventEnd = document.getElementById('dashboard-quick-end');
        const targetDate = document.getElementById('dashboard-quick-date');
        const healthDate = document.getElementById('dashboard-quick-health-date');
        const mealDate = document.getElementById('dashboard-quick-meal-date');
        const financeDate = document.getElementById('dashboard-quick-finance-date');
        const reviewStart = document.getElementById('dashboard-quick-review-start');
        const mealServings = document.getElementById('dashboard-quick-meal-servings');
        const mood = document.getElementById('dashboard-quick-mood');
        const habitTarget = document.getElementById('dashboard-quick-habit-target');
        if (due) due.value = toLocal(now);
        if (start) start.value = toLocal(now);
        if (eventEnd) eventEnd.value = toLocal(end);
        if (targetDate) targetDate.value = today;
        if (healthDate) healthDate.value = today;
        if (mealDate) mealDate.value = today;
        if (financeDate) financeDate.value = today;
        if (reviewStart) reviewStart.value = today;
        if (mealServings) mealServings.value = '1';
        if (mood) mood.value = '5';
        if (habitTarget) habitTarget.value = '0';
    },

    changeQuickAddType() {
        const type = document.getElementById('dashboard-quick-add-type')?.value || 'task';
        document.querySelectorAll('.quick-add-field').forEach((field) => {
            const types = (field.dataset.types || '').split(/\s+/);
            field.style.display = types.includes(type) ? '' : 'none';
        });

        this.updateQuickAddLabels(type);
        this.updateQuickAddRequirements(type);

        const submit = document.getElementById('dashboard-quick-submit');
        if (submit) {
            submit.textContent = `Create ${this.quickAddLabel(type)}`;
        }
    },

    quickAddLabel(type) {
        const labels = {
            task: 'Task',
            habit: 'Habit',
            event: 'Event',
            project: 'Project',
            goal: 'Goal',
            note: 'Note',
            journal: 'Journal Entry',
            resource: 'Resource',
            health: 'Health Log',
            meal: 'Meal',
            finance: 'Finance Entry',
            contact: 'Contact',
            review: 'Life Review',
            library: 'Library Item',
            work: 'Work Experience'
        };
        return labels[type] || 'Item';
    },

    quickAddTitleMeta(type) {
        const config = {
            task: { label: 'Title', placeholder: 'Task title' },
            habit: { label: 'Name', placeholder: 'Habit name' },
            event: { label: 'Title', placeholder: 'Event title' },
            project: { label: 'Title', placeholder: 'Project title' },
            goal: { label: 'Title', placeholder: 'Goal title' },
            note: { label: 'Title', placeholder: 'Note title' },
            journal: { label: 'Title', placeholder: 'Optional title' },
            resource: { label: 'Title', placeholder: 'Resource title' },
            finance: { label: 'Description', placeholder: 'What was this for?' },
            contact: { label: 'Name', placeholder: 'Contact name' },
            library: { label: 'Title', placeholder: 'Book, show, or movie title' },
            work: { label: 'Role Title', placeholder: 'Role title' }
        };
        return config[type] || { label: 'Title', placeholder: `${this.quickAddLabel(type)} title` };
    },

    quickAddNotesMeta(type) {
        const config = {
            task: { label: 'Notes', placeholder: 'Extra detail, scope, or constraints' },
            habit: { label: 'Description', placeholder: 'Why this habit matters or how to track it' },
            event: { label: 'Description', placeholder: 'Agenda, prep, or context' },
            project: { label: 'Notes', placeholder: 'Scope, constraints, or delivery notes' },
            goal: { label: 'Notes', placeholder: 'Why it matters and how you will approach it' },
            note: { label: 'Content', placeholder: 'Quick note content' },
            journal: { label: 'Entry', placeholder: 'Observation, reflection, or event details' },
            resource: { label: 'Notes', placeholder: 'Why you saved this' },
            health: { label: 'Notes', placeholder: 'Recovery notes, context, or observations' },
            meal: { label: 'Notes', placeholder: 'Meal notes or context' },
            contact: { label: 'Notes', placeholder: 'Context, reminders, or relationship notes' },
            library: { label: 'Notes', placeholder: 'Arc notes, favorite moments, or next step' },
            work: { label: 'Notes', placeholder: 'Context, responsibilities, outcomes, or reminders' }
        };
        return config[type] || { label: 'Notes', placeholder: '' };
    },

    updateQuickAddLabels(type) {
        const titleConfig = this.quickAddTitleMeta(type);
        const titleLabel = document.getElementById('dashboard-quick-title-label');
        const titleInput = document.getElementById('dashboard-quick-title');
        const notesConfig = this.quickAddNotesMeta(type);
        const notesLabel = document.getElementById('dashboard-quick-notes-label');
        const notesInput = document.getElementById('dashboard-quick-notes');

        if (titleLabel) titleLabel.textContent = titleConfig.label;
        if (titleInput) titleInput.placeholder = titleConfig.placeholder;
        if (notesLabel) notesLabel.textContent = notesConfig.label;
        if (notesInput) notesInput.placeholder = notesConfig.placeholder;
    },

    updateQuickAddRequirements(type) {
        document.querySelectorAll('#dashboard-quick-add-form input, #dashboard-quick-add-form select, #dashboard-quick-add-form textarea').forEach((field) => {
            if (field.type !== 'hidden') {
                field.required = false;
            }
        });

        const requiredByType = {
            task: ['dashboard-quick-title'],
            habit: ['dashboard-quick-title'],
            event: ['dashboard-quick-title', 'dashboard-quick-start', 'dashboard-quick-end'],
            project: ['dashboard-quick-title'],
            goal: ['dashboard-quick-title'],
            journal: ['dashboard-quick-notes'],
            resource: ['dashboard-quick-title', 'dashboard-quick-url'],
            health: ['dashboard-quick-health-date'],
            meal: ['dashboard-quick-meal-date', 'dashboard-quick-meal-preset', 'dashboard-quick-meal-servings'],
            finance: ['dashboard-quick-finance-date', 'dashboard-quick-finance-amount'],
            contact: ['dashboard-quick-title'],
            review: ['dashboard-quick-review-start'],
            library: ['dashboard-quick-title'],
            work: ['dashboard-quick-title', 'dashboard-quick-work-organization']
        };

        (requiredByType[type] || []).forEach((id) => {
            const field = document.getElementById(id);
            if (field) field.required = true;
        });
    },

    intOrNull(id) {
        const value = document.getElementById(id)?.value;
        if (value == null || value === '') return null;
        const parsed = parseInt(value, 10);
        return Number.isNaN(parsed) ? null : parsed;
    },

    valueOrNull(id) {
        const value = document.getElementById(id)?.value;
        return value === '' || value == null ? null : Number(value);
    },

    valueOrBlank(id) {
        return document.getElementById(id)?.value || '';
    },

    valueOrNullDate(id) {
        return document.getElementById(id)?.value || null;
    },

    async submitQuickAdd(event) {
        event.preventDefault();
        const type = document.getElementById('dashboard-quick-add-type').value;
        const title = this.valueOrBlank('dashboard-quick-title').trim();
        const notes = this.valueOrBlank('dashboard-quick-notes').trim();

        try {
            if (type === 'task') {
                await API.post('/api/tasks/', {
                    title,
                    description: notes,
                    priority: parseInt(document.getElementById('dashboard-quick-priority').value, 10),
                    due_date: document.getElementById('dashboard-quick-due').value || null,
                    estimated_minutes: this.intOrNull('dashboard-quick-estimate'),
                    project_id: this.intOrNull('dashboard-quick-project'),
                    goal_id: this.intOrNull('dashboard-quick-goal')
                });
            } else if (type === 'habit') {
                await API.post('/api/habits/', {
                    name: title,
                    category: this.valueOrBlank('dashboard-quick-habit-category'),
                    frequency: 'daily',
                    target_streak: this.intOrNull('dashboard-quick-habit-target') || 0,
                    description: notes
                });
            } else if (type === 'event') {
                await API.post('/api/calendar/events', {
                    title,
                    description: notes,
                    category: document.getElementById('dashboard-quick-category').value || 'general',
                    location: document.getElementById('dashboard-quick-location').value,
                    start_at: document.getElementById('dashboard-quick-start').value,
                    end_at: document.getElementById('dashboard-quick-end').value,
                    project_id: this.intOrNull('dashboard-quick-project'),
                    goal_id: this.intOrNull('dashboard-quick-goal'),
                    sync_task: document.getElementById('dashboard-quick-sync-task')?.checked !== false
                });
            } else if (type === 'project') {
                await API.post('/api/projects/', {
                    name: title,
                    description: notes,
                    deadline: document.getElementById('dashboard-quick-date').value || null,
                    status: 'planning'
                });
            } else if (type === 'goal') {
                await API.post('/api/goals/', {
                    title,
                    notes,
                    type: document.getElementById('dashboard-quick-goal-type').value,
                    target_date: document.getElementById('dashboard-quick-date').value || null
                });
            } else if (type === 'note') {
                await API.post('/api/notes/', {
                    title: title || 'Untitled Note',
                    content: notes,
                    tags: document.getElementById('dashboard-quick-tags').value
                });
            } else if (type === 'journal') {
                await API.post('/api/journal/', {
                    title,
                    content: notes || title || 'New entry',
                    tags: document.getElementById('dashboard-quick-tags').value,
                    mood_score: this.intOrNull('dashboard-quick-mood') || 5
                });
            } else if (type === 'resource') {
                await API.post('/api/life/attachments', {
                    entity_type: this.intOrNull('dashboard-quick-project') ? 'project' : 'general',
                    entity_id: this.intOrNull('dashboard-quick-project'),
                    title,
                    url: document.getElementById('dashboard-quick-url').value,
                    notes,
                    is_favorite: document.getElementById('dashboard-quick-favorite').checked
                });
            } else if (type === 'health') {
                await API.post('/api/life/health', {
                    log_date: this.valueOrNullDate('dashboard-quick-health-date'),
                    sleep_hours: this.valueOrNull('dashboard-quick-health-sleep'),
                    weight_kg: this.valueOrNull('dashboard-quick-health-weight'),
                    exercise_minutes: this.intOrNull('dashboard-quick-health-exercise'),
                    energy_score: this.intOrNull('dashboard-quick-health-energy'),
                    symptoms: this.valueOrBlank('dashboard-quick-health-symptoms'),
                    notes
                });
            } else if (type === 'meal') {
                await API.post('/api/life/diet', {
                    entry_date: this.valueOrNullDate('dashboard-quick-meal-date'),
                    preset_id: this.intOrNull('dashboard-quick-meal-preset'),
                    meal_type: this.valueOrBlank('dashboard-quick-meal-type') || 'snack',
                    servings: this.valueOrNull('dashboard-quick-meal-servings'),
                    notes
                });
            } else if (type === 'finance') {
                await API.post('/api/life/finance', {
                    entry_date: this.valueOrNullDate('dashboard-quick-finance-date'),
                    type: this.valueOrBlank('dashboard-quick-finance-type') || 'expense',
                    category: this.valueOrBlank('dashboard-quick-finance-category'),
                    amount: this.valueOrNull('dashboard-quick-finance-amount'),
                    description: title,
                    is_recurring: document.getElementById('dashboard-quick-finance-recurring').checked
                });
            } else if (type === 'contact') {
                await API.post('/api/life/contacts', {
                    name: title,
                    relation: this.valueOrBlank('dashboard-quick-contact-relation'),
                    priority: this.valueOrBlank('dashboard-quick-contact-priority') || 'normal',
                    last_contacted: this.valueOrNullDate('dashboard-quick-contact-last'),
                    next_follow_up: this.valueOrNullDate('dashboard-quick-contact-next'),
                    notes
                });
            } else if (type === 'review') {
                await API.post('/api/life/reviews', {
                    period_type: this.valueOrBlank('dashboard-quick-review-type') || 'weekly',
                    period_start: this.valueOrNullDate('dashboard-quick-review-start'),
                    score: this.intOrNull('dashboard-quick-review-score'),
                    wins: this.valueOrBlank('dashboard-quick-review-wins'),
                    challenges: this.valueOrBlank('dashboard-quick-review-challenges'),
                    next_focus: this.valueOrBlank('dashboard-quick-review-focus')
                });
            } else if (type === 'library') {
                await API.post('/api/library/items', {
                    title,
                    media_type: this.valueOrBlank('dashboard-quick-library-type') || 'book',
                    status: this.valueOrBlank('dashboard-quick-library-status') || 'want_to_start',
                    creator: this.valueOrBlank('dashboard-quick-library-creator'),
                    platform: this.valueOrBlank('dashboard-quick-library-platform'),
                    current_unit: this.intOrNull('dashboard-quick-library-current'),
                    total_units: this.intOrNull('dashboard-quick-library-total'),
                    score: this.intOrNull('dashboard-quick-library-score'),
                    started_on: this.valueOrNullDate('dashboard-quick-library-started'),
                    completed_on: this.valueOrNullDate('dashboard-quick-library-completed'),
                    notes
                });
            } else if (type === 'work') {
                await API.post('/api/work/experiences', {
                    title,
                    organization: this.valueOrBlank('dashboard-quick-work-organization'),
                    experience_type: this.valueOrBlank('dashboard-quick-work-type') || 'job',
                    status: this.valueOrBlank('dashboard-quick-work-status') || 'saved',
                    location: this.valueOrBlank('dashboard-quick-work-location'),
                    start_date: this.valueOrNullDate('dashboard-quick-work-start'),
                    end_date: this.valueOrNullDate('dashboard-quick-work-end'),
                    hours_per_week: this.intOrNull('dashboard-quick-work-hours'),
                    skills: '',
                    responsibilities: '',
                    achievements: '',
                    application_url: this.valueOrBlank('dashboard-quick-work-url'),
                    notes
                });
            }

            this.closeQuickAddModal();
            await this.loadData();
            CoreUI.showError(`${this.quickAddLabel(type)} created.`, true);
        } catch (error) {
            CoreUI.showError(error.message || `Failed to create ${this.quickAddLabel(type).toLowerCase()}.`);
        }
    },

    initHabitChart(habitsMonthly) {
        const ctx = document.getElementById('habitChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.habitChartInstance);
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        const labels = habitsMonthly.map((habit) => habit.name.length > 15 ? `${habit.name.substring(0, 15)}...` : habit.name);
        const elapsedData = habitsMonthly.map((habit) => habit.completion_rate);
        const fullMonthData = habitsMonthly.map((habit) => habit.full_completion_rate ?? habit.completion_rate);
        this.habitChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Elapsed Month',
                        data: elapsedData,
                        backgroundColor: 'rgba(0, 240, 255, 0.8)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        borderRadius: 4
                    },
                    {
                        label: 'Full Month',
                        data: fullMonthData,
                        backgroundColor: 'rgba(255, 0, 255, 0.45)',
                        borderColor: '#ff00ff',
                        borderWidth: 1,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                    y: { beginAtZero: true, max: 100, grid: { color: '#1f1f22' }, ticks: { callback: (value) => `${value}%` } },
                    x: { grid: { display: false } }
                }
            }
        });
    },

    initTaskChart(taskAnalytics) {
        const ctx = document.getElementById('taskChart');
        if (!ctx) return;
        CoreUI.destroyChart(this.taskChartInstance);
        Chart.defaults.color = '#a1a1aa';
        Chart.defaults.borderColor = '#1f1f22';
        Chart.defaults.font.family = '"JetBrains Mono", monospace';
        this.taskChartInstance = new Chart(ctx, {
            data: {
                labels: taskAnalytics?.labels || [],
                datasets: [
                    {
                        type: 'bar',
                        label: 'Active task output',
                        data: taskAnalytics?.completed || [],
                        backgroundColor: 'rgba(0, 240, 255, 0.45)',
                        borderColor: '#00f0ff',
                        borderWidth: 1,
                        yAxisID: 'yTasks'
                    },
                    {
                        type: 'line',
                        label: `Share of Active${taskAnalytics?.total_tasks ? ` (${taskAnalytics.total_tasks})` : ''}`,
                        data: taskAnalytics?.share_of_total || [],
                        borderColor: '#ff00ff',
                        borderWidth: 2,
                        backgroundColor: 'rgba(255, 0, 255, 0.1)',
                        pointBackgroundColor: '#ff00ff',
                        pointBorderColor: '#000',
                        pointBorderWidth: 2,
                        pointRadius: 3,
                        tension: 0.3,
                        yAxisID: 'yShare'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: {
                    yTasks: { beginAtZero: true, precision: 0, grid: { color: '#1f1f22' } },
                    yShare: {
                        beginAtZero: true,
                        max: 100,
                        position: 'right',
                        grid: { display: false },
                        ticks: { callback: (value) => `${value}%` }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    DashboardUI.loadData().then(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('quick_add') === '1') {
            DashboardUI.openQuickAdd();
            params.delete('quick_add');
            const nextQuery = params.toString();
            const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
            window.history.replaceState({}, '', nextUrl);
        }
    });
});
