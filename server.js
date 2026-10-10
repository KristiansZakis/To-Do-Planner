const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8000;

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'planner.db'));
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'Untitled',
    template   TEXT NOT NULL DEFAULT 'new',
    data       TEXT NOT NULL DEFAULT '{"objects":[]}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invites (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    from_user   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_id, to_user)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    due_date    TEXT,
    priority    TEXT NOT NULL DEFAULT 'Medium',
    done        INTEGER NOT NULL DEFAULT 0,
    creator_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('language')) db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en'");
if (!userCols.includes('theme')) db.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'");
if (!userCols.includes('text_size')) db.exec('ALTER TABLE users ADD COLUMN text_size INTEGER NOT NULL DEFAULT 16');

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
    name: 'planner.sid',
    secret: process.env.SESSION_SECRET || 'change-this-secret-before-deploying',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
    if (req.session.userId) return next();
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(401).json({ error: 'Not logged in.' });
    }
    res.redirect('/login');
}

app.use('/app', requireAuth, express.static(path.join(__dirname, 'private')));

app.get('/', (req, res) => res.redirect(req.session.userId ? '/dashboard' : '/login'));

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'html', 'login-page.html'));
});

app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'html', 'registration-page.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'private', 'html', 'main-page.html'));
});

app.get('/project/:id', requireAuth, (req, res) => {
    const project = getAccess(Number(req.params.id), req.session.userId);
    if (project && project.template === 'list') {
        return res.sendFile(path.join(__dirname, 'private', 'html', 'tasks.html'));
    }
    res.sendFile(path.join(__dirname, 'private', 'html', 'workspace.html'));
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nameError = (n) => (n.length < 2 ? 'Name must be at least 2 characters.' : null);
const emailError = (e) => (EMAIL_RE.test(e) ? null : 'Enter a valid email address.');
function passwordError(p) {
    if (p.length < 8) return 'Password must be at least 8 characters.';
    if (p.length > 72) return 'Password is too long (max 72 characters).';
    return null;
}

function startSession(req, res, userId, status = 200) {
    req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'Server error.' });
        req.session.userId = userId;
        res.status(status).json({ ok: true });
    });
}

app.post('/api/register', async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const invalid = nameError(name) || emailError(email) || passwordError(password);
    if (invalid) return res.status(400).json({ error: invalid });

    try {
        const hash = await bcrypt.hash(password, 12);
        const result = db
            .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
            .run(name, email, hash);
        startSession(req, res, result.lastInsertRowid, 201);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'This email is already registered.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.post('/api/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    const ok = user && await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    startSession(req, res, user.id);
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('planner.sid');
        res.json({ ok: true });
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, name, email, language, theme, text_size FROM users WHERE id = ?').get(req.session.userId);
    if (!user) return req.session.destroy(() => res.status(401).json({ error: 'Not logged in.' }));
    res.json(user);
});

// profile & settings
app.put('/api/profile', requireAuth, async (req, res) => {
    const uid = req.session.userId;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    const { name, email, currentPassword, newPassword } = req.body || {};
    try {
        if (name !== undefined) {
            const n = String(name).trim();
            if (nameError(n)) return res.status(400).json({ error: nameError(n) });
            db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, uid);
        }
        if (email !== undefined) {
            const e = String(email).trim().toLowerCase();
            if (emailError(e)) return res.status(400).json({ error: emailError(e) });
            db.prepare('UPDATE users SET email = ? WHERE id = ?').run(e, uid);
        }
        if (newPassword !== undefined) {
            if (!(await bcrypt.compare(String(currentPassword || ''), user.password_hash))) {
                return res.status(403).json({ error: 'Current password is incorrect.' });
            }
            const p = String(newPassword);
            if (passwordError(p)) return res.status(400).json({ error: passwordError(p) });
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(p, 12), uid);
        }
        res.json({ ok: true });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'This email is already registered.' });
        console.error(err);
        res.status(500).json({ error: 'Server error.' });
    }
});

app.delete('/api/profile', requireAuth, async (req, res) => {
    const uid = req.session.userId;
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
    if (!user || !(await bcrypt.compare(String((req.body || {}).password || ''), user.password_hash))) {
        return res.status(403).json({ error: 'Password is incorrect.' });
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    req.session.destroy(() => {
        res.clearCookie('planner.sid');
        res.json({ ok: true });
    });
});

app.put('/api/settings', requireAuth, (req, res) => {
    const body = req.body || {};
    const valid = {
        language: (v) => ['en', 'lv'].includes(v),
        theme: (v) => ['light', 'dark'].includes(v),
        text_size: (v) => Number.isInteger(v) && v >= 12 && v <= 32,
    };
    const updates = [];
    for (const key in valid) {
        if (body[key] === undefined) continue;
        const value = key === 'text_size' ? Number(body[key]) : body[key];
        if (!valid[key](value)) return res.status(400).json({ error: `Invalid ${key.replace('_', ' ')}.` });
        updates.push([key, value]);
    }
    for (const [key, value] of updates) {
        db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`).run(value, req.session.userId);
    }
    res.json({ ok: true });
});

// projects
const TEMPLATES = ['new', 'list', 'grid'];

function getAccess(projectId, userId) {
    return db.prepare(`
        SELECT p.*, (p.owner_id = ?) AS is_owner FROM projects p
        WHERE p.id = ? AND (p.owner_id = ? OR EXISTS
            (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?))
    `).get(userId, projectId, userId, userId);
}

app.get('/api/projects', requireAuth, (req, res) => {
    const uid = req.session.userId;
    const rows = db.prepare(`
        SELECT p.id, p.title, p.template, p.updated_at, p.owner_id, u.name AS owner_name,
               (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count
        FROM projects p JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?)
        ORDER BY p.updated_at DESC, p.id DESC
    `).all(uid, uid);
    res.json(rows.map((r) => ({
        ...r,
        is_owner: r.owner_id === uid,
        is_group: r.member_count > 0 || r.owner_id !== uid,
    })));
});

app.post('/api/projects', requireAuth, (req, res) => {
    const template = TEMPLATES.includes(req.body.template) ? req.body.template : 'new';
    const title = String(req.body.title || '').trim().slice(0, 80) || 'Untitled';
    const result = db
        .prepare('INSERT INTO projects (owner_id, title, template, data) VALUES (?, ?, ?, ?)')
        .run(req.session.userId, title, template, JSON.stringify({ objects: [] }));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
    const p = getAccess(Number(req.params.id), req.session.userId);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    const members = db.prepare(`
        SELECT u.id, u.name, u.email FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?
    `).all(p.id);
    let data;
    try { data = JSON.parse(p.data); } catch { data = { objects: [] }; }
    const owner = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(p.owner_id);
    const pending = db.prepare(`
        SELECT u.name, u.email FROM invites i JOIN users u ON u.id = i.to_user WHERE i.project_id = ?
    `).all(p.id);
    res.json({
        id: p.id, title: p.title, template: p.template, data, is_owner: !!p.is_owner, members, owner, pending,
        people: [owner, ...members], me: req.session.userId, updated_at: p.updated_at,
    });
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
    const p = getAccess(Number(req.params.id), req.session.userId);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    if (req.body.title !== undefined) {
        const title = String(req.body.title).trim().slice(0, 80);
        if (!title) return res.status(400).json({ error: 'Title cannot be empty.' });
        db.prepare('UPDATE projects SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(title, p.id);
    }
    if (req.body.data !== undefined) {
        if (!req.body.data || !Array.isArray(req.body.data.objects)) return res.status(400).json({ error: 'Invalid data.' });
        db.prepare('UPDATE projects SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(req.body.data), p.id);
    }
    res.json({ ok: true, updated_at: db.prepare('SELECT updated_at FROM projects WHERE id = ?').get(p.id).updated_at });
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
    const p = getAccess(Number(req.params.id), req.session.userId);
    if (!p) return res.status(404).json({ error: 'Project not found.' });
    if (p.is_owner) {
        db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
    } else {
        db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(p.id, req.session.userId);
        db.prepare('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?').run(p.id, req.session.userId);
    }
    res.json({ ok: true });
});

// tasks (list projects) 
const PRIORITIES = ['Low', 'Medium', 'High'];

function checkTaskInput(body, project) {
    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim();
    const priority = String(body.priority || 'Medium');
    let dueDate = String(body.due_date || '').trim();
    let assigneeId = null;

    if (title.length < 1) return { error: 'Title is required.' };
    if (title.length > 100) return { error: 'Title is too long (max 100 characters).' };
    if (description.length > 1000) return { error: 'Description is too long (max 1000 characters).' };
    if (!PRIORITIES.includes(priority)) return { error: 'Priority must be Low, Medium or High.' };

    if (dueDate === '') {
        dueDate = null;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || isNaN(new Date(dueDate).getTime())) {
        return { error: 'Due date is not valid.' };
    }

    if (body.assignee_id) {
        assigneeId = Number(body.assignee_id);
        const isOwner = assigneeId === project.owner_id;
        const isMember = db
            .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
            .get(project.id, assigneeId);
        if (!isOwner && !isMember) return { error: 'Assigned user is not a member of this project.' };
    }
    return { title, description, priority, dueDate, assigneeId };
}

function loadTask(id) {
    return db.prepare(`
        SELECT t.*, a.name AS assignee_name, c.name AS creator_name
        FROM tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users c ON c.id = t.creator_id
        WHERE t.id = ?
    `).get(id);
}

function sendTask(task, project, userId) {
    const isOwner = project.owner_id === userId;
    const isCreator = task.creator_id === userId;
    const isAssignee = task.assignee_id === userId;
    return {
        ...task,
        done: !!task.done,
        canEdit: isOwner || isCreator || isAssignee,
        canDelete: isOwner || isCreator,
    };
}

app.get('/api/projects/:id/tasks', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const project = getAccess(Number(req.params.id), userId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const rows = db.prepare(`
        SELECT t.*, a.name AS assignee_name, c.name AS creator_name
        FROM tasks t
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users c ON c.id = t.creator_id
        WHERE t.project_id = ?
    `).all(project.id);
    res.json(rows.map((t) => sendTask(t, project, userId)));
});

app.post('/api/projects/:id/tasks', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const project = getAccess(Number(req.params.id), userId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });

    const input = checkTaskInput(req.body, project);
    if (input.error) return res.status(400).json({ error: input.error });

    const result = db.prepare(`
        INSERT INTO tasks (project_id, title, description, due_date, priority, creator_id, assignee_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(project.id, input.title, input.description, input.dueDate, input.priority, userId, input.assigneeId);
    res.status(201).json(sendTask(loadTask(result.lastInsertRowid), project, userId));
});

function findTask(req, res) {
    const task = loadTask(Number(req.params.id));
    if (!task) {
        res.status(404).json({ error: 'Task not found.' });
        return null;
    }
    const project = getAccess(task.project_id, req.session.userId);
    if (!project) {
        res.status(404).json({ error: 'Task not found.' });
        return null;
    }
    return { task, project };
}

app.put('/api/tasks/:id', requireAuth, (req, res) => {
    const found = findTask(req, res);
    if (!found) return;
    const info = sendTask(found.task, found.project, req.session.userId);
    if (!info.canEdit) return res.status(403).json({ error: 'You are not allowed to edit this task.' });

    const input = checkTaskInput(req.body, found.project);
    if (input.error) return res.status(400).json({ error: input.error });

    db.prepare(`
        UPDATE tasks SET title = ?, description = ?, due_date = ?, priority = ?, assignee_id = ? WHERE id = ?
    `).run(input.title, input.description, input.dueDate, input.priority, input.assigneeId, found.task.id);
    res.json(sendTask(loadTask(found.task.id), found.project, req.session.userId));
});

app.patch('/api/tasks/:id/done', requireAuth, (req, res) => {
    const found = findTask(req, res);
    if (!found) return;
    const info = sendTask(found.task, found.project, req.session.userId);
    if (!info.canEdit) return res.status(403).json({ error: 'You are not allowed to change this task.' });

    db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(req.body.done ? 1 : 0, found.task.id);
    res.json(sendTask(loadTask(found.task.id), found.project, req.session.userId));
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
    const found = findTask(req, res);
    if (!found) return;
    const info = sendTask(found.task, found.project, req.session.userId);
    if (!info.canDelete) return res.status(403).json({ error: 'You are not allowed to delete this task.' });

    db.prepare('DELETE FROM tasks WHERE id = ?').run(found.task.id);
    res.json({ ok: true });
});

app.delete('/api/projects/:id/members/:userId', requireAuth, (req, res) => {
    const p = getAccess(Number(req.params.id), req.session.userId);
    if (!p || !p.is_owner) return res.status(404).json({ error: 'Project not found.' });
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(p.id, Number(req.params.userId));
    db.prepare('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?').run(p.id, Number(req.params.userId));
    res.json({ ok: true });
});

// invites
app.post('/api/projects/:id/invite', requireAuth, (req, res) => {
    const p = getAccess(Number(req.params.id), req.session.userId);
    if (!p || !p.is_owner) return res.status(404).json({ error: 'Project not found.' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!target) return res.status(404).json({ error: 'No user with this email.' });
    if (target.id === req.session.userId) return res.status(400).json({ error: 'You cannot invite yourself.' });
    if (db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(p.id, target.id)) {
        return res.status(409).json({ error: 'This user is already a member.' });
    }
    try {
        db.prepare('INSERT INTO invites (project_id, from_user, to_user) VALUES (?, ?, ?)').run(p.id, req.session.userId, target.id);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Invite already sent.' });
        throw err;
    }
    res.status(201).json({ ok: true });
});

app.get('/api/invites', requireAuth, (req, res) => {
    res.json(db.prepare(`
        SELECT i.id, i.project_id, p.title AS project_title, u.name AS from_name, i.created_at
        FROM invites i JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.from_user
        WHERE i.to_user = ? ORDER BY i.id DESC
    `).all(req.session.userId));
});

app.post('/api/invites/:id/:action', requireAuth, (req, res) => {
    const { action } = req.params;
    if (!['accept', 'decline'].includes(action)) return res.status(400).json({ error: 'Invalid action.' });
    const inv = db.prepare('SELECT * FROM invites WHERE id = ? AND to_user = ?').get(Number(req.params.id), req.session.userId);
    if (!inv) return res.status(404).json({ error: 'Invite not found.' });
    db.transaction(() => {
        if (action === 'accept') {
            db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(inv.project_id, inv.to_user);
        }
        db.prepare('DELETE FROM invites WHERE id = ?').run(inv.id);
    })();
    res.json({ ok: true, project_id: inv.project_id });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
});