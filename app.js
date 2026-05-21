const STORAGE_KEY = 'ar_system_core_data';

const initialData = {
    habits: [
        { id: 1, name: 'Architectural Study', streak: 12, history: Array(7).fill(true) },
        { id: 2, name: 'Algorithm Refinement', streak: 5, history: [true, false, true, true, true, true, true] },
        { id: 3, name: 'Physical Conditioning', streak: 45, history: Array(7).fill(true) }
    ],
    tasks: [
        { id: 1, title: 'Implement Kanban Drag & Drop', status: 'progress', prio: 'high', project: 'Console V1' },
        { id: 2, title: 'Design Database Schema', status: 'backlog', prio: 'med', project: 'Amnesic OS' },
        { id: 3, title: 'Write Chapter 1 Draft', status: 'review', prio: 'low', project: 'Light Novel' },
        { id: 4, title: 'Setup LocalStorage Module', status: 'completed', prio: 'high', project: 'Console V1' }
    ],
    schedule: [
        { id: 1, time: '07:00 - 08:30', activity: 'Deep Work: System Architecture' },
        { id: 2, time: '09:00 - 12:00', activity: 'Execution: Code Writing' },
        { id: 3, time: '13:00 - 14:00', activity: 'Physical Maintenance (Gym)' },
        { id: 4, time: '15:00 - 18:00', activity: 'Exploration / Learning' }
    ],
    directives: [
        { 
            id: 1, 
            title: 'Absolute Financial Autonomy', 
            desc: 'Automate income streams to completely divorce time from capital generation, buying ultimate freedom to build.',
            milestones: [
                { text: 'Launch first SaaS prototype', achieved: true },
                { text: 'Achieve $1k MRR', achieved: false },
                { text: 'Establish legal corporate structure', achieved: false }
            ]
        },
        { 
            id: 2, 
            title: 'Polymath Mastery', 
            desc: 'Complete mastery of CS, Robotics, and Philosophical Writing.',
            milestones: [
                { text: 'Master Full-Stack Systems', achieved: true },
                { text: 'Publish Philosophical Light Novel', achieved: false },
                { text: 'Build functional autonomous robot', achieved: false }
            ]
        }
    ],
    repository: [
        { id: 1, title: 'Amnesic OS: Memory Management', cat: 'Architecture', date: '2026-05-21', preview: 'The OS must forget aggressively to prioritize computational focus...' },
        { id: 2, title: 'Zyn Magic System Physics', cat: 'Worldbuilding', date: '2026-05-19', preview: 'Grounding metaphysical constraints in thermodynamic laws...' },
        { id: 3, title: 'The Perfectionist Paradox', cat: 'Philosophy', date: '2026-05-10', preview: 'Analyzing the activation energy barrier created by uncompromising standards.' }
    ]
};

let sysData = JSON.parse(localStorage.getItem(STORAGE_KEY)) || initialData;
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(sysData)); }

// Navigation
const navLinks = document.querySelectorAll('.nav-links li');
const modules = document.querySelectorAll('.module');

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        navLinks.forEach(l => l.classList.remove('active'));
        modules.forEach(m => m.classList.remove('active'));
        link.classList.add('active');
        const targetId = link.getAttribute('data-target');
        document.getElementById(targetId).classList.add('active');
        renderSpecific(targetId);
    });
});

function renderSpecific(targetId) {
    if(targetId === 'dashboard') { renderDashboard(); }
    if(targetId === 'planner') { renderSchedule(); }
    if(targetId === 'habits') { renderHabits(); }
    if(targetId === 'projects') { renderKanban(); }
    if(targetId === 'directives') { renderDirectives(); }
    if(targetId === 'repository') { renderRepository(); }
}

// Render Functions
function renderDashboard() {
    // Tasks
    const dashTasks = document.getElementById('dash-tasks');
    dashTasks.innerHTML = '';
    sysData.tasks.filter(t => t.status !== 'completed' && t.prio === 'high').forEach(t => {
        dashTasks.innerHTML += `<li><span>${t.title}</span> <span style="color:var(--warning)">[${t.project}]</span></li>`;
    });

    // Projects overview
    const dashProjects = document.getElementById('dash-projects');
    dashProjects.innerHTML = '';
    const projects = [...new Set(sysData.tasks.map(t => t.project))];
    projects.forEach(p => {
        const pTasks = sysData.tasks.filter(t => t.project === p);
        const comp = pTasks.filter(t => t.status === 'completed').length;
        const prog = Math.round((comp / pTasks.length) * 100) || 0;
        dashProjects.innerHTML += `
            <div class="dash-project-mini">
                <h4>${p}</h4>
                <div class="status">Completion: ${prog}%</div>
                <div class="progress-bar" style="margin-top:5px;"><div class="fill" style="width: ${prog}%;"></div></div>
            </div>
        `;
    });
    updateDashChart();
}

function renderSchedule() {
    const tl = document.getElementById('daily-timeline');
    tl.innerHTML = '';
    sysData.schedule.sort((a,b) => a.time.localeCompare(b.time)).forEach(s => {
        tl.innerHTML += `
            <div class="time-block">
                <div class="time">${s.time}</div>
                <div class="activity">${s.activity}</div>
            </div>
        `;
    });
}

function renderHabits() {
    const list = document.getElementById('habit-tracker-list');
    list.innerHTML = '';
    sysData.habits.forEach((h, i) => {
        const isTicked = h.history[h.history.length - 1];
        list.innerHTML += `
            <div class="habit-item">
                <div class="habit-info">
                    <span class="habit-name">${h.name}</span>
                    <span class="habit-streak">Streak: ${h.streak} Days</span>
                </div>
                <div class="habit-actions">
                    <button class="tick-btn ${isTicked ? 'ticked' : ''}" onclick="toggleHabit(${i})">
                        <i class="fa-solid fa-check"></i>
                    </button>
                </div>
            </div>
        `;
    });
    updateHabitChart();
}

function renderKanban() {
    const cols = ['backlog', 'progress', 'review', 'completed'];
    cols.forEach(c => document.getElementById(`kb-${c}`).innerHTML = '');
    
    sysData.tasks.forEach(t => {
        const el = document.createElement('div');
        el.className = `kanban-task task-prio-${t.prio}`;
        el.innerHTML = `
            <h4>${t.title}</h4>
            <div class="meta">
                <span><i class="fa-solid fa-folder"></i> ${t.project}</span>
                <span style="text-transform: uppercase;">${t.prio}</span>
            </div>
        `;
        document.getElementById(`kb-${t.status}`).appendChild(el);
    });
}

function renderDirectives() {
    const cont = document.getElementById('directives-container');
    cont.innerHTML = '';
    sysData.directives.forEach(d => {
        let miles = '';
        d.milestones.forEach(m => {
            miles += `<li class="${m.achieved ? 'achieved' : ''}">${m.text}</li>`;
        });
        cont.innerHTML += `
            <div class="directive-card">
                <h2>${d.title}</h2>
                <div class="description">${d.desc}</div>
                <ul class="milestone-list">${miles}</ul>
            </div>
        `;
    });
}

function renderRepository() {
    const cont = document.getElementById('repo-container');
    cont.innerHTML = '';
    sysData.repository.forEach(r => {
        cont.innerHTML += `
            <div class="card note-card">
                <span class="category">${r.cat}</span>
                <h3>${r.title}</h3>
                <p class="date">${r.date}</p>
                <p style="color: var(--text-muted); font-size: 0.9rem;">${r.preview}</p>
            </div>
        `;
    });
}

// Interactions
window.toggleHabit = function(index) {
    const h = sysData.habits[index];
    const len = h.history.length;
    h.history[len - 1] = !h.history[len - 1];
    if(h.history[len-1]) h.streak++; else h.streak = Math.max(0, h.streak-1);
    saveData();
    renderHabits();
    if(document.getElementById('dashboard').classList.contains('active')) renderDashboard();
};

// Charts
Chart.defaults.color = '#888899';
Chart.defaults.font.family = "'Consolas', 'Courier New', monospace";
let dashChart, habChart;

function getHabitData() {
    const data = [0,0,0,0,0,0,0];
    sysData.habits.forEach(h => h.history.forEach((t, i) => { if(t) data[i]++; }));
    return data;
}

function updateDashChart() {
    const ctx = document.getElementById('dashHabitChart');
    if(!ctx) return;
    if(dashChart) dashChart.destroy();
    dashChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['D1','D2','D3','D4','D5','D6','Today'],
            datasets: [{ label: 'Protocols', data: getHabitData(), borderColor: '#00ffcc', backgroundColor: 'rgba(0, 255, 204, 0.1)', fill: true, tension: 0.3 }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#333340' } }, x: { grid: { color: '#333340' } } } }
    });
}

function updateHabitChart() {
    const ctx = document.getElementById('habitDetailChart');
    if(!ctx) return;
    if(habChart) habChart.destroy();
    const max = sysData.habits.length || 1;
    habChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['D1','D2','D3','D4','D5','D6','Today'],
            datasets: [{ label: 'Efficiency %', data: getHabitData().map(d => (d/max)*100), backgroundColor: '#00ffcc' }]
        },
        options: { scales: { y: { beginAtZero: true, max: 100, grid: { color: '#333340' } }, x: { grid: { color: '#333340' } } } }
    });
}

// Modals
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-dynamic-body');
let currentAction = null;

function openModal(title, type) {
    modalTitle.innerText = title;
    currentAction = type;
    modalBody.innerHTML = '';
    
    if(type === 'habit') {
        modalBody.innerHTML = `<input type="text" id="m-name" class="input-field" placeholder="Protocol Designation...">`;
    } else if (type === 'schedule') {
        modalBody.innerHTML = `
            <input type="text" id="m-time" class="input-field" placeholder="Time (e.g. 19:00 - 21:00)">
            <input type="text" id="m-act" class="input-field" placeholder="Activity Description">
        `;
    } else if (type === 'task') {
        modalBody.innerHTML = `
            <input type="text" id="m-title" class="input-field" placeholder="Task Title">
            <input type="text" id="m-proj" class="input-field" placeholder="Project Tag">
            <select id="m-prio" class="select-field">
                <option value="high">High Priority</option>
                <option value="med">Medium Priority</option>
                <option value="low">Low Priority</option>
            </select>
        `;
    }
    
    modal.classList.remove('hidden');
}

document.getElementById('add-habit-btn').addEventListener('click', () => openModal('Initialize Protocol', 'habit'));
document.getElementById('add-schedule-btn').addEventListener('click', () => openModal('Allocate Time Block', 'schedule'));
document.getElementById('add-project-task-btn').addEventListener('click', () => openModal('Deploy Task', 'task'));

document.getElementById('close-modal').addEventListener('click', () => modal.classList.add('hidden'));
document.getElementById('cancel-modal').addEventListener('click', () => modal.classList.add('hidden'));

document.getElementById('save-modal').addEventListener('click', () => {
    if(currentAction === 'habit') {
        const val = document.getElementById('m-name').value.trim();
        if(val) sysData.habits.push({ id: Date.now(), name: val, streak: 0, history: Array(7).fill(false) });
        renderHabits();
    } else if (currentAction === 'schedule') {
        const time = document.getElementById('m-time').value.trim();
        const act = document.getElementById('m-act').value.trim();
        if(time && act) sysData.schedule.push({ id: Date.now(), time, activity: act });
        renderSchedule();
    } else if (currentAction === 'task') {
        const title = document.getElementById('m-title').value.trim();
        const proj = document.getElementById('m-proj').value.trim();
        const prio = document.getElementById('m-prio').value;
        if(title) sysData.tasks.push({ id: Date.now(), title, project: proj || 'General', prio, status: 'backlog' });
        renderKanban();
    }
    saveData();
    modal.classList.add('hidden');
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    renderDashboard();
    renderSchedule();
    renderHabits();
    renderKanban();
    renderDirectives();
    renderRepository();
});