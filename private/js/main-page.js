const $content = document.getElementById('content');
const $side = document.getElementById('sidepanel');
const VIEWS = ['projects', 'create', 'settings', 'invites', 'profile'];
const TITLE_KEYS = { projects: 'projects', create: 'createNew', settings: 'settings', invites: 'invites', profile: 'profile' };

function currentView() {
    const v = location.hash.replace('#', '');
    return VIEWS.includes(v) ? v : 'projects';
}

async function render() {
    const view = currentView();
    document.querySelectorAll('#side-main button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.getElementById('topbar-title').textContent = App.t(TITLE_KEYS[view]);
    $side.classList.remove('open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', 'false');
    $content.innerHTML = '';
    try {
        await views[view]();
    } catch (err) {
        $content.textContent = err.message;
    }
}

function setAvatar(el, name) {
    el.textContent = (name || '?').trim().charAt(0).toUpperCase();
}

function refreshUserUI() {
    document.getElementById('userName').textContent = App.user.name;
    setAvatar(document.getElementById('avatar'), App.user.name);
}

async function refreshInviteBadge() {
    try {
        const list = await App.api('/api/invites');
        const badge = document.getElementById('invite-badge');
        badge.hidden = list.length === 0;
        badge.textContent = list.length;
        return list;
    } catch { return []; }
}

const views = {
    async projects() {
        const projects = await App.api('/api/projects');
        const mine = projects.filter((p) => !p.is_group);
        const group = projects.filter((p) => p.is_group);
        $content.innerHTML = `
            <h2 class="section-title">${esc(App.t('yourProjects'))}</h2>
            <div class="tiles" id="mine"></div>
            <h2 class="section-title">${esc(App.t('groupProjects'))}</h2>
            <div class="tiles" id="group"></div>`;
        fillTiles(document.getElementById('mine'), mine, 'noProjects');
        fillTiles(document.getElementById('group'), group, 'noGroup');
    },

    async create() {
        $content.innerHTML = `
            <h2 class="page-title">${esc(App.t('templates'))}</h2>
            <div class="tiles">
                ${templateTile('new', 'tplNew', '<span>+</span>')}
                ${templateTile('list', 'tplList', listPreview())}
                ${templateTile('grid', 'tplGrid', gridPreview())}
            </div>`;
        $content.querySelectorAll('[data-template]').forEach((b) => b.addEventListener('click', async () => {
            b.disabled = true;
            try {
                const { id } = await App.api('/api/projects', 'POST', { template: b.dataset.template, title: App.t('untitled') });
                window.location.href = '/project/' + id;
            } catch (err) { b.disabled = false; alert(err.message); }
        }));
    },

    async settings() {
        const u = App.user;
        const sizes = [14, 16, 18, 20, 24, 28];
        $content.innerHTML = `
            <h2 class="page-title">${esc(App.t('settings'))}</h2>
            <div class="settings-list">
                <div class="setting-row"><span>${esc(App.t('language'))}</span>
                    <span class="seg" data-key="language">
                        <button data-v="lv" class="${u.language === 'lv' ? 'on' : ''}">LV</button>
                        <button data-v="en" class="${u.language === 'en' ? 'on' : ''}">EN</button>
                    </span></div>
                <div class="setting-row"><span>${esc(App.t('theme'))}</span>
                    <span class="seg" data-key="theme">
                        <button data-v="light" class="${u.theme === 'light' ? 'on' : ''}" aria-label="Light">☀️</button>
                        <button data-v="dark" class="${u.theme === 'dark' ? 'on' : ''}" aria-label="Dark">🌙</button>
                    </span></div>
                <div class="setting-row"><span>${esc(App.t('textSize'))}</span>
                    <select id="text-size">${sizes.map((s) => `<option value="${s}" ${s === u.text_size ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            </div>`;
        const save = async (patch) => {
            await App.api('/api/settings', 'PUT', patch);
            Object.assign(App.user, patch);
            App.applySettings(App.user);
            render();
        };
        $content.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (b && !b.classList.contains('on')) save({ [seg.dataset.key]: b.dataset.v });
        }));
        document.getElementById('text-size').addEventListener('change', (e) => save({ text_size: Number(e.target.value) }));
    },

    async invites() {
        const list = await refreshInviteBadge();
        $content.innerHTML = `<h2 class="page-title">${esc(App.t('invites'))}</h2><div class="invite-list" id="invite-list"></div>`;
        const box = document.getElementById('invite-list');
        if (!list.length) {
            box.innerHTML = `<div class="invite-row empty">${esc(App.t('nothingYet'))}</div>`;
            return;
        }
        box.innerHTML = list.map((i) => `
            <div class="invite-row" data-id="${i.id}">
                <span class="grow"><b>${esc(i.from_name)}</b> ${esc(App.t('invitedYou'))} <b>${esc(i.project_title)}</b></span>
                <button class="btn" data-act="accept">${esc(App.t('accept'))}</button>
                <button class="btn secondary" data-act="decline">${esc(App.t('decline'))}</button>
            </div>`).join('');
        box.addEventListener('click', async (e) => {
            const b = e.target.closest('button[data-act]');
            if (!b) return;
            const row = b.closest('.invite-row');
            try {
                await App.api(`/api/invites/${row.dataset.id}/${b.dataset.act}`, 'POST');
                render();
            } catch (err) { alert(err.message); }
        });
    },

    async profile() {
        $content.innerHTML = `
            <div class="profile-head">
                <div class="avatar big" id="p-avatar"></div>
                <h2 id="p-name"></h2>
                <button class="pill small" id="edit-name">${esc(App.t('edit'))}</button>
            </div>
            <div class="profile-card">
                <div class="field-row">
                    <span class="lbl">${esc(App.t('changeUsername'))}</span>
                    <div class="inline-edit">
                        <input class="text-input" id="name-input" maxlength="60" autocomplete="name">
                        <button class="pill small primary" id="save-name">${esc(App.t('save'))}</button>
                    </div>
                </div>
                <hr>
                <button class="pill link" id="toggle-email">${esc(App.t('changeEmail'))}</button>
                <div class="form-panel" id="email-panel" hidden>
                    <input class="text-input" id="email-input" type="email" placeholder="${esc(App.t('newEmail'))}" autocomplete="email">
                    <button class="pill small primary" id="save-email">${esc(App.t('save'))}</button>
                </div>
                <button class="pill link" id="toggle-pass">${esc(App.t('changePassword'))}</button>
                <div class="form-panel" id="pass-panel" hidden>
                    <input class="text-input" id="cur-pass" type="password" placeholder="${esc(App.t('currentPassword'))}" autocomplete="current-password">
                    <input class="text-input" id="new-pass" type="password" placeholder="${esc(App.t('newPassword'))}" autocomplete="new-password">
                    <button class="pill small primary" id="save-pass">${esc(App.t('save'))}</button>
                </div>
                <button class="pill danger" id="delete-profile">${esc(App.t('deleteProfile'))}</button>
                <p class="msg" id="msg" role="status"></p>
            </div>`;
        const $name = document.getElementById('name-input');
        const $email = document.getElementById('email-input');
        const msg = document.getElementById('msg');
        const paint = () => {
            document.getElementById('p-name').textContent = App.user.name;
            setAvatar(document.getElementById('p-avatar'), App.user.name);
            $name.value = App.user.name;
            $email.value = App.user.email;
            refreshUserUI();
        };
        paint();
        const say = (text, ok) => { msg.textContent = text; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };
        const update = async (patch, onOk) => {
            try {
                await App.api('/api/profile', 'PUT', patch);
                if (patch.name !== undefined) App.user.name = patch.name.trim();
                if (patch.email !== undefined) App.user.email = patch.email.trim().toLowerCase();
                paint(); say(App.t('saved'), true); onOk && onOk();
            } catch (err) { say(err.message, false); }
        };
        document.getElementById('edit-name').addEventListener('click', () => { $name.focus(); $name.select(); });
        document.getElementById('save-name').addEventListener('click', () => update({ name: $name.value }));
        const toggle = (btnId, panelId, focusId) => document.getElementById(btnId).addEventListener('click', () => {
            const p = document.getElementById(panelId);
            p.hidden = !p.hidden;
            if (!p.hidden) document.getElementById(focusId).focus();
        });
        toggle('toggle-email', 'email-panel', 'email-input');
        toggle('toggle-pass', 'pass-panel', 'cur-pass');
        document.getElementById('save-email').addEventListener('click', () => update({ email: $email.value }));
        document.getElementById('save-pass').addEventListener('click', () => {
            const cur = document.getElementById('cur-pass'), nw = document.getElementById('new-pass');
            update({ currentPassword: cur.value, newPassword: nw.value }, () => { cur.value = ''; nw.value = ''; });
        });
        document.getElementById('delete-profile').addEventListener('click', async () => {
            const pw = prompt(App.t('confirmDelete'));
            if (pw === null) return;
            try { await App.api('/api/profile', 'DELETE', { password: pw }); window.location.href = '/login'; }
            catch (err) { say(err.message, false); }
        });
    },
};

function listPreview() {
    return '<svg viewBox="0 0 102 102"><g stroke="#000" stroke-width="2"><line x1="0" y1="22" x2="102" y2="22"/><line x1="0" y1="40" x2="102" y2="40"/><line x1="0" y1="60" x2="102" y2="60"/><line x1="0" y1="78" x2="102" y2="78"/></g></svg>';
}
function gridPreview() {
    return '<svg viewBox="0 0 102 102"><rect x="12" y="14" width="22" height="22" fill="#d9d9d9"/><rect x="62" y="30" width="26" height="30" fill="#7e2424"/><rect x="12" y="52" width="38" height="28" fill="#18be4f"/><path d="M26 18 L58 28 M44 68 L84 76" stroke="#000" stroke-width="2" fill="none"/></svg>';
}
function templateTile(key, labelKey, inner) {
    return `<div class="tile-wrap"><button class="tile tpl-${key}" data-template="${key}" aria-label="${esc(App.t(labelKey))}">${inner}</button>
        <div class="tile-label">${esc(App.t(labelKey))}</div></div>`;
}

function fillTiles(box, items, emptyKey) {
    if (!items.length) { box.innerHTML = `<p class="empty-note">${esc(App.t(emptyKey))}</p>`; return; }
    box.innerHTML = items.map((p) => `
        <div class="tile-wrap" data-id="${p.id}" data-owner="${p.is_owner}">
            <button class="tile tpl-${esc(p.template)}" data-open aria-label="${esc(p.title)}">
                ${p.template === 'list' ? listPreview() : p.template === 'grid' ? gridPreview() : ''}
                ${!p.is_owner ? `<span class="badge-shared">${esc(p.owner_name)}</span>` : ''}
            </button>
            <button class="tile-menu" aria-label="Menu" data-menu>⋯</button>
            <div class="tile-label">${esc(p.title)}</div>
        </div>`).join('');
}

document.addEventListener('click', async (e) => {
    const openMenu = document.querySelector('.tile-menu-list');
    const menuBtn = e.target.closest('[data-menu]');
    if (openMenu && !e.target.closest('.tile-menu-list')) openMenu.remove();
    if (menuBtn) {
        e.stopPropagation();
        const wrap = menuBtn.closest('.tile-wrap');
        const owner = wrap.dataset.owner === 'true';
        const list = document.createElement('div');
        list.className = 'tile-menu-list';
        list.innerHTML = (owner ? `<button data-do="rename">${esc(App.t('rename'))}</button>` : '') +
            `<button data-do="delete">${esc(App.t(owner ? 'deleteProject' : 'leaveProject'))}</button>`;
        wrap.appendChild(list);
        return;
    }
    const act = e.target.closest('.tile-menu-list button');
    const wrap = e.target.closest('.tile-wrap[data-id]');
    if (act && wrap) {
        const id = wrap.dataset.id;
        const owner = wrap.dataset.owner === 'true';
        try {
            if (act.dataset.do === 'rename') {
                const cur = wrap.querySelector('.tile-label').textContent;
                const name = prompt(App.t('renamePrompt'), cur);
                if (name && name.trim()) { await App.api('/api/projects/' + id, 'PUT', { title: name }); render(); }
            } else if (confirm(App.t(owner ? 'confirmDeleteProject' : 'confirmLeave'))) {
                await App.api('/api/projects/' + id, 'DELETE');
                render();
            }
        } catch (err) { alert(err.message); }
        document.querySelector('.tile-menu-list')?.remove();
        return;
    }
    if (e.target.closest('[data-open]') && wrap) window.location.href = '/project/' + wrap.dataset.id;
});

document.querySelectorAll('#side-main button').forEach((b) => b.addEventListener('click', () => {
    if (location.hash === '#' + b.dataset.view) render(); else location.hash = b.dataset.view;
}));
document.getElementById('logout').addEventListener('click', () => App.logout());
document.getElementById('menu-btn').addEventListener('click', () => {
    const open = $side.classList.toggle('open');
    document.getElementById('menu-btn').setAttribute('aria-expanded', open);
});
window.addEventListener('hashchange', render);

(async () => {
    await App.init();
    refreshUserUI();
    refreshInviteBadge();
    render();
})();
