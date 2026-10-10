const projectId = Number(location.pathname.split('/').pop());
const priorityOrder = { High: 0, Medium: 1, Low: 2 };

let project = null;
let tasks = [];
let statusFilter = 'all';
let priorityFilter = 'all';
let sortBy = 'due';
let editingId = null;

const summary = document.getElementById('summary');
const form = document.getElementById('taskForm');
const formError = document.getElementById('formError');
const taskList = document.getElementById('taskList');
const assigneeSelect = document.getElementById('fAssignee');

function makeEl(tag, className, text) {
    const e = document.createElement(tag);
    if (className) {
        e.className = className;
    }
    if (text !== undefined) {
        e.textContent = text;
    }
    return e;
}

function todayString() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + month + '-' + day;
}

function sortTasks(list) {
    list.sort(function (a, b) {
        const byPriority = priorityOrder[a.priority] - priorityOrder[b.priority];
        let byDue = 0;
        if (a.due_date && !b.due_date) {
            byDue = -1;
        } else if (!a.due_date && b.due_date) {
            byDue = 1;
        } else if (a.due_date && b.due_date) {
            byDue = a.due_date.localeCompare(b.due_date);
        }
        if (sortBy === 'priority') {
            return byPriority || byDue;
        }
        return byDue || byPriority;
    });
}

async function loadTasks() {
    tasks = await App.api('/api/projects/' + projectId + '/tasks');
    drawAll();
}

function drawSummary() {
    let active = 0;
    let done = 0;
    let late = 0;
    const today = todayString();
    for (let i = 0; i < tasks.length; i++) {
        if (tasks[i].done) {
            done++;
        } else {
            active++;
            if (tasks[i].due_date && tasks[i].due_date < today) {
                late++;
            }
        }
    }
    summary.innerHTML = '';
    summary.appendChild(makeEl('span', 'summary-box', App.t('tasksActive') + ': ' + active));
    summary.appendChild(makeEl('span', 'summary-box', App.t('tasksDone') + ': ' + done));
    summary.appendChild(makeEl('span', 'summary-box late', App.t('overdue') + ': ' + late));
}

function makeCard(t) {
    const card = makeEl('div', 'task-card');
    if (t.done) {
        card.classList.add('done');
    }

    const top = makeEl('div', 'task-top');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = t.done;
    check.disabled = !t.canEdit;
    check.addEventListener('change', async function () {
        try {
            await App.api('/api/tasks/' + t.id + '/done', 'PATCH', { done: check.checked });
            await loadTasks();
        } catch (err) {
            alert(err.message);
            check.checked = t.done;
        }
    });
    top.appendChild(check);
    top.appendChild(makeEl('span', 'task-title', t.title));
    top.appendChild(makeEl('span', 'badge ' + t.priority.toLowerCase(), App.t(t.priority)));
    card.appendChild(top);

    if (t.description) {
        card.appendChild(makeEl('p', 'task-desc', t.description));
    }

    const info = makeEl('div', 'task-info');
    if (t.due_date) {
        const dueText = makeEl('span', '', App.t('due') + ': ' + t.due_date);
        if (!t.done && t.due_date < todayString()) {
            dueText.classList.add('late-text');
        }
        info.appendChild(dueText);
    }
    if (project.people.length > 1) {
        info.appendChild(makeEl('span', '', App.t('assignedTo') + ': ' + (t.assignee_name || App.t('nobody'))));
        info.appendChild(makeEl('span', '', App.t('createdBy') + ': ' + (t.creator_name || App.t('unknown'))));
    }
    card.appendChild(info);

    if (t.canEdit || t.canDelete) {
        const buttons = makeEl('div', 'task-buttons');
        if (t.canEdit) {
            const editBtn = makeEl('button', 'small-btn', App.t('editBtn'));
            editBtn.addEventListener('click', function () {
                openForm(t);
            });
            buttons.appendChild(editBtn);
        }
        if (t.canDelete) {
            const deleteBtn = makeEl('button', 'small-btn danger', App.t('delBtn'));
            deleteBtn.addEventListener('click', async function () {
                if (!confirm(App.t('confirmDeleteTask'))) {
                    return;
                }
                try {
                    await App.api('/api/tasks/' + t.id, 'DELETE');
                    await loadTasks();
                } catch (err) {
                    alert(err.message);
                }
            });
            buttons.appendChild(deleteBtn);
        }
        card.appendChild(buttons);
    }
    return card;
}

function makeSection(title, list) {
    const section = makeEl('div', 'task-section');
    section.appendChild(makeEl('h3', '', title + ' (' + list.length + ')'));
    if (list.length === 0) {
        section.appendChild(makeEl('p', 'empty-text', App.t('noTasksHere')));
        return section;
    }
    const box = makeEl('div', 'task-rows');
    for (let i = 0; i < list.length; i++) {
        box.appendChild(makeCard(list[i]));
    }
    section.appendChild(box);
    return section;
}

function drawList() {
    const shown = [];
    for (let i = 0; i < tasks.length; i++) {
        if (priorityFilter !== 'all' && tasks[i].priority !== priorityFilter) {
            continue;
        }
        shown.push(tasks[i]);
    }
    sortTasks(shown);

    const active = shown.filter(function (t) {
        return !t.done;
    });
    const done = shown.filter(function (t) {
        return t.done;
    });

    taskList.innerHTML = '';
    if (statusFilter === 'all' || statusFilter === 'active') {
        taskList.appendChild(makeSection(App.t('tasksActive'), active));
    }
    if (statusFilter === 'all' || statusFilter === 'done') {
        taskList.appendChild(makeSection(App.t('tasksDone'), done));
    }
}

function drawAll() {
    drawSummary();
    drawList();
}

function fillAssignees() {
    assigneeSelect.innerHTML = '';
    const nobody = makeEl('option', '', App.t('nobody'));
    nobody.value = '';
    assigneeSelect.appendChild(nobody);
    for (let i = 0; i < project.people.length; i++) {
        const option = makeEl('option', '', project.people[i].name);
        option.value = project.people[i].id;
        assigneeSelect.appendChild(option);
    }
}

function openForm(t) {
    editingId = t ? t.id : null;
    document.getElementById('formTitle').textContent = t ? App.t('editTaskTitle') : App.t('newTaskTitle');
    document.getElementById('fTitle').value = t ? t.title : '';
    document.getElementById('fDesc').value = t ? t.description : '';
    document.getElementById('fDue').value = t && t.due_date ? t.due_date : '';
    document.getElementById('fPriority').value = t ? t.priority : 'Medium';
    assigneeSelect.value = t && t.assignee_id ? t.assignee_id : '';
    formError.textContent = '';
    form.classList.add('show');
    document.getElementById('fTitle').focus();
}

function closeForm() {
    form.classList.remove('show');
    editingId = null;
}

function drawMembers() {
    const box = document.getElementById('membersList');
    box.innerHTML = '';

    for (let i = 0; i < project.people.length; i++) {
        const person = project.people[i];
        const row = makeEl('div', 'member-row');
        let label = person.name + ' (' + person.email + ')';
        if (person.id === project.owner.id) {
            label = label + ' - ' + App.t('ownerTag');
        }
        row.appendChild(makeEl('span', '', label));

        if (project.is_owner && person.id !== project.owner.id) {
            const btn = makeEl('button', 'small-btn danger', App.t('remove'));
            btn.addEventListener('click', async function () {
                try {
                    await App.api('/api/projects/' + projectId + '/members/' + person.id, 'DELETE');
                    await reloadProject();
                    await loadTasks();
                } catch (err) {
                    alert(err.message);
                }
            });
            row.appendChild(btn);
        }
        box.appendChild(row);
    }

    for (let i = 0; i < project.pending.length; i++) {
        box.appendChild(makeEl('div', 'member-row pending', project.pending[i].name + ' - ' + App.t('pendingInvite')));
    }
}

async function reloadProject() {
    project = await App.api('/api/projects/' + projectId);
    fillAssignees();
    drawMembers();
}

document.getElementById('newTaskBtn').addEventListener('click', function () {
    openForm(null);
});

document.getElementById('cancelBtn').addEventListener('click', closeForm);

form.addEventListener('submit', async function (e) {
    e.preventDefault();
    formError.textContent = '';
    const title = document.getElementById('fTitle').value.trim();
    if (title === '') {
        formError.textContent = App.t('titleRequired');
        return;
    }
    if (title.length > 100) {
        formError.textContent = App.t('titleTooLong');
        return;
    }
    const data = {
        title: title,
        description: document.getElementById('fDesc').value,
        due_date: document.getElementById('fDue').value,
        priority: document.getElementById('fPriority').value,
        assignee_id: assigneeSelect.value,
    };
    try {
        if (editingId) {
            await App.api('/api/tasks/' + editingId, 'PUT', data);
        } else {
            await App.api('/api/projects/' + projectId + '/tasks', 'POST', data);
        }
        closeForm();
        await loadTasks();
    } catch (err) {
        formError.textContent = err.message;
    }
});

const tabs = document.querySelectorAll('.tab');
for (let i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function () {
        statusFilter = tabs[i].dataset.status;
        for (let j = 0; j < tabs.length; j++) {
            tabs[j].classList.toggle('on', tabs[j] === tabs[i]);
        }
        drawList();
    });
}

document.getElementById('priorityFilter').addEventListener('change', function (e) {
    priorityFilter = e.target.value;
    drawList();
});

document.getElementById('sortBy').addEventListener('change', function (e) {
    sortBy = e.target.value;
    drawList();
});

document.getElementById('inviteForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const input = document.getElementById('inviteEmail');
    const message = document.getElementById('inviteMessage');
    message.textContent = '';
    message.classList.remove('ok');
    if (input.value.trim() === '') {
        message.textContent = App.t('emailRequired');
        return;
    }
    try {
        await App.api('/api/projects/' + projectId + '/invite', 'POST', { email: input.value });
        input.value = '';
        message.textContent = App.t('inviteSent');
        message.classList.add('ok');
        await reloadProject();
    } catch (err) {
        message.textContent = err.message;
    }
});

document.getElementById('title').addEventListener('change', async function () {
    const input = document.getElementById('title');
    const value = input.value.trim();
    if (value === '') {
        input.value = project.title;
        return;
    }
    try {
        await App.api('/api/projects/' + projectId, 'PUT', { title: value });
        project.title = value;
        document.title = value + ' – Planner';
    } catch (err) {
        alert(err.message);
        input.value = project.title;
    }
});

document.getElementById('title').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.target.blur();
    }
});

document.getElementById('back').addEventListener('click', function () {
    window.location.href = '/dashboard#projects';
});

document.getElementById('settings-link').addEventListener('click', function () {
    window.location.href = '/dashboard#settings';
});

document.getElementById('exit-btn').addEventListener('click', function () {
    App.logout();
});

async function start() {
    await App.init();
    try {
        project = await App.api('/api/projects/' + projectId);
    } catch (err) {
        window.location.href = '/dashboard';
        return;
    }
    document.title = project.title + ' – Planner';
    document.getElementById('title').value = project.title;
    document.getElementById('title').disabled = !project.is_owner;
    document.getElementById('inviteEmail').placeholder = App.t('inviteEmail');
    document.getElementById('inviteForm').hidden = !project.is_owner;
    fillAssignees();
    drawMembers();
    await loadTasks();
}

start();
