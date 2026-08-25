
/* ════════════════════════════════════════
   HERRAMIENTAS — Lógica principal
════════════════════════════════════════ */

const user = Auth.requireAuth();
const canEdit = !Auth.isAlmacenista();
const canTransfer = true; // Todos los roles (incluido ALMACENISTA) pueden transferir herramientas
const isAlmacenista = Auth.isAlmacenista();
const allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

/* ── State ── */
let allTools = [];
let toolTypes = [];
let projects = [];
let warehouses = [];
let allWarehouses = [];
let currentView = 'grid';
let activeStatusFilter = '';
let currentDetailTool = null;
let currentQRTool = null;

/* ── Constants ── */
const COLORS = [
    { name: 'Amarillo', hex: '#F5C400' },
    { name: 'Rojo', hex: '#E03535' },
    { name: 'Naranja', hex: '#E67E22' },
    { name: 'Verde', hex: '#27AE60' },
    { name: 'Azul', hex: '#2980B9' },
    { name: 'Negro', hex: '#0D0D0D' },
    { name: 'Gris', hex: '#7F8C8D' },
    { name: 'Blanco', hex: '#FAFAFA' },
    { name: 'Café', hex: '#795548' },
    { name: 'Morado', hex: '#8E44AD' },
];

const STATUS_LABELS = {
    ACTIVA: { label: 'Activa', cls: 'status-activa', dot: '#27AE60' },
    PERDIDA: { label: 'PERDIDA', cls: 'status-perdida', dot: '#0D0D0D' },
    EN_MANTENIMIENTO: { label: 'En mantenimiento', cls: 'status-en_mantenimiento', dot: '7F8C8D' },
    REPARACION: { label: 'Reparación', cls: 'status-reparacion', dot: '#E03535' },
    RESGUARDO: { label: 'Resguardo', cls: 'status-resguardo', dot: '#2980B9' },
};

const TOOL_ICONS = {
    'Herramienta de corte': '🪚',
    'Herramienta de medición': '📏',
    'Herramienta eléctrica': '🔌',
    'Herramienta manual': '🔧',
    'Equipo de seguridad': '⛑️',
    'Equipo de elevación': '⛓️',
    'Equipo topográfico': '🔭',
    'Equipo de compactación': '🏗️',
    'Equipo de bombeo': '💧',
    'Otro': '🛠️',
};

/* ── Init ── */
if (user) {
    renderSidebar('nav-herramientas');
    if (canEdit) document.getElementById('btn-new-tool').style.display = '';
    if (!isRestricted || (allowedWarehouseIds && allowedWarehouseIds.length > 1)) {
        const fw = document.getElementById('filter-warehouse');
        if (fw) fw.style.display = '';
    }
    buildColorSwatches();
    loadAll();
}

/* ════════════════════════════════════════
   COLOR SWATCHES — definida aquí, donde
   el elemento #color-swatches ya existe
════════════════════════════════════════ */
function buildColorSwatches() {
    const wrap = document.getElementById('color-swatches');
    if (!wrap) return;
    wrap.innerHTML =
        '<div class="swatch-label">Colores rápidos:</div>' +
        COLORS.map(c => `
          <div class="swatch"
               style="background:${c.hex}; ${c.name === 'Blanco' ? 'border-color:#ddd;' : ''}"
               title="${c.name}"
               onclick="selectSwatch('${c.name}', this)">
          </div>`
        ).join('');
}

function selectSwatch(name, el) {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    document.getElementById('tool-color').value = name;
}

function clearSwatchSelection() {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    const colorInput = document.getElementById('tool-color');
    if (colorInput) colorInput.value = '';
}

function setSwatchByName(name) {
    document.querySelectorAll('.swatch').forEach(s => {
        s.classList.toggle('selected', s.title === name);
    });
}

function getColorHex(name) {
    return COLORS.find(c => c.name.toLowerCase() === (name || '').toLowerCase())?.hex || '#e0e0e0';
}

/* ════════════════════════════════════════
   DATA LOADING
════════════════════════════════════════ */
async function loadAll() {
    try {
        const [types, projs, whs, allWhs] = await Promise.all([
            fetchAll((f, t) => db.from('tool_types').select('*').order('name').range(f, t)),
            fetchAll((f, t) => db.from('projects').select('id,name,code').eq('is_active', true).order('name').range(f, t)),
            fetchAll((f, t) => {
                let q = db.from('warehouses').select('id,name').eq('is_active', true);
                if (isRestricted) {
                    q = q.in('id', allowedWarehouseIds.length > 0 ? allowedWarehouseIds : ['00000000-0000-0000-0000-000000000000']);
                }
                return q.order('name').range(f, t);
            }),
            fetchAll((f, t) => db.from('warehouses').select('id,name').eq('is_active', true).order('name').range(f, t)),
        ]);

        toolTypes = types || [];
        projects = projs || [];
        warehouses = whs || [];
        allWarehouses = allWhs || [];

        // Populate select options
        const tSel = document.getElementById('tool-tipo');
        toolTypes.forEach(t => {
            tSel.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        });

        const pSel = document.getElementById('tool-project');
        projects.forEach(p => {
            pSel.innerHTML += `<option value="${p.id}">${p.name} (${p.code})</option>`;
        });

        const wSel = document.getElementById('tool-warehouse');
        const wfSel = document.getElementById('filter-warehouse');
        if (wfSel) {
            wfSel.innerHTML = isRestricted ? '<option value="">Todos mis almacenes asignados</option>' : '<option value="">Todos los almacenes</option>';
        }
        warehouses.forEach(w => {
            if (wSel) wSel.innerHTML += `<option value="${w.id}">${w.name}</option>`;
            if (wfSel) wfSel.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        });

        await loadTools();
    } catch (err) {
        Toast.show('Error cargando datos: ' + err.message, 'error');
    }
}

async function loadTools() {
    showLoadingState();
    try {
        let queryFunc = (f, t) => {
            let q = db.from('herramientas')
                .select('*, tool_types(name), projects(name,code), warehouses(name)');
            if (isRestricted) {
                q = q.in('warehouse_id', allowedWarehouseIds.length > 0 ? allowedWarehouseIds : ['00000000-0000-0000-0000-000000000000']);
            }
            return q.order('codigo_head').range(f, t);
        };

        let countFunc = () => {
            let q = db.from('herramientas').select('id', { count: 'exact', head: true });
            if (isRestricted) {
                q = q.in('warehouse_id', allowedWarehouseIds.length > 0 ? allowedWarehouseIds : ['00000000-0000-0000-0000-000000000000']);
            }
            return q;
        };

        allTools = await fetchAll(queryFunc, countFunc);
    } catch (err) {
        Toast.show('Error cargando herramientas: ' + err.message, 'error');
        allTools = [];
    }
    renderAll();
}

/* ════════════════════════════════════════
   RENDER
════════════════════════════════════════ */
function showLoadingState() {
    document.getElementById('view-grid').innerHTML =
        `<div style="grid-column:1/-1; padding:60px; text-align:center;">
           <div class="spinner" style="margin:0 auto;"></div>
         </div>`;
    document.getElementById('tool-list-body').innerHTML = loadingRow(10);
}

function renderAll() {
    const q = document.getElementById('search-input').value.toLowerCase().trim();
    const sts = activeStatusFilter || document.getElementById('filter-status').value;
    const whId = document.getElementById('filter-warehouse').value;

    const active = allTools.filter(t => t.is_active !== false);

    const data = active.filter(t => {
        const mq = !q ||
            (t.nombre || '').toLowerCase().includes(q) ||
            (t.codigo_head || '').toLowerCase().includes(q) ||
            (t.marca || '').toLowerCase().includes(q) ||
            (t.modelo || '').toLowerCase().includes(q) ||
            (t.no_serie || '').toLowerCase().includes(q) ||
            (t.color || '').toLowerCase().includes(q);
        const ms = !sts || t.status === sts;
        const mw = !whId || t.warehouse_id === whId;
        return mq && ms && mw;
    });

    document.getElementById('record-count').textContent = `${data.length} herramienta(s)`;
    const activeForStatus = active.filter(t => !whId || t.warehouse_id === whId);
    renderStatusBar(activeForStatus);

    if (currentView === 'grid') {
        renderGrid(data);
    } else {
        renderList(data);
    }
}

function renderStatusBar(active) {
    const counts = {};
    Object.keys(STATUS_LABELS).forEach(k => counts[k] = 0);
    active.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

    const total = active.length;
    const bar = document.getElementById('status-bar');

    bar.innerHTML = `
        <div class="status-pill ${!activeStatusFilter ? 'active-filter' : ''}" onclick="setStatusFilter('')">
          <span class="pill-count">${total}</span> Total
        </div>` +
        Object.entries(STATUS_LABELS).map(([k, v]) => `
        <div class="status-pill ${activeStatusFilter === k ? 'active-filter' : ''}" onclick="setStatusFilter('${k}')">
          <span style="width:8px;height:8px;border-radius:50%;background:${v.dot};display:inline-block;"></span>
          <span class="pill-count">${counts[k]}</span> ${v.label}
        </div>`).join('');
}

function setStatusFilter(status) {
    activeStatusFilter = status;
    document.getElementById('filter-status').value = status;
    renderAll();
}

function renderGrid(data) {
    const grid = document.getElementById('view-grid');
    if (!data.length) {
        grid.innerHTML = `
          <div style="grid-column:1/-1;">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
              <p>Sin herramientas registradas</p>
            </div>
          </div>`;
        return;
    }

    grid.innerHTML = data.map(t => {
        const st = STATUS_LABELS[t.status] || { label: t.status, cls: '', dot: '#ccc' };
        const color = getColorHex(t.color);
        const icon = TOOL_ICONS[t.tool_types?.name] || '🛠️';
        return `
        <div class="tool-card" onclick="openDetail('${t.id}')">
          <div class="tool-card-color" style="background:${st.dot || '#ccc'};"></div>
          <div class="tool-card-inner">
            <div class="tool-card-header">
              <div>
                <div class="tool-card-code">${t.codigo_head}</div>
                <div class="tool-card-name">${t.nombre}</div>
                <div class="tool-card-type">${t.tool_types?.name || '—'}</div>
              </div>
              <div style="font-size:1.8rem; line-height:1; flex-shrink:0;">${icon}</div>
            </div>
            <div class="tool-card-body">
              ${t.marca || t.modelo ? `
              <div class="tool-meta-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.07 4.93A10 10 0 0 0 12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10"/>
                </svg>
                <span class="tool-meta-val">${[t.marca, t.modelo].filter(Boolean).join(' · ')}</span>
              </div>` : ''}
              ${t.no_serie ? `
              <div class="tool-meta-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="5" y="2" width="14" height="20" rx="2"/>
                  <line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <span class="tool-meta-val" style="font-family:var(--font-mono);font-size:0.71rem;">${t.no_serie}</span>
              </div>` : ''}
              ${t.projects ? `
              <div class="tool-meta-row">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="tool-meta-val">${t.projects.name}</span>
              </div>` : ''}
            </div>
            <div class="tool-card-footer">
              <span class="badge ${st.cls}">
                <span style="width:6px;height:6px;border-radius:50%;background:${st.dot};display:inline-block;margin-right:4px;"></span>
                ${st.label}
              </span>
              <div class="tool-card-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm btn-icon" title="Ver QR" onclick="openQR('${t.id}')">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/>
                  </svg>
                </button>
                ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="openEdit('${t.id}')">Editar</button>` : ''}
              </div>
            </div>
          </div>
        </div>`;
    }).join('');
}

function renderList(data) {
    const tbody = document.getElementById('tool-list-body');
    if (!data.length) { tbody.innerHTML = emptyRow(10, 'Sin herramientas'); return; }

    tbody.innerHTML = data.map(t => {
        const st = STATUS_LABELS[t.status] || { label: t.status, cls: '' };
        const color = getColorHex(t.color);
        return `
        <tr style="cursor:pointer;" onclick="openDetail('${t.id}')">
          <td class="code-cell">${t.codigo_head}</td>
          <td class="fw-600">${t.nombre}</td>
          <td class="text-muted">${t.tool_types?.name || '—'}</td>
          <td class="text-muted">${[t.marca, t.modelo].filter(Boolean).join(' / ') || '—'}</td>
          <td class="text-mono" style="font-size:0.74rem;">${t.no_serie || '—'}</td>
          <td>
            ${t.color
                ? `<span style="display:inline-flex;align-items:center;gap:6px;">
                   <span style="width:11px;height:11px;border-radius:50%;background:${color};border:1px solid #ddd;flex-shrink:0;"></span>
                   ${t.color}
                 </span>`
                : '—'}
          </td>
          <td><span class="badge ${st.cls}">${st.label}</span></td>
          <td class="text-muted">${t.projects?.name || '—'}</td>
          <td class="text-muted">${t.warehouses?.name || '—'}</td>
          <td onclick="event.stopPropagation()">
            <div style="display:flex;gap:4px;">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="openQR('${t.id}')" title="QR">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="4" height="4"/>
                </svg>
              </button>
              ${canEdit ? `<button class="btn btn-ghost btn-sm" onclick="openEdit('${t.id}')">Editar</button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
}

/* ════════════════════════════════════════
   VIEW TOGGLE
════════════════════════════════════════ */
function setView(v) {
    currentView = v;
    document.getElementById('view-grid').style.display = v === 'grid' ? '' : 'none';
    document.getElementById('view-list').style.display = v === 'list' ? '' : 'none';
    document.getElementById('btn-view-grid').classList.toggle('active', v === 'grid');
    document.getElementById('btn-view-list').classList.toggle('active', v === 'list');
    renderAll();
}

/* ════════════════════════════════════════
   FILTERS
════════════════════════════════════════ */
document.getElementById('search-input').addEventListener('input', renderAll);
document.getElementById('filter-status').addEventListener('change', e => {
    activeStatusFilter = e.target.value;
    renderAll();
});
document.getElementById('filter-warehouse').addEventListener('change', renderAll);

/* ════════════════════════════════════════
   DETAIL MODAL
════════════════════════════════════════ */
async function openDetail(id) {
    const t = allTools.find(x => x.id === id);
    if (!t) return;
    currentDetailTool = t;

    const st = STATUS_LABELS[t.status] || { label: t.status, cls: '', dot: '#ccc' };
    const color = getColorHex(t.color);
    const icon = TOOL_ICONS[t.tool_types?.name] || '🛠️';

    document.getElementById('detail-band').style.background = st.dot || '#ccc';
    document.getElementById('detail-icon').textContent = icon;
    document.getElementById('detail-code').textContent = t.codigo_head;
    document.getElementById('detail-name').textContent = t.nombre;
    document.getElementById('detail-type').textContent = t.tool_types?.name || 'Sin tipo';
    document.getElementById('detail-status-badge').innerHTML =
        `<span class="badge ${st.cls}">
           <span style="width:6px;height:6px;border-radius:50%;background:${st.dot};display:inline-block;margin-right:4px;"></span>
           ${st.label}
         </span>`;

    const colorDot = t.color
        ? `<span style="display:inline-flex;align-items:center;gap:6px;">
             <span style="width:10px;height:10px;border-radius:50%;background:${color};border:1px solid #ddd;flex-shrink:0;"></span>
             ${t.color}
           </span>`
        : '—';

    const fields = [
        ['Marca', t.marca || '—', false],
        ['Modelo', t.modelo || '—', false],
        ['No. Serie', t.no_serie || '—', true],
        ['Color', colorDot, false],
        ['Proyecto', t.projects?.name || 'Sin proyecto', false],
        ['Almacén', t.warehouses?.name || 'Sin almacén', false],
        ['Creado', fmt.date(t.created_at), false],
        ['Actualizado', fmt.date(t.updated_at), false],
    ];

    document.getElementById('detail-grid').innerHTML = fields.map(([l, v, mono]) => `
        <div class="detail-field">
          <div class="df-label">${l}</div>
          <div class="df-val ${mono ? 'mono' : ''}">${v}</div>
        </div>`
    ).join('');

    const descWrap = document.getElementById('detail-desc-wrap');
    if (t.descripcion) {
        descWrap.style.display = '';
        document.getElementById('detail-desc').textContent = t.descripcion;
    } else {
        descWrap.style.display = 'none';
    }

    document.getElementById('detail-edit-btn').style.display = canEdit ? '' : 'none';
    document.getElementById('detail-transfer-btn').style.display = canTransfer ? '' : 'none';
    Modal.open('modal-detail');
    loadTimeline(id);
}

async function loadTimeline(id) {
    const tl = document.getElementById('detail-timeline');
    tl.innerHTML = `<div class="page-loader"><div class="spinner"></div></div>`;

    try {
        /* Usamos 'created_by(full_name)' — Supabase resuelve el join
           por el nombre de la columna FK, no por el nombre de la tabla */
        const { data, error } = await db
            .from('herramienta_movements')
            .select(`
            id, created_at, notes,
            prev_status, new_status,
            prev_project_id, new_project_id,
            prev_warehouse_id, new_warehouse_id,
            prev_warehouse_name, new_warehouse_name,
            created_by (full_name),
            projects:new_project_id (name)
          `)
            .eq('herramienta_id', id)
            .order('created_at', { ascending: false })
            .limit(30);

        if (error) { console.error('Timeline error:', error); throw error; }

        if (!data || !data.length) {
            tl.innerHTML = `<p class="text-muted" style="font-size:0.82rem; padding-bottom:16px;">Sin movimientos registrados.</p>`;
            return;
        }

        tl.innerHTML = data.map(m => {
            const prevSt = STATUS_LABELS[m.prev_status]?.label || m.prev_status || '—';
            const newSt = STATUS_LABELS[m.new_status]?.label || m.new_status || '—';
            const dot = STATUS_LABELS[m.new_status]?.dot || 'var(--yellow)';
            const lines = [];
            let whTransfer = '';

            if (m.prev_status !== m.new_status)
                lines.push(`Estado: ${prevSt} → ${newSt}`);
            if (m.new_project_id !== m.prev_project_id)
                lines.push(`Proyecto: ${m.projects?.name || 'Sin proyecto'}`);

            /* ── Transferencia de almacén ── */
            if (m.prev_warehouse_name || m.new_warehouse_name) {
                const origin = m.prev_warehouse_name || 'Sin almacén';
                const dest = m.new_warehouse_name || 'Sin almacén';
                lines.push(`🚛 Traslado de almacén`);
                whTransfer = `
              <div style="margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span class="tl-wh-badge">📦 ${origin}</span>
                <span style="color:var(--gray-mid);font-size:0.8rem;">→</span>
                <span class="tl-wh-badge" style="background:rgba(39,174,96,.1);color:#1a8a4a;">📦 ${dest}</span>
              </div>`;
            }

            if (!lines.length) lines.push('Actualización registrada');

            return `
          <div class="timeline-item">
            <div>
              <div class="timeline-dot" style="background:${dot};"></div>
              <div class="timeline-line"></div>
            </div>
            <div class="timeline-content">
              <div class="timeline-date">${fmt.datetime(m.created_at)} · ${m.created_by?.full_name || 'Sistema'}</div>
              <div class="timeline-text">${lines.join(' · ')}</div>
              ${whTransfer}
              ${m.notes ? `<div class="timeline-notes">"${m.notes}"</div>` : ''}
            </div>
          </div>`;
        }).join('');
    } catch (err) {
        console.error('Timeline catch:', err);
        tl.innerHTML = `<p class="text-muted" style="font-size:0.82rem; color:#b52525;">Error: ${err.message || 'Error cargando historial'}</p>`;
    }
}

function openQRFromDetail() {
    if (currentDetailTool) openQR(currentDetailTool.id);
}
function editFromDetail() {
    if (currentDetailTool) { Modal.close('modal-detail'); openEdit(currentDetailTool.id); }
}
function openTransferFromDetail() {
    if (currentDetailTool) { Modal.close('modal-detail'); openTransfer(currentDetailTool.id); }
}
async function reprintTransferFromDetail() {
    if (!currentDetailTool) return;
    try {
        const { data, error } = await db
            .from('herramienta_movements')
            .select(`
            id,
            prev_warehouse_name,
            new_warehouse_name,
            notes,
            created_at,
            herramientas!inner(id, codigo_head, nombre, status, color, marca, modelo, no_serie, descripcion),
            users!herramienta_movements_created_by_fkey(full_name)
          `)
            .eq('herramienta_id', currentDetailTool.id)
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;

        const transfer = (data || []).find(m => m.prev_warehouse_name && m.new_warehouse_name && m.prev_warehouse_name !== m.new_warehouse_name);
        if (!transfer) {
            Toast.show('No se encontró registro de transferencia para esta herramienta', 'error');
            return;
        }

        const t = {
            ...currentDetailTool,
            ...transfer.herramientas,
            status: transfer.herramientas?.status || currentDetailTool.status,
            color: transfer.herramientas?.color || currentDetailTool.color,
            marca: transfer.herramientas?.marca || currentDetailTool.marca,
            modelo: transfer.herramientas?.modelo || currentDetailTool.modelo,
            no_serie: transfer.herramientas?.no_serie || currentDetailTool.no_serie,
            descripcion: transfer.herramientas?.descripcion || currentDetailTool.descripcion,
        };
        printTransferFormat({
            tool: t,
            prevWh: { name: transfer.prev_warehouse_name || '—' },
            newWh: { name: transfer.new_warehouse_name || '—' },
            reason: transfer.notes || 'Reimpresión de traslado',
            userName: transfer.users?.full_name || user.full_name || user.email || 'Usuario',
            date: new Date(transfer.created_at || Date.now()),
        });
        Toast.show('Reimpresión de transferencia generada', 'success');
    } catch (err) {
        console.error('Reimpresión transferencia:', err);
        Toast.show(err.message || 'Error al reimprimir transferencia', 'error');
    }
}
function openBitacoraFromDetail() {
    if (!currentDetailTool) return;
    const t = currentDetailTool;
    const imageHtml = t.image_url ? `<img src="${t.image_url}" style="max-width:160px;max-height:160px;object-fit:contain;border:1px solid #ddd;padding:6px;"/>` : '';
    const html = '<!doctype html>' +
        '<html>' +
        '<head>' +
        '  <meta charset="utf-8">' +
        '  <title>Bitácora - ' + escapeHtml(t.nombre) + '</title>' +
        '  <style>' +
        '    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:20px}' +
        '    .header{display:flex;gap:20px;align-items:center}' +
        '    .info{flex:1}' +
        '    h1{font-size:18px;margin:0 0 6px}' +
        '    .meta{font-size:13px;color:#444;margin-top:6px}' +
        '    table{width:100%;border-collapse:collapse;margin-top:14px}' +
        '    th,td{border:1px solid #bbb;padding:8px;text-align:left;font-size:13px}' +
        '    th{background:#f5f5f5}' +
        '    .small{font-size:12px;color:#666}' +
        '    .photo-wrap{width:170px;text-align:center}' +
        '  <\/style>' +
        '<\/head>' +
        '<body>' +
        '  <div class="header">' +
        '    <div class="info">' +
        '      <h1>Bitácora de asignación de herramienta</h1>' +
        '      <div class="meta"><strong>Herramienta:</strong> ' + escapeHtml(t.nombre) + ' &nbsp; | &nbsp; <strong>Código:</strong> ' + escapeHtml(t.codigo_head || '') + '</div>' +
        '      <div class="meta"><strong>Tipo:</strong> ' + escapeHtml(t.tool_types?.name || '') + ' &nbsp; | &nbsp; <strong>Marca/Modelo:</strong> ' + escapeHtml([t.marca, t.modelo].filter(Boolean).join(' / ')) + '</div>' +
        '      <div class="meta"><strong>No. Serie:</strong> ' + escapeHtml(t.no_serie || '') + '</div>' +
        '    </div>' +
        '    <div class="photo-wrap">' + imageHtml + '</div>' +
        '  </div>' +
        '  <table>' +
        '    <thead>' +
        '      <tr>' +
        '        <th style="width:18%">Fecha</th>' +
        '        <th style="width:32%">Responsable</th>' +
        '        <th style="width:15%">Hora entrada</th>' +
        '        <th style="width:15%">Hora salida</th>' +
        '        <th style="width:20%">Firma</th>' +
        '      </tr>' +
        '    </thead>' +
        '    <tbody>' +
        new Array(30).fill(0).map(() => '<tr><td>&nbsp;<\/td><td>&nbsp;<\/td><td>&nbsp;<\/td><td>&nbsp;<\/td><td>&nbsp;<\/td></tr>').join('') +
        '    <\/tbody>' +
        '  <\/table>' +
        '  <div style="margin-top:18px;font-size:12px;color:#555">Impreso: ' + new Date().toLocaleString() + '</div>' +
        '  <script>function init(){window.print();}init();<\/script>' +
        '<\/body>' +
        '<\/html>';

    const w = window.open('', '_blank');
    if (!w) { alert('Pop-up bloqueado. Permita ventanas emergentes para imprimir.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ════════════════════════════════════════
   CREATE / EDIT MODAL
════════════════════════════════════════ */
function resetForm() {
    ['tool-id', 'tool-codigo', 'tool-nombre', 'tool-desc', 'tool-color',
        'tool-marca', 'tool-modelo', 'tool-serie', 'tool-image', 'tool-notes']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('tool-tipo').value = '';
    document.getElementById('tool-status').value = 'ACTIVA';
    document.getElementById('tool-project').value = '';
    document.getElementById('tool-warehouse').value = '';
    clearSwatchSelection();
}

function openCreate() {
    if (!canEdit) { Toast.show('Sin permiso para crear herramientas', 'error'); return; }
    document.getElementById('tool-modal-title').textContent = 'Nueva Herramienta';
    document.getElementById('tool-notes-wrap').style.display = 'none';
    resetForm();
    Modal.open('modal-tool');
}

function openEdit(id) {
    if (!canEdit) { Toast.show('Sin permiso para editar', 'error'); return; }
    const t = allTools.find(x => x.id === id);
    if (!t) return;

    document.getElementById('tool-modal-title').textContent = 'Editar Herramienta';
    document.getElementById('tool-notes-wrap').style.display = '';

    document.getElementById('tool-id').value = t.id;
    document.getElementById('tool-codigo').value = t.codigo_head || '';
    document.getElementById('tool-nombre').value = t.nombre || '';
    document.getElementById('tool-desc').value = t.descripcion || '';
    document.getElementById('tool-tipo').value = t.tipo_id || '';
    document.getElementById('tool-color').value = t.color || '';
    document.getElementById('tool-marca').value = t.marca || '';
    document.getElementById('tool-modelo').value = t.modelo || '';
    document.getElementById('tool-serie').value = t.no_serie || '';
    document.getElementById('tool-status').value = t.status || 'ACTIVA';
    document.getElementById('tool-project').value = t.project_id || '';
    document.getElementById('tool-warehouse').value = t.warehouse_id || '';
    document.getElementById('tool-image').value = t.image_url || '';
    document.getElementById('tool-notes').value = '';

    setSwatchByName(t.color || '');
    Modal.open('modal-tool');
}

document.getElementById('btn-tool-save').addEventListener('click', async () => {
    const id = document.getElementById('tool-id').value.trim();
    const codigo = document.getElementById('tool-codigo').value.trim();
    const nombre = document.getElementById('tool-nombre').value.trim();

    if (!codigo || !nombre) {
        Toast.show('CódigoHEAD y Nombre son obligatorios', 'error');
        return;
    }

    const status = document.getElementById('tool-status').value;
    const notes = document.getElementById('tool-notes').value.trim() || null;

    const payload = {
        codigo_head: codigo,
        nombre,
        descripcion: document.getElementById('tool-desc').value.trim() || null,
        tipo_id: document.getElementById('tool-tipo').value || null,
        color: document.getElementById('tool-color').value.trim() || null,
        marca: document.getElementById('tool-marca').value.trim() || null,
        modelo: document.getElementById('tool-modelo').value.trim() || null,
        no_serie: document.getElementById('tool-serie').value.trim() || null,
        status,
        project_id: document.getElementById('tool-project').value || null,
        warehouse_id: document.getElementById('tool-warehouse').value || null,
        image_url: document.getElementById('tool-image').value.trim() || null,
    };

    const btn = document.getElementById('btn-tool-save');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    try {
        if (id) {
            /* ── Editar ── */
            const prev = allTools.find(x => x.id === id);
            const { error } = await db.from('herramientas').update(payload).eq('id', id);
            if (error) throw error;

            const changed = prev && (
                prev.status !== status ||
                prev.project_id !== payload.project_id ||
                prev.warehouse_id !== payload.warehouse_id
            );
            if (changed) {
                /* Resolve warehouse names for the movement record */
                const prevWh = warehouses.find(w => w.id === (prev.warehouse_id || null));
                const newWh = warehouses.find(w => w.id === (payload.warehouse_id || null));
                await db.from('herramienta_movements').insert({
                    herramienta_id: id,
                    prev_status: prev.status,
                    new_status: status,
                    prev_project_id: prev.project_id || null,
                    new_project_id: payload.project_id,
                    prev_warehouse_id: prev.warehouse_id || null,
                    new_warehouse_id: payload.warehouse_id || null,
                    prev_warehouse_name: prevWh?.name || null,
                    new_warehouse_name: newWh?.name || null,
                    notes,
                    created_by: user.id,
                });
            }
            Toast.show('Herramienta actualizada', 'success');

        } else {
            /* ── Crear ── */
            payload.created_by = user.id;
            const { data, error } = await db.from('herramientas').insert(payload).select().single();
            if (error) throw error;

            await db.from('herramienta_movements').insert({
                herramienta_id: data.id,
                prev_status: null,
                new_status: status,
                new_project_id: payload.project_id,
                notes: 'Herramienta registrada en el sistema',
                created_by: user.id,
            });
            Toast.show('Herramienta creada exitosamente', 'success');
        }

        Modal.close('modal-tool');
        await loadTools();

    } catch (err) {
        Toast.show(err.message || 'Error al guardar', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
});

/* ════════════════════════════════════════
   TRANSFER MODAL
════════════════════════════════════════ */
let currentTransferTool = null;

async function openTransfer(id) {
    if (!canTransfer) { Toast.show('Sin permiso para transferir herramientas', 'error'); return; }
    const t = allTools.find(x => x.id === id);
    if (!t) return;
    currentTransferTool = t;

    /* Populate tool chip */
    const icon = TOOL_ICONS[t.tool_types?.name] || '🛠️';
    document.getElementById('transfer-chip-icon').textContent = icon;
    document.getElementById('transfer-chip-code').textContent = t.codigo_head;
    document.getElementById('transfer-chip-name').textContent = t.nombre;

    /* Origin warehouse */
    const originName = t.warehouses?.name || 'Sin almacén';
    document.getElementById('transfer-origin-name').textContent = originName;

    /* Populate destination selector — show all active warehouses only in transfers */
    const newWh = document.getElementById('transfer-dest');
    newWh.innerHTML = '<option value="">Selecciona un almacén...</option>';
    allWarehouses.forEach(w => {
        if (w.id === t.warehouse_id) return; // skip current
        newWh.innerHTML += `<option value="${w.id}">${w.name}</option>`;
    });

    /* Reset form */
    document.getElementById('transfer-status').value = t.status || '';
    document.getElementById('transfer-reason').value = '';
    document.getElementById('transfer-notes').value = '';
    document.getElementById('transfer-custom-reason').value = '';
    document.getElementById('transfer-custom-wrap').style.display = 'none';
    document.getElementById('transfer-dest-preview').textContent = 'Selecciona...';

    /* Live preview */
    newWh.onchange = () => {
        const sel = newWh.options[newWh.selectedIndex];
        document.getElementById('transfer-dest-preview').textContent =
            sel.value ? sel.text : 'Selecciona...';
    };

    /* ── Permitir transferencias para ALMACENISTA ── */
    document.getElementById('transfer-modal-title-text').textContent = 'Transferir Herramienta';
    document.getElementById('transfer-route').style.display = '';
    document.getElementById('transfer-dest-wrap').style.display = '';
    document.getElementById('transfer-reason-label').textContent = 'Motivo de transferencia *';

    /* Mostrar opciones de traslado para todos los roles */
    document.querySelectorAll('#transfer-reason option[data-role]').forEach(opt => {
        const role = opt.getAttribute('data-role');
        opt.hidden = role !== 'transfer-only';
    });

    const saveBtnLabel = document.getElementById('btn-transfer-save-label');
    if (saveBtnLabel) saveBtnLabel.textContent = 'Confirmar Transferencia';

    Modal.open('modal-transfer');
}

function onTransferReasonChange() {
    const v = document.getElementById('transfer-reason').value;
    document.getElementById('transfer-custom-wrap').style.display = v === 'otro' ? '' : 'none';
}

document.getElementById('btn-transfer-save').addEventListener('click', async () => {
    if (!currentTransferTool) return;

    const destId = document.getElementById('transfer-dest').value;
    const status = document.getElementById('transfer-status').value;
    const reasonSel = document.getElementById('transfer-reason').value;
    const reasonCustom = document.getElementById('transfer-custom-reason').value.trim();
    const extraNotes = document.getElementById('transfer-notes').value.trim();

    if (!destId) {
        Toast.show('Selecciona el almacén destino', 'error'); return;
    }
    if (!status) {
        Toast.show('Selecciona el estatus de la herramienta', 'error'); return;
    }
    if (!reasonSel) {
        Toast.show('Selecciona el motivo de la transferencia', 'error'); return;
    }
    if (reasonSel === 'otro' && !reasonCustom) {
        Toast.show('Especifica el motivo', 'error'); return;
    }

    const reason = reasonSel === 'otro' ? reasonCustom : reasonSel;
    const notes = [reason, extraNotes].filter(Boolean).join(' — ');

    const t = currentTransferTool;
    const prevWh = allWarehouses.find(w => w.id === t.warehouse_id) || warehouses.find(w => w.id === t.warehouse_id);
    const newWh = allWarehouses.find(w => w.id === destId) || warehouses.find(w => w.id === destId);

    const btn = document.getElementById('btn-transfer-save');
    btn.disabled = true;
    btn.textContent = 'Transfiriendo...';

    try {
        /* 1. Update tool */
        const { error: updErr } = await db
            .from('herramientas')
            .update({ warehouse_id: destId, status: status })
            .eq('id', t.id);
        if (updErr) throw updErr;

        /* 2. Insert movement record */
        const { error: movErr } = await db.from('herramienta_movements').insert({
            herramienta_id: t.id,
            prev_status: t.status,
            new_status: status,
            prev_project_id: t.project_id || null,
            new_project_id: t.project_id || null,
            prev_warehouse_id: t.warehouse_id || null,
            new_warehouse_id: destId,
            prev_warehouse_name: prevWh?.name || null,
            new_warehouse_name: newWh?.name || null,
            notes,
            created_by: user.id,
        });
        if (movErr) throw movErr;

        /* 3. Generate & print transfer document */
        t.status = status;
        printTransferFormat({
            tool: t,
            prevWh: prevWh,
            newWh: newWh,
            reason: notes,
            userName: user.full_name || user.email || 'Usuario',
            date: new Date(),
        });

        Toast.show(`✅ Herramienta transferida a ${newWh?.name || 'nuevo almacén'}`, 'success');
        Modal.close('modal-transfer');
        await loadTools();

    } catch (err) {
        Toast.show(err.message || (isAlmacenista ? 'Error al cambiar el estatus' : 'Error al transferir'), 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg> <span id="btn-transfer-save-label">Confirmar Transferencia</span>`;
    }
});

/* ════════════════════════════════════════
   TRANSFER FORMAT (VALE DE TRASLADO)
════════════════════════════════════════ */
function printTransferFormat({ tool: t, prevWh, newWh, reason, userName, date }) {
    const folio = 'TRF-' + date.getFullYear() +
        String(date.getMonth() + 1).padStart(2, '0') +
        String(date.getDate()).padStart(2, '0') + '-' +
        Math.floor(Math.random() * 9000 + 1000);
    const fechaStr = date.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    const horaStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const st = STATUS_LABELS[t.status] || { label: t.status || '—', dot: '#ccc' };
    const color = getColorHex(t.color);

    const css = [
        '@page{size:Letter;margin:15mm 18mm;}',
        '*{box-sizing:border-box;margin:0;padding:0;}',
        'body{font-family:Arial,sans-serif;color:#0d0d0d;font-size:10pt;background:#fff;}',

        /* Header */
        '.doc-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0d0d0d;padding-bottom:10px;margin-bottom:16px;}',
        '.brand{display:flex;align-items:center;gap:10px;}',
        '.brand-logo{width:44px;height:44px;background:#0d0d0d;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#F5C400;font-family:monospace;font-weight:900;font-size:11pt;}',
        '.brand-name{font-weight:900;font-size:13pt;letter-spacing:1px;}',
        '.brand-sub{font-size:7.5pt;color:#666;letter-spacing:0.5px;margin-top:2px;}',
        '.doc-meta{text-align:right;}',
        '.doc-title{font-size:13pt;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#0d0d0d;}',
        '.doc-folio{font-family:monospace;font-size:9pt;color:#666;margin-top:4px;}',
        '.doc-date{font-size:8.5pt;color:#444;margin-top:2px;}',

        /* Alert banner */
        '.transfer-banner{background:#0d0d0d;color:#F5C400;padding:8px 14px;border-radius:5px;margin-bottom:16px;display:flex;align-items:center;gap:10px;}',
        '.transfer-banner svg{flex-shrink:0;}',
        '.banner-text{font-weight:700;font-size:10.5pt;letter-spacing:0.5px;}',
        '.banner-sub{font-size:8pt;opacity:.8;margin-top:1px;}',

        /* Route */
        '.route-section{display:flex;align-items:stretch;gap:0;margin-bottom:16px;border:1.5px solid #e0e0e0;border-radius:6px;overflow:hidden;}',
        '.route-box{flex:1;padding:12px 14px;}',
        '.route-box.origin{background:#f9f9f9;}',
        '.route-box.destination{background:rgba(245,196,0,.08);border-left:1.5px solid #e0e0e0;}',
        '.route-label{font-size:7pt;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:5px;}',
        '.route-wh{font-size:12pt;font-weight:900;color:#0d0d0d;}',
        '.route-arrow{display:flex;align-items:center;padding:0 12px;background:#fff;color:#bbb;font-size:18pt;font-weight:300;}',

        /* Tool card */
        '.tool-card-doc{border:1.5px solid #e0e0e0;border-radius:6px;padding:12px 14px;margin-bottom:16px;display:flex;gap:12px;align-items:center;}',
        '.tool-color-strip{width:5px;border-radius:3px;align-self:stretch;flex-shrink:0;}',
        '.tool-info{flex:1;}',
        '.tool-code-doc{font-family:monospace;font-size:8pt;color:#999;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:3px;}',
        '.tool-name-doc{font-weight:900;font-size:12pt;margin-bottom:4px;}',
        '.tool-meta-doc{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px;}',
        '.meta-item{font-size:8pt;color:#555;}',
        '.meta-label{font-weight:700;color:#333;display:block;font-size:7pt;text-transform:uppercase;letter-spacing:1px;}',
        '.status-chip-doc{display:inline-block;padding:2px 10px;border-radius:99px;font-size:8pt;font-weight:700;background:#e8f5e9;color:#1a8a4a;margin-top:6px;align-self:center;}',

        /* Details grid */
        '.details-title{font-size:8pt;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;color:#888;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #efefef;}',
        '.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1.5px solid #e0e0e0;border-radius:6px;overflow:hidden;margin-bottom:16px;}',
        '.detail-cell{padding:9px 12px;border-bottom:1px solid #f0f0f0;border-right:1px solid #f0f0f0;}',
        '.detail-cell:nth-child(even){border-right:none;}',
        '.detail-cell:nth-last-child(-n+2){border-bottom:none;}',
        '.dc-label{font-size:7pt;text-transform:uppercase;letter-spacing:1px;color:#999;margin-bottom:3px;}',
        '.dc-val{font-size:9.5pt;font-weight:700;color:#0d0d0d;}',

        /* Reason */
        '.reason-box{border:1.5px solid #e0e0e0;border-radius:6px;padding:10px 14px;margin-bottom:16px;background:#fafafa;}',
        '.reason-label{font-size:7pt;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;color:#888;margin-bottom:5px;}',
        '.reason-text{font-size:10pt;color:#0d0d0d;line-height:1.5;}',

        /* Signatures */
        '.signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:8px;}',
        '.sig-block{border-top:1.5px solid #0d0d0d;padding-top:8px;text-align:center;}',
        '.sig-label{font-size:7.5pt;text-transform:uppercase;letter-spacing:1px;color:#555;font-weight:700;}',
        '.sig-name{font-size:8pt;color:#888;margin-top:4px;}',

        /* Footer */
        '.doc-footer{text-align:center;font-size:7pt;color:#bbb;border-top:1px solid #efefef;padding-top:8px;margin-top:20px;}',
        '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact;}}'
    ].join('');

    const html =
        '<!DOCTYPE html>' +
        '<html lang="es"><head><meta charset="UTF-8"/>' +
        '<title>Vale de Transferencia ' + folio + '<\/title>' +
        '<style>' + css + '<\/style><\/head><body>' +

        // ── Header
        '<div class="doc-header">' +
        '<div class="brand">' +
        '<div class="brand-logo">HS<\/div>' +
        '<div><div class="brand-name">HEAD STORE<\/div><div class="brand-sub">Sistema de Inventarios \u00b7 Control de Herramientas<\/div><\/div>' +
        '<\/div>' +
        '<div class="doc-meta">' +
        '<div class="doc-title">Vale de Transferencia<\/div>' +
        '<div class="doc-folio">Folio: ' + folio + '<\/div>' +
        '<div class="doc-date">' + fechaStr + ' \u00b7 ' + horaStr + '<\/div>' +
        '<\/div>' +
        '<\/div>' +

        // ── Banner
        '<div class="transfer-banner">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="#F5C400" stroke-width="2" width="22" height="22">' +
        '<rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/>' +
        '<circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' +
        '<\/svg>' +
        '<div><div class="banner-text">MOVIMIENTO DE HERRAMIENTA ENTRE ALMACENES<\/div>' +
        '<div class="banner-sub">Este documento ampara el traslado f\u00edsico de la herramienta descrita a continuaci\u00f3n.<\/div><\/div>' +
        '<\/div>' +

        // ── Route
        '<div class="route-section">' +
        '<div class="route-box origin">' +
        '<div class="route-label">\u25b6 Almac\u00e9n Origen<\/div>' +
        '<div class="route-wh">' + (prevWh?.name || 'Sin almac\u00e9n') + '<\/div>' +
        '<\/div>' +
        '<div class="route-arrow">\u2192<\/div>' +
        '<div class="route-box destination">' +
        '<div class="route-label">\u25b6 Almac\u00e9n Destino<\/div>' +
        '<div class="route-wh">' + (newWh?.name || '\u2014') + '<\/div>' +
        '<\/div>' +
        '<\/div>' +

        // ── Tool card
        '<div class="tool-card-doc">' +
        '<div class="tool-color-strip" style="background:' + (st.dot || '#ccc') + ';"><\/div>' +
        '<div class="tool-info">' +
        '<div class="tool-code-doc">' + (t.codigo_head || '') + '<\/div>' +
        '<div class="tool-name-doc">' + (t.nombre || '') + '<\/div>' +
        '<div class="tool-meta-doc">' +
        (t.tool_types?.name ? '<div class="meta-item"><span class="meta-label">Tipo<\/span>' + t.tool_types.name + '<\/div>' : '') +
        (t.marca ? '<div class="meta-item"><span class="meta-label">Marca<\/span>' + t.marca + '<\/div>' : '') +
        (t.modelo ? '<div class="meta-item"><span class="meta-label">Modelo<\/span>' + t.modelo + '<\/div>' : '') +
        (t.no_serie ? '<div class="meta-item"><span class="meta-label">No. Serie<\/span><span style="font-family:monospace;">' + t.no_serie + '<\/span><\/div>' : '') +
        (t.color ? '<div class="meta-item"><span class="meta-label">Color<\/span>' + t.color + '<\/div>' : '') +
        '<\/div>' +
        '<\/div>' +
        '<\/div>' +

        // ── Details grid
        '<div class="details-title">Informaci\u00f3n adicional<\/div>' +
        '<div class="details-grid">' +
        '<div class="detail-cell"><div class="dc-label">Estado de la herramienta<\/div><div class="dc-val">' + st.label + '<\/div><\/div>' +
        '<div class="detail-cell"><div class="dc-label">Fecha de transferencia<\/div><div class="dc-val">' + fechaStr + '<\/div><\/div>' +
        '<div class="detail-cell"><div class="dc-label">Hora de transferencia<\/div><div class="dc-val">' + horaStr + '<\/div><\/div>' +
        '<\/div>' +

        // ── Reason
        '<div class="reason-box">' +
        '<div class="reason-label">Motivo del traslado<\/div>' +
        '<div class="reason-text">' + (reason || 'Sin especificar') + '<\/div>' +
        '<\/div>' +

        // ── Signatures
        '<div class="details-title">Firmas de conformidad<\/div>' + '<div style="height: 100px;"><\/div>' +
        '<div class="signatures">' +
        '<div class="sig-block"><div class="sig-label">Entregado por<\/div><div class="sig-name">' + userName + '<\/div><\/div>' +
        '<div class="sig-block"><div class="sig-label">Recibido por<\/div><div class="sig-name">Nombre y firma<\/div><\/div>' +
        '<div class="sig-block"><div class="sig-label">Autorizado por<\/div><div class="sig-name">Nombre y firma<\/div><\/div>' +
        '<\/div>' +

        // ── Footer
        '<div class="doc-footer">' +
        'HEAD STORE \u00b7 Sistema de Inventarios \u00b7 Folio: ' + folio + ' \u00b7 Generado el ' + fechaStr +
        '<\/div>' +

        '<\/body><\/html>';

    const win = window.open('', '_blank', 'width=820,height=1060');
    if (!win) { Toast.show('Permite ventanas emergentes para imprimir el vale', 'warning'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.addEventListener('load', () => {
        setTimeout(() => win.print(), 400);
    });
}

/* ════════════════════════════════════════
   QR MODAL
════════════════════════════════════════ */
async function openQR(id) {
    const t = allTools.find(x => x.id === id);
    if (!t) return;
    currentQRTool = t;

    const st = STATUS_LABELS[t.status] || { label: t.status };

    const qrData = JSON.stringify({
        app: 'HEAD STORE',
        id: t.id,
        codigo: t.codigo_head,
        nombre: t.nombre,
        tipo: t.tool_types?.name || '',
        marca: t.marca || '',
        modelo: t.modelo || '',
        serie: t.no_serie || '',
        color: t.color || '',
        status: st.label,
        proyecto: t.projects?.name || '',
        almacen: t.warehouses?.name || '',
    });

    document.getElementById('qr-tool-title').textContent = t.codigo_head;
    document.getElementById('qr-name').textContent = t.nombre;
    document.getElementById('qr-code-label').textContent = t.codigo_head;

    Modal.open('modal-qr');

    const canvas = document.getElementById('qr-canvas');
    try {
        await QRCode.toCanvas(canvas, qrData, {
            width: 200,
            margin: 1,
            color: { dark: '#0d0d0d', light: '#ffffff' },
            errorCorrectionLevel: 'M',
        });
    } catch (e) {
        console.error('QR error:', e);
        Toast.show('Error generando QR', 'error');
    }

    const rows = [
        ['CódigoHEAD', t.codigo_head],
        ['Nombre', t.nombre],
        ['Tipo', t.tool_types?.name || '—'],
        ['Marca', t.marca || '—'],
        ['Modelo', t.modelo || '—'],
        ['No. Serie', t.no_serie || '—'],
        ['Color', t.color || '—'],
        ['Estado', st.label],
        ['Proyecto', t.projects?.name || '—'],
        ['Almacén', t.warehouses?.name || '—'],
    ];
    document.getElementById('qr-data-table').innerHTML = rows.map(([k, v]) =>
        `<tr><td>${k}</td><td style="font-weight:600;">${v}</td></tr>`
    ).join('');
}

function downloadQR() {
    if (!currentQRTool) return;
    const canvas = document.getElementById('qr-canvas');
    const a = document.createElement('a');
    a.download = `QR_${currentQRTool.codigo_head}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    Toast.show('QR descargado', 'success');
}

function printQR() {
    if (!currentQRTool) return;
    const t = currentQRTool;
    const st = STATUS_LABELS[t.status] || { label: t.status };
    const canvas = document.getElementById('qr-canvas');
    const dataUrl = canvas.toDataURL('image/png');

    // NOTE: Build HTML via string concat — NOT template literals.
    // Reason: a template literal containing <\/style>, <\/head>, <\/body>, <\/html>
    // confuses the browser HTML parser, which closes those tags prematurely
    // and cuts the <script> block, causing "Unexpected end of input".
    const css = [
        '@page{size:100mm 140mm;margin:6mm;}',
        '*{box-sizing:border-box;margin:0;padding:0;}',
        'body{font-family:Arial,sans-serif;background:#fff;color:#0d0d0d;}',
        '.card{border:2px solid #0d0d0d;border-radius:6px;overflow:hidden;width:88mm;margin:0 auto;}',
        '.card-header{background:#0d0d0d;color:#f5c400;font-family:monospace;font-weight:700;font-size:10pt;padding:6px 10px;display:flex;justify-content:space-between;}',
        '.card-body{padding:10px;text-align:center;}',
        '.qr-img{width:70mm;height:70mm;border:1px solid #eee;display:block;margin:0 auto 10px;}',
        '.tool-name{font-weight:700;font-size:11pt;margin-bottom:3px;}',
        '.tool-code{font-family:monospace;font-size:9pt;color:#888;letter-spacing:1px;margin-bottom:8px;}',
        'table{width:100%;border-collapse:collapse;font-size:8pt;text-align:left;margin-top:6px;}',
        'td{padding:3px 4px;border-bottom:1px solid #f0f0f0;}',
        'td:first-child{color:#888;font-weight:600;width:40%;}',
        '.status-chip{display:inline-block;padding:2px 8px;border-radius:99px;font-size:8pt;font-weight:700;background:#e8f5e9;color:#1a8a4a;margin-top:4px;}',
        '.footer{font-size:7pt;color:#bbb;text-align:center;padding:6px;border-top:1px solid #f0f0f0;}'
    ].join('');

    const tableRows =
        (t.tool_types?.name ? '<tr><td>Tipo</td><td>' + t.tool_types.name + '</td></tr>' : '') +
        (t.marca ? '<tr><td>Marca</td><td>' + t.marca + '</td></tr>' : '') +
        (t.modelo ? '<tr><td>Modelo</td><td>' + t.modelo + '</td></tr>' : '') +
        (t.no_serie ? '<tr><td>No. Serie</td><td><code>' + t.no_serie + '</code></td></tr>' : '') +
        (t.color ? '<tr><td>Color</td><td>' + t.color + '</td></tr>' : '') +
        (t.projects?.name ? '<tr><td>Proyecto</td><td>' + t.projects.name + '</td></tr>' : '') +
        (t.warehouses?.name ? '<tr><td>Almac\u00e9n</td><td>' + t.warehouses.name + '</td></tr>' : '');

    const html =
        '<!DOCTYPE html>' +
        '<html lang="es"><head><meta charset="UTF-8"/>' +
        '<title>QR \u2014 ' + t.codigo_head + '</title>' +
        '<style>' + css + '<\/style>' +
        '<\/head><body>' +
        '<div class="card">' +
        '<div class="card-header"><span>HEAD STORE</span><span>' + t.codigo_head + '</span></div>' +
        '<div class="card-body">' +
        '<img class="qr-img" src="' + dataUrl + '" />' +
        '<div class="tool-name">' + t.nombre + '</div>' +
        '<div class="tool-code">' + t.codigo_head + '</div>' +
        '<span class="status-chip">' + st.label + '</span>' +
        '<table>' + tableRows + '</table>' +
        '</div>' +
        '<div class="footer">HEAD STORE \u00b7 Sistema de Inventarios \u00b7 ' +
        new Date().toLocaleDateString('es-MX') + '</div>' +
        '</div>' +
        '<\/body><\/html>';

    const win = window.open('', '_blank', 'width=420,height=660');
    if (!win) { Toast.show('Permite ventanas emergentes para imprimir', 'error'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    win.addEventListener('load', () => win.print());
}

/* ════════════════════════════════════════
   EXPORTAR HERRAMIENTAS A EXCEL
════════════════════════════════════════ */
window.exportToolsExcel = function () {
    const q = document.getElementById('search-input').value.toLowerCase().trim();
    const sts = activeStatusFilter || document.getElementById('filter-status').value;
    const whId = document.getElementById('filter-warehouse').value;

    const active = allTools.filter(t => t.is_active !== false);

    const data = active.filter(t => {
        const mq = !q ||
            (t.nombre || '').toLowerCase().includes(q) ||
            (t.codigo_head || '').toLowerCase().includes(q) ||
            (t.marca || '').toLowerCase().includes(q) ||
            (t.modelo || '').toLowerCase().includes(q) ||
            (t.no_serie || '').toLowerCase().includes(q) ||
            (t.color || '').toLowerCase().includes(q);
        const ms = !sts || t.status === sts;
        const mw = !whId || t.warehouse_id === whId;
        return mq && ms && mw;
    });

    if (!data || data.length === 0) {
        Toast.show("No hay herramientas para exportar con los filtros actuales", "info");
        return;
    }

    const btnExport = document.getElementById("btn-export-excel");
    const origHTML = btnExport.innerHTML;
    btnExport.disabled = true;
    btnExport.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Exportando...`;

    try {
        const statusLabel = {
            ACTIVA: "Activa",
            EN_MANTENIMIENTO: "En mantenimiento",
            REPARACION: "Reparación",
            RESGUARDO: "Resguardo"
        };

        // Build rows
        const rows = data.map(t => ({
            "CódigoHEAD": t.codigo_head || "",
            "Nombre": t.nombre || "",
            "Tipo": t.tool_types?.name || "",
            "Marca": t.marca || "",
            "Modelo": t.modelo || "",
            "No. Serie": t.no_serie || "",
            "Color": t.color || "",
            "Estado/Estatus": statusLabel[t.status] || t.status || "",
            "Proyecto": t.projects?.name || "",
            "Almacén": t.warehouses?.name || "",
            "Descripción": t.descripcion || "",
            "Fecha Registro": t.created_at ? new Date(t.created_at).toLocaleString("es-MX") : "",
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        // Columns width
        ws["!cols"] = [
            { wch: 16 }, // CódigoHEAD
            { wch: 25 }, // Nombre
            { wch: 20 }, // Tipo
            { wch: 15 }, // Marca
            { wch: 15 }, // Modelo
            { wch: 15 }, // No. Serie
            { wch: 10 }, // Color
            { wch: 15 }, // Estado
            { wch: 20 }, // Proyecto
            { wch: 20 }, // Almacén
            { wch: 30 }, // Descripción
            { wch: 22 }, // Fecha Registro
        ];

        XLSX.utils.book_append_sheet(wb, ws, "HERRAMIENTAS");

        // Metadata sheet
        const metaRows = [
            ["HEAD STORE — Exportación de Herramientas"],
            [""],
            ["Fecha de exportación:", new Date().toLocaleString("es-MX")],
            ["Exportado por:", user.full_name || user.email || "—"],
            ["Total de registros:", data.length],
        ];
        const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
        wsMeta["!cols"] = [{ wch: 28 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, wsMeta, "INFO");

        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `herramientas_headstore_${dateStr}.xlsx`);
        Toast.show(`Herramientas exportadas: ${data.length} registros`, "success");
    } catch (err) {
        console.error("Error exportando herramientas:", err);
        Toast.show("Error al exportar: " + err.message, "error");
    } finally {
        btnExport.disabled = false;
        btnExport.innerHTML = origHTML;
    }
};