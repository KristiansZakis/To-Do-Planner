(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const projectId = Number(location.pathname.split('/').pop());
    const $ = (id) => document.getElementById(id);
    const svg = $('canvas'), gObjects = $('objects'), gOverlay = $('overlay'), wrap = $('canvas-wrap');
    const editor = $('editor'), colorIn = $('color'), sizeIn = $('size');

    let project = null;
    let objects = [];
    let selectedId = null;
    let tool = 'select';
    let drag = null;
    let saveTimer = null, dirty = false, saving = false;
    let lastUpdated = null;
    const undoStack = [], redoStack = [];
    let editing = null;

    const SHAPES = ['rect', 'triangle', 'star', 'ellipse', 'arrow', 'line'];
    const uid = () => Math.random().toString(36).slice(2, 10);
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const isLinear = (o) => o.type === 'line' || o.type === 'arrow';
    const byId = (id) => objects.find((o) => o.id === id);
    const selected = () => byId(selectedId);
    const inkColor = (c) => (c === '#ffffff' ? '#000000' : c);

    function setStatus(key) { $('status').textContent = key ? App.t(key) : ''; }

    function markDirty() {
        dirty = true;
        setStatus('savingDots');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, 700);
    }

    async function flush() {
        clearTimeout(saveTimer);
        if (!dirty || saving) { if (dirty) saveTimer = setTimeout(flush, 300); return; }
        saving = true; dirty = false;
        try {
            const r = await App.api('/api/projects/' + projectId, 'PUT', { data: { ...project.data, objects } });
            lastUpdated = r.updated_at;
            setStatus(dirty ? 'savingDots' : 'allSaved');
        } catch (err) {
            dirty = true; setStatus('saveFailed');
            saveTimer = setTimeout(flush, 4000);
        }
        saving = false;
    }

    function commit() {
        undoStack.push(snapshot);
        if (undoStack.length > 100) undoStack.shift();
        redoStack.length = 0;
        snapshot = JSON.stringify(objects);
        markDirty();
    }
    let snapshot = '[]';

    function restore(json) {
        objects = JSON.parse(json);
        snapshot = json;
        if (!selected()) selectedId = null;
        render(); markDirty();
    }
    function undo() { if (!undoStack.length) return; redoStack.push(snapshot); restore(undoStack.pop()); }
    function redo() { if (!redoStack.length) return; undoStack.push(snapshot); restore(redoStack.pop()); }

    function bbox(o) {
        if (o.type === 'path') {
            const xs = o.points.map((p) => p[0]), ys = o.points.map((p) => p[1]);
            const x1 = Math.min(...xs), y1 = Math.min(...ys), x2 = Math.max(...xs), y2 = Math.max(...ys);
            return { x: o.x + x1, y: o.y + y1, w: x2 - x1, h: y2 - y1 };
        }
        if (o.type === 'text') {
            const lines = String(o.text).split('\n');
            const w = Math.max(...lines.map((l) => l.length), 1) * o.fontSize * 0.58;
            return { x: o.x, y: o.y, w, h: lines.length * o.fontSize * 1.2 };
        }
        return { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), w: Math.abs(o.w), h: Math.abs(o.h) };
    }

    function starPoints(o) {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2, rx = o.w / 2, ry = o.h / 2, pts = [];
        for (let i = 0; i < 10; i++) {
            const r = i % 2 ? 0.42 : 1, a = -Math.PI / 2 + (i * Math.PI) / 5;
            pts.push((cx + Math.cos(a) * rx * r).toFixed(1) + ',' + (cy + Math.sin(a) * ry * r).toFixed(1));
        }
        return pts.join(' ');
    }

    function el(name, attrs, parent) {
        const e = document.createElementNS(NS, name);
        for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        return e;
    }

    function pathD(points) {
        if (points.length === 1) return `M${points[0][0]} ${points[0][1]}l.01 0`;
        let d = `M${points[0][0]} ${points[0][1]}`;
        for (let i = 1; i < points.length - 1; i++) {
            const mx = (points[i][0] + points[i + 1][0]) / 2, my = (points[i][1] + points[i + 1][1]) / 2;
            d += `Q${points[i][0]} ${points[i][1]} ${mx} ${my}`;
        }
        const last = points[points.length - 1];
        return d + `L${last[0]} ${last[1]}`;
    }

    function drawObject(o) {
        const g = el('g', { 'data-id': o.id });
        const stroke = { stroke: '#000', 'stroke-width': 2 };
        switch (o.type) {
            case 'rect': el('rect', { x: Math.min(o.x, o.x + o.w), y: Math.min(o.y, o.y + o.h), width: Math.abs(o.w), height: Math.abs(o.h), fill: o.color, ...stroke }, g); break;
            case 'ellipse': el('ellipse', { cx: o.x + o.w / 2, cy: o.y + o.h / 2, rx: Math.abs(o.w) / 2, ry: Math.abs(o.h) / 2, fill: o.color, ...stroke }, g); break;
            case 'triangle': el('polygon', { points: `${o.x + o.w / 2},${o.y} ${o.x + o.w},${o.y + o.h} ${o.x},${o.y + o.h}`, fill: o.color, 'stroke-linejoin': 'round', ...stroke }, g); break;
            case 'star': el('polygon', { points: starPoints(o), fill: o.color, 'stroke-linejoin': 'round', ...stroke }, g); break;
            case 'line': case 'arrow': {
                const x2 = o.x + o.w, y2 = o.y + o.h;
                el('line', { x1: o.x, y1: o.y, x2, y2, stroke: 'transparent', 'stroke-width': Math.max(16, o.size + 10) }, g);
                el('line', { x1: o.x, y1: o.y, x2, y2, stroke: o.color, 'stroke-width': o.size, 'stroke-linecap': 'round' }, g);
                if (o.type === 'arrow' && (o.w || o.h)) {
                    const a = Math.atan2(o.h, o.w), L = 10 + o.size * 2.5, sp = 0.45;
                    const p = (ang) => `${x2 - Math.cos(ang) * L},${y2 - Math.sin(ang) * L}`;
                    el('polygon', { points: `${x2},${y2} ${p(a - sp)} ${p(a + sp)}`, fill: o.color, stroke: o.color, 'stroke-width': 1, 'stroke-linejoin': 'round' }, g);
                }
                break;
            }
            case 'path': {
                g.setAttribute('transform', `translate(${o.x} ${o.y})`);
                el('path', { d: pathD(o.points), fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, o.size + 8), 'stroke-linecap': 'round' }, g);
                el('path', { d: pathD(o.points), fill: 'none', stroke: o.color, 'stroke-width': o.size, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: o.tool === 'pencil' ? 0.7 : 1 }, g);
                break;
            }
            case 'text': {
                const t = el('text', { x: o.x, y: o.y, fill: o.color, 'font-size': o.fontSize, 'font-family': 'Inter, system-ui, sans-serif', 'dominant-baseline': 'text-before-edge' }, g);
                String(o.text).split('\n').forEach((line, i) => {
                    const ts = el('tspan', { x: o.x, dy: i ? '1.2em' : '0' }, t);
                    ts.textContent = line || ' ';
                    ts.setAttribute('xml:space', 'preserve');
                });
                const b = bbox(o);
                el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }, g);
                break;
            }
            case 'table': {
                const cw = o.w / o.cols, ch = o.h / o.rows;
                el('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: o.color }, g);
                for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
                    el('rect', { x: o.x + c * cw, y: o.y + r * ch, width: cw, height: ch, fill: 'none', stroke: '#000', 'stroke-width': 1.5 }, g);
                    const txt = o.cells[r * o.cols + c];
                    if (txt) {
                        const fs = Math.min(16, ch * 0.5);
                        const t = el('text', { x: o.x + c * cw + 6, y: o.y + r * ch + ch / 2, 'font-size': fs, fill: '#000', 'dominant-baseline': 'central', 'font-family': 'Inter, system-ui, sans-serif' }, g);
                        t.textContent = txt;
                        t.setAttribute('textLength', Math.min(txt.length * fs * 0.55, cw - 12));
                        t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
                    }
                }
                break;
            }
            case 'image': el('image', { href: o.src, x: o.x, y: o.y, width: o.w, height: o.h, preserveAspectRatio: 'none' }, g); break;
        }
        return g;
    }

    function render() {
        gObjects.replaceChildren(...objects.map(drawObject));
        gOverlay.replaceChildren();
        const sel = selected();
        if (sel && !editing) {
            const b = bbox(sel);
            el('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, fill: 'none', stroke: '#1b6dff', 'stroke-width': 1.5, 'stroke-dasharray': '5 4', 'pointer-events': 'none' }, gOverlay);
            if (sel.type !== 'path' && sel.type !== 'text') {
                const hx = isLinear(sel) ? sel.x + sel.w : b.x + b.w, hy = isLinear(sel) ? sel.y + sel.h : b.y + b.h;
                el('circle', { cx: hx, cy: hy, r: 8, fill: '#fff', stroke: '#1b6dff', 'stroke-width': 2, 'data-handle': 'resize', style: 'cursor:nwse-resize' }, gOverlay);
            }
        }
        updateToolbar();
    }

    function updateToolbar() {
        const sel = selected();
        $('delete').hidden = !sel;
        $('ctx-table').hidden = !(sel && sel.type === 'table');
        document.querySelectorAll('#toolbar [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
        document.querySelectorAll('.shape-grid button').forEach((b) => b.classList.toggle('on', tool === 'shape:' + b.dataset.shape));
        svg.classList.toggle('tool-draw', tool.startsWith('shape:') || tool === 'pen' || tool === 'pencil');
        svg.classList.toggle('tool-text', tool === 'text');
        if (sel) {
            colorIn.value = sel.color || '#000000';
            sizeIn.value = sel.type === 'text' ? sel.fontSize : (sel.size || sizeIn.value);
            sizeIn.disabled = !(sel.type === 'text' || sel.size);
        } else sizeIn.disabled = false;
    }

    function setTool(t) {
        closeEditor(true);
        tool = t;
        if (t !== 'select') selectedId = null;
        if (t === 'pen' && !selectedId) sizeIn.value = 4;
        if (t === 'pencil') sizeIn.value = 2;
        if (t === 'text') sizeIn.value = 24;
        render();
    }

    function pt(e) {
        const r = svg.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        closeEditor(true);
        const p = pt(e);
        const color = colorIn.value;
        const size = Math.max(1, Number(sizeIn.value) || 4);
        const handle = e.target.closest('[data-handle]');
        const hit = e.target.closest('#objects [data-id]');
        svg.setPointerCapture(e.pointerId);

        if (tool.startsWith('shape:')) {
            const type = tool.slice(6);
            const o = { id: uid(), type, x: p.x, y: p.y, w: 0, h: 0, color: isLinear({ type }) ? inkColor(color) : color, size: Math.min(size, 12) };
            if (isLinear(o) && o.size < 3) o.size = 3;
            objects.push(o); selectedId = o.id;
            drag = { mode: 'create', o, sx: p.x, sy: p.y };
        } else if (tool === 'pen' || tool === 'pencil') {
            const o = { id: uid(), type: 'path', tool, x: 0, y: 0, points: [[p.x, p.y]], color: inkColor(color), size };
            objects.push(o);
            drag = { mode: 'draw', o };
        } else if (tool === 'text') {
            const o = { id: uid(), type: 'text', x: p.x, y: p.y, text: '', fontSize: size, color: inkColor(color) };
            objects.push(o); selectedId = o.id;
            drag = null;
            render();
            openEditor(o);
            e.preventDefault();
            return;
        } else if (handle && selectedId) {
            const o = selected();
            drag = { mode: 'resize', o, orig: clone(o) };
        } else if (hit) {
            selectedId = hit.dataset.id;
            const o = selected();
            drag = { mode: 'move', o, sx: p.x, sy: p.y, ox: o.x, oy: o.y, moved: false };
        } else {
            selectedId = null;
            drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop };
        }
        render();
        e.preventDefault();
    });

    svg.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const p = pt(e);
        const o = drag.o;
        if (drag.mode === 'create') {
            let w = p.x - drag.sx, h = p.y - drag.sy;
            if (isLinear(o)) { if (e.shiftKey) { if (Math.abs(w) > Math.abs(h)) h = 0; else w = 0; } o.w = w; o.h = h; }
            else {
                if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
                o.x = Math.min(drag.sx, drag.sx + w); o.y = Math.min(drag.sy, drag.sy + h); o.w = Math.abs(w); o.h = Math.abs(h);
            }
        } else if (drag.mode === 'draw') {
            const last = o.points[o.points.length - 1];
            if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.5) o.points.push([p.x, p.y]);
        } else if (drag.mode === 'move') {
            const dx = p.x - drag.sx, dy = p.y - drag.sy;
            if (!drag.moved && Math.hypot(dx, dy) < 3) return;
            drag.moved = true;
            o.x = Math.max(-2000, Math.round(drag.ox + dx)); o.y = Math.max(-2000, Math.round(drag.oy + dy));
        } else if (drag.mode === 'resize') {
            if (isLinear(o)) { o.w = p.x - o.x; o.h = p.y - o.y; }
            else if (o.type === 'image' && e.shiftKey) {
                const ratio = drag.orig.w / drag.orig.h; o.w = Math.max(10, p.x - o.x); o.h = o.w / ratio;
            } else { o.w = Math.max(10, p.x - o.x); o.h = Math.max(10, p.y - o.y); }
        } else if (drag.mode === 'pan') {
            wrap.scrollLeft = drag.l - (e.clientX - drag.sx);
            wrap.scrollTop = drag.t - (e.clientY - drag.sy);
            return;
        }
        render();
    });

    function endDrag() {
        if (!drag) return;
        const d = drag; drag = null;
        if (d.mode === 'pan') return;
        const o = d.o;
        if (d.mode === 'create') {
            const tiny = isLinear(o) ? Math.hypot(o.w, o.h) < 6 : o.w < 6 && o.h < 6;
            if (tiny) Object.assign(o, isLinear(o) ? { w: 120, h: 0 } : { w: 100, h: 100 });
            tool = 'select';
            commit();
        } else if (d.mode !== 'move' || d.moved) {
            commit();
        }
        render();
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    svg.addEventListener('dblclick', (e) => {
        const hit = e.target.closest('#objects [data-id]');
        if (!hit || tool !== 'select') return;
        const o = byId(hit.dataset.id);
        if (o.type === 'text') openEditor(o);
        else if (o.type === 'table') {
            const p = pt(e);
            const c = Math.min(o.cols - 1, Math.max(0, Math.floor(((p.x - o.x) / o.w) * o.cols)));
            const r = Math.min(o.rows - 1, Math.max(0, Math.floor(((p.y - o.y) / o.h) * o.rows)));
            openEditor(o, r * o.cols + c);
        }
    });

    function openEditor(o, cell) {
        editing = { id: o.id, cell };
        selectedId = o.id;
        render();
        editor.hidden = false;
        editor.style.fontFamily = 'Inter, system-ui, sans-serif';
        if (o.type === 'text') {
            editor.value = o.text;
            editor.style.left = o.x - 4 + 'px'; editor.style.top = o.y - 2 + 'px';
            editor.style.fontSize = o.fontSize + 'px';
            editor.style.minWidth = '120px';
            editor.style.width = Math.max(120, bbox(o).w + 40) + 'px';
            editor.style.height = Math.max(o.fontSize * 1.2 + 8, bbox(o).h + 8) + 'px';
        } else {
            const cw = o.w / o.cols, ch = o.h / o.rows, c = cell % o.cols, r = Math.floor(cell / o.cols);
            editor.value = o.cells[cell] || '';
            editor.style.left = o.x + c * cw + 'px'; editor.style.top = o.y + r * ch + 'px';
            editor.style.width = cw + 'px'; editor.style.height = ch + 'px';
            editor.style.fontSize = Math.min(16, ch * 0.5) + 'px';
            editor.style.minWidth = '0';
        }
        editor.focus(); editor.select();
        requestAnimationFrame(() => { if (!editor.hidden) { editor.focus(); } });
    }

    function closeEditor(save) {
        if (!editing) return;
        const { id, cell } = editing;
        editing = null;
        editor.hidden = true;
        const o = byId(id);
        if (!o) return;
        if (save) {
            const v = editor.value;
            if (o.type === 'text') {
                if (!v.trim()) { objects = objects.filter((x) => x.id !== id); selectedId = null; }
                else o.text = v;
            } else if (o.cells[cell] !== v) o.cells[cell] = v;
            else { render(); return; }
            commit();
        } else if (o.type === 'text' && !o.text) { objects = objects.filter((x) => x.id !== id); selectedId = null; }
        tool = 'select';
        render();
    }
    editor.addEventListener('blur', () => closeEditor(true));
    editor.addEventListener('keydown', (e) => {
        e.stopPropagation();
        const cellEdit = editing && editing.cell !== undefined;
        if (e.key === 'Escape') closeEditor(false);
        else if (e.key === 'Enter' && (cellEdit ? !e.shiftKey : e.ctrlKey || e.metaKey)) { e.preventDefault(); closeEditor(true); }
    });

    document.querySelectorAll('#toolbar [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('shapes-btn').addEventListener('click', () => {
        const p = $('shapes-panel'); p.hidden = !p.hidden;
        $('shapes-btn').classList.toggle('on', !p.hidden);
    });
    document.querySelectorAll('.shape-grid button').forEach((b) => b.addEventListener('click', () => {
        setTool('shape:' + b.dataset.shape);
        if (matchMedia('(max-width: 700px)').matches) { $('shapes-panel').hidden = true; $('shapes-btn').classList.remove('on'); }
        if (colorIn.value === '#000000' && !isLinear({ type: b.dataset.shape })) colorIn.value = '#ffffff';
    }));

    colorIn.addEventListener('input', () => {
        const o = selected();
        if (o) { o.color = colorIn.value; render(); }
    });
    colorIn.addEventListener('change', () => { if (selectedId) commit(); });
    sizeIn.addEventListener('change', () => {
        const o = selected();
        const v = Math.max(1, Math.min(96, Number(sizeIn.value) || 1));
        sizeIn.value = v;
        if (!o) return;
        if (o.type === 'text') o.fontSize = v; else if (o.size) o.size = v; else return;
        render(); commit();
    });

    function deleteSelected() {
        if (!selectedId) return;
        objects = objects.filter((o) => o.id !== selectedId);
        selectedId = null; render(); commit();
    }
    $('delete').addEventListener('click', deleteSelected);

    $('table-btn').addEventListener('click', () => {
        const rows = parseInt(prompt(App.t('rows') + ' (1–30)', '4'), 10);
        if (!rows) return;
        const cols = parseInt(prompt(App.t('cols') + ' (1–12)', '3'), 10);
        if (!cols) return;
        addTable(Math.min(30, Math.max(1, rows)), Math.min(12, Math.max(1, cols)));
    });

    function viewCenter() { return { x: wrap.scrollLeft + wrap.clientWidth / 2, y: wrap.scrollTop + wrap.clientHeight / 2 }; }

    function addTable(rows, cols) {
        const c = viewCenter();
        const w = Math.min(cols * 120, 720), h = rows * 40;
        const o = newTable(rows, cols, Math.round(c.x - w / 2), Math.round(c.y - h / 2), w, h);
        objects.push(o); selectedId = o.id; tool = 'select'; commit(); render();
    }
    function newTable(rows, cols, x, y, w, h) {
        return { id: uid(), type: 'table', x, y, w, h, rows, cols, cells: Array(rows * cols).fill(''), color: '#ffffff' };
    }

    document.querySelectorAll('[data-tbl]').forEach((b) => b.addEventListener('click', () => {
        const o = selected();
        if (!o || o.type !== 'table') return;
        const act = b.dataset.tbl, rh = o.h / o.rows, cw = o.w / o.cols;
        if (act === 'addRow') { o.cells.push(...Array(o.cols).fill('')); o.rows++; o.h = rh * o.rows; }
        else if (act === 'delRow' && o.rows > 1) { o.cells.splice((o.rows - 1) * o.cols, o.cols); o.rows--; o.h = rh * o.rows; }
        else if (act === 'addCol') {
            const cells = []; for (let r = 0; r < o.rows; r++) cells.push(...o.cells.slice(r * o.cols, (r + 1) * o.cols), '');
            o.cells = cells; o.cols++; o.w = cw * o.cols;
        } else if (act === 'delCol' && o.cols > 1) {
            const cells = []; for (let r = 0; r < o.rows; r++) cells.push(...o.cells.slice(r * o.cols, (r + 1) * o.cols - 1));
            o.cells = cells; o.cols--; o.w = cw * o.cols;
        } else return;
        commit(); render();
    }));

    $('image-btn').addEventListener('click', () => $('file').click());
    $('file').addEventListener('change', (e) => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        const url = URL.createObjectURL(f);
        const img = new Image();
        img.onload = () => {
            const max = 1200, k = Math.min(1, max / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            const png = f.type === 'image/png' || f.type === 'image/gif' || f.type === 'image/svg+xml';
            const src = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85);
            URL.revokeObjectURL(url);
            const dw = Math.min(cv.width, 400), dh = dw * (cv.height / cv.width), c = viewCenter();
            const o = { id: uid(), type: 'image', x: Math.round(c.x - dw / 2), y: Math.round(c.y - dh / 2), w: dw, h: dh, src };
            objects.push(o); selectedId = o.id; tool = 'select'; commit(); render();
        };
        img.onerror = () => { URL.revokeObjectURL(url); alert('Could not read this image.'); };
        img.src = url;
    });

    document.addEventListener('keydown', (e) => {
        if (editing || e.target.matches('input, textarea')) return;
        const mod = e.ctrlKey || e.metaKey;
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); deleteSelected(); }
        else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
        else if (e.key === 'Escape') { setTool('select'); selectedId = null; render(); }
        else if (selectedId && e.key.startsWith('Arrow')) {
            const o = selected(), d = e.shiftKey ? 10 : 1;
            o.x += { ArrowLeft: -d, ArrowRight: d }[e.key] || 0;
            o.y += { ArrowUp: -d, ArrowDown: d }[e.key] || 0;
            e.preventDefault(); render(); markDirty();
        }
    });

    async function leave(url) { await flush(); window.location.href = url; }
    $('back').addEventListener('click', () => leave('/dashboard#projects'));
    $('settings-link').addEventListener('click', () => leave('/dashboard#settings'));
    $('logout').addEventListener('click', async () => { await flush(); App.logout(); });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) flush(); });

    $('title').addEventListener('change', async () => {
        const v = $('title').value.trim();
        if (!v) { $('title').value = project.title; return; }
        try { await App.api('/api/projects/' + projectId, 'PUT', { title: v }); project.title = v; document.title = v + ' – Planner'; setStatus('allSaved'); }
        catch (err) { alert(err.message); $('title').value = project.title; }
    });
    $('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

    $('share').addEventListener('click', async () => {
        const email = prompt(App.t('invitePrompt'));
        if (!email) return;
        try { await App.api(`/api/projects/${projectId}/invite`, 'POST', { email }); alert(App.t('inviteSent')); }
        catch (err) { alert(err.message); }
    });

    function paintMembers() {
        $('members').textContent = project.members.length ? App.t('members') + ': ' + project.members.map((m) => m.name).join(', ') : '';
    }

    function applyTemplate(p) {
        if (p.data.initialized) return false;
        p.data.initialized = true;
        if (p.template === 'list') {
            for (let i = 0; i < 14; i++) objects.push({ id: uid(), type: 'line', x: 80, y: 100 + i * 48, w: 900, h: 0, color: '#000000', size: 2 });
        } else if (p.template === 'grid') {
            objects.push(newTable(8, 5, 80, 80, 800, 8 * 44));
        }
        return true;
    }

    async function poll() {
        const busy = () => document.hidden || dirty || saving || drag || editing;
        if (busy()) return;
        try {
            const p = await App.api('/api/projects/' + projectId);
            if (p.updated_at !== lastUpdated && !busy()) {
                lastUpdated = p.updated_at;
                objects = p.data.objects; snapshot = JSON.stringify(objects);
                undoStack.length = 0; redoStack.length = 0;
                if (!selected()) selectedId = null;
                project.members = p.members; paintMembers();
                if (p.title !== project.title) { project.title = p.title; $('title').value = p.title; }
                render();
            }
        } catch { /* ignore transient poll errors */ }
    }

    (async () => {
        await App.init();
        try { project = await App.api('/api/projects/' + projectId); }
        catch { window.location.href = '/dashboard'; return; }
        document.title = project.title + ' – Planner';
        $('title').value = project.title;
        $('share').hidden = !project.is_owner;
        lastUpdated = project.updated_at;
        objects = project.data.objects || [];
        const fresh = applyTemplate(project);
        snapshot = JSON.stringify(objects);
        paintMembers();
        render();
        setStatus('');
        if (fresh) { project.data = { ...project.data }; markDirty(); }
        setInterval(poll, 5000);
    })();
})();
