
const user = Auth.requireAuth();

const allowedWarehouseIds = Auth.getAllowedWarehouseIds();

const isRestricted = allowedWarehouseIds !== null;

const PAGE_SIZE = 25;

let page = 0;

let totalCount = 0;

// 'all' | 'inventory' | 'tools'
let currentSource = 'all';

if (user) {

    renderSidebar("nav-movements");
    renderTableHead();
    loadMovements();
}

/* =========================================================
SOURCE TOGGLE
========================================================= */

function setSource(src) {
    currentSource = src;
    page = 0;

    //document.getElementById('btn-all').classList.toggle('active', src === 'all');
    document.getElementById('btn-inventory').classList.toggle('active', src === 'inventory');
    document.getElementById('btn-tools').classList.toggle('active', src === 'tools');

    // Hide the movement-type filter when viewing tools only
    document.getElementById('filter-type').style.display = (src === 'tools') ? 'none' : '';

    const titles = {
        all: 'Historial de Movimientos',
        inventory: 'Movimientos de Inventario',
        tools: 'Movimientos de Herramientas',
    };
    document.getElementById('table-title').textContent = titles[src];

    renderTableHead();
    loadMovements();
}

/* =========================================================
TABLE HEAD
========================================================= */

function renderTableHead() {
    const tr = document.getElementById('table-head-row');
    if (currentSource === 'tools') {
        tr.innerHTML = `
          <th>Herramienta</th>
          <th>Estatus Anterior</th>
          <th>Estatus Nuevo</th>
          <th>Almacén Origen</th>
          <th>Almacén Destino</th>
          <th>Registrado por</th>
          <th>Fecha</th>
          <th>Notas</th>
          <th>Acción</th>
        `;
    } else if (currentSource === 'inventory') {
        tr.innerHTML = `
          <th>Tipo</th>
          <th>Producto</th>
          <th>Almacén</th>
          <th>Cantidad Movimiento</th>
          <th>Stock Anterior</th>
          <th>Stock Actual</th>
          <th>Registrado por</th>
          <th>Fecha</th>
          <th>Notas</th>
          <th>Acción</th>
        `;
    } else {
        tr.innerHTML = `
          <th>Origen</th>
          <th>Tipo / Estatus</th>
          <th>Producto / Herramienta</th>
          <th>Detalle</th>
          <th>Registrado por</th>
          <th>Fecha</th>
          <th>Notas</th>
          <th>Acción</th>
        `;
    }
}
/* =========================================================
LOAD MOVEMENTS
========================================================= */

async function loadMovements() {

    const tbody = document.getElementById("movements-body");
    tbody.innerHTML = loadingRow(10);

    try {

        if (currentSource === 'inventory') {
            await loadInventoryMovements(tbody);
        } else if (currentSource === 'tools') {
            await loadToolMovements(tbody);
        } else {
            await loadAllMovements(tbody);
        }

        renderPagination();

    } catch (err) {
        console.error(err);
        tbody.innerHTML = emptyRow(10, "Error cargando movimientos");
        Toast.show(err.message || "Error inesperado", "error");
    }
}

/* ── Helpers de query ── */
function applyWarehouseFilter(query, field) {
    if (isRestricted && Array.isArray(allowedWarehouseIds) && allowedWarehouseIds.length > 0) {
        query = query.in(field, allowedWarehouseIds);
    }
    return query;
}

function applyDateFilter(query, dfrom, dto) {
    if (dfrom) {
        const start = new Date(dfrom);
        start.setHours(0, 0, 0, 0);
        query = query.gte("created_at", start.toISOString());
    }
    if (dto) {
        const end = new Date(dto);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
    }
    return query;
}

/* ── Inventario ── */
async function loadInventoryMovements(tbody) {
    const q = document.getElementById("search-input").value.trim();
    const type = document.getElementById("filter-type").value;
    const dfrom = document.getElementById("filter-date-from").value;
    const dto = document.getElementById("filter-date-to").value;

    let query = db
        .from("inventory_movements")
        .select(`
    id, warehouse_id, movement_type, quantity, previous_stock, new_stock, notes, created_at,
    products!inner(name, code, description),
    warehouses(name), suppliers(company_name), projects(name), users(full_name)
    `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, ((page + 1) * PAGE_SIZE) - 1);

    query = applyWarehouseFilter(query, "warehouse_id");
    if (type) query = query.eq("movement_type", type);
    if (q) query = query.or(`name.ilike.%${q}%,code.ilike.%${q}%`, { foreignTable: "products" });
    query = applyDateFilter(query, dfrom, dto);

    const { data, error, count } = await query;
    if (error) throw error;

    totalCount = count || 0;
    document.getElementById("record-count").textContent = `${totalCount} registro(s)`;

    const rows = data || [];
    if (!rows.length) { tbody.innerHTML = emptyRow(9, "Sin movimientos de inventario"); return; }

    tbody.innerHTML = rows.map(m => `
    <tr>
        <td>${movBadge(m.movement_type)}</td>
        <td>
            <span class="fw-600">${escapeHtml(m.products?.name || "—")}</span><br />
            <span class="code-cell">${escapeHtml(m.products?.code || "")}</span>
        </td>
        <td class="text-muted">${escapeHtml(m.warehouses?.name || "—")}</td>
        <td class="text-mono fw-600">${m.quantity || 0}</td>
        <td class="text-muted text-mono">${m.previous_stock || 0}</td>
        <td class="text-mono fw-600">${m.new_stock || 0}</td>
        <td class="text-muted">${escapeHtml(m.users?.full_name || "—")}</td>
        <td class="text-muted">${fmt.datetime(parseDbDate(m.created_at))}</td>
        <td class="text-muted safe-note" title="${escapeHtml(m.notes || '')}">${escapeHtml(m.notes || "—")}</td>
        <td>
            <button class="btn btn-secondary btn-sm" onclick="reprintMovement('${m.id}', 'inventory')">Reimprimir</button>
        </td>
    </tr>
    `).join("");
}

/* ── Herramientas ── */
async function loadToolMovements(tbody) {
    const q = document.getElementById("search-input").value.trim().toLowerCase();
    const dfrom = document.getElementById("filter-date-from").value;
    const dto = document.getElementById("filter-date-to").value;

    let query = db
        .from("herramienta_movements")
        .select(`
    id, prev_status, new_status, prev_warehouse_name, new_warehouse_name, notes, created_at,
    herramientas!inner(id, codigo_head, nombre, warehouse_id),
    users!herramienta_movements_created_by_fkey(full_name)
    `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, ((page + 1) * PAGE_SIZE) - 1);

    if (isRestricted && Array.isArray(allowedWarehouseIds) && allowedWarehouseIds.length > 0) {
        query = query.in("herramientas.warehouse_id", allowedWarehouseIds);
    }

    query = applyDateFilter(query, dfrom, dto);

    const { data, error, count } = await query;
    if (error) throw error;

    totalCount = count || 0;
    document.getElementById("record-count").textContent = `${totalCount} registro(s)`;

    let rows = data || [];
    if (q) {
        rows = rows.filter(m =>
            (m.herramientas?.nombre || '').toLowerCase().includes(q) ||
            (m.herramientas?.codigo_head || '').toLowerCase().includes(q)
        );
        document.getElementById("record-count").textContent = `${rows.length} registro(s)`;
    }

    if (!rows.length) { tbody.innerHTML = emptyRow(8, "Sin movimientos de herramientas"); return; }

    tbody.innerHTML = rows.map(m => `
    <tr>
        <td>
            <span class="fw-600">${escapeHtml(m.herramientas?.nombre || "—")}</span><br />
            <span class="code-cell">${escapeHtml(m.herramientas?.codigo_head || "")}</span>
        </td>
        <td>${toolStatusBadge(m.prev_status)}</td>
        <td>${toolStatusBadge(m.new_status)}</td>
        <td class="text-muted">${escapeHtml(m.prev_warehouse_name || "—")}</td>
        <td class="text-muted">${escapeHtml(m.new_warehouse_name || "—")}</td>
        <td class="text-muted">${escapeHtml(m.users?.full_name || "—")}</td>
        <td class="text-muted">${fmt.datetime(parseDbDate(m.created_at))}</td>
        <td class="text-muted safe-note" title="${escapeHtml(m.notes || '')}">${escapeHtml(m.notes || "—")}</td>
        <td>
            <button class="btn btn-secondary btn-sm" onclick="reprintMovement('${m.id}', 'tools')">Reimprimir</button>
        </td>
    </tr>
    `).join("");
}

/* ── Todos (combinado) ── */
async function loadAllMovements(tbody) {
    const q = document.getElementById("search-input").value.trim().toLowerCase();
    const type = document.getElementById("filter-type").value;
    const dfrom = document.getElementById("filter-date-from").value;
    const dto = document.getElementById("filter-date-to").value;

    let invQuery = db
        .from("inventory_movements")
        .select(`id, warehouse_id, movement_type, quantity, previous_stock, new_stock, notes, created_at, products!inner(name, code), warehouses(name), users(full_name)`)
        .order("created_at", { ascending: false })
        .limit(500);

    invQuery = applyWarehouseFilter(invQuery, "warehouse_id");
    if (type) invQuery = invQuery.eq("movement_type", type);
    invQuery = applyDateFilter(invQuery, dfrom, dto);

    let invRes;
    let toolRes = { data: [] };

    if (type) {
        // Si hay un filtro de tipo activo, las herramientas no aplican. Solo consultamos inventario.
        const res = await invQuery;
        if (res.error) throw res.error;
        invRes = res;
    } else {
        // Sin filtro de tipo, consultamos ambos en paralelo.
        let toolQuery = db
            .from("herramienta_movements")
            .select(`id, prev_status, new_status, prev_warehouse_name, new_warehouse_name, notes, created_at, herramientas(id, codigo_head, nombre), users!herramienta_movements_created_by_fkey(full_name)`)
            .order("created_at", { ascending: false })
            .limit(500);

        toolQuery = applyDateFilter(toolQuery, dfrom, dto);

        const [resInv, resTool] = await Promise.all([invQuery, toolQuery]);
        if (resInv.error) throw resInv.error;
        if (resTool.error) throw resTool.error;
        invRes = resInv;
        toolRes = resTool;
    }

    let invRows = (invRes.data || []).map(m => ({
        id: m.id,
        _source: 'inventory', _sortKey: m.created_at,
        type: m.movement_type, name: m.products?.name || '—', code: m.products?.code || '',
        detail: `${m.quantity} uds · ${m.warehouses?.name || '—'}`,
        user: m.users?.full_name || '—', created_at: m.created_at, notes: m.notes || '',
        prev_status: null, new_status: null,
    }));

    let toolRows = (toolRes.data || []).map(m => ({
        id: m.id,
        _source: 'tools', _sortKey: m.created_at,
        type: null, name: m.herramientas?.nombre || '—', code: m.herramientas?.codigo_head || '',
        prev_status: m.prev_status, new_status: m.new_status,
        detail: `${m.prev_warehouse_name || '—'} → ${m.new_warehouse_name || '—'}`,
        user: m.users?.full_name || '—', created_at: m.created_at, notes: m.notes || '',
    }));

    if (q) {
        invRows = invRows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
        toolRows = toolRows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    }

    const allRows = [...invRows, ...toolRows].sort((a, b) => new Date(b._sortKey) - new Date(a._sortKey));
    totalCount = allRows.length;
    document.getElementById("record-count").textContent = `${totalCount} registro(s)`;

    const pageRows = allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    if (!pageRows.length) { tbody.innerHTML = emptyRow(7, "Sin movimientos"); return; }

    tbody.innerHTML = pageRows.map(r => {
        if (r._source === 'inventory') {
            return `
    <tr>
        <td><span class="src-badge src-badge-inv">🗃️ Inventario</span></td>
        <td>${movBadge(r.type)}</td>
        <td><span class="fw-600">${escapeHtml(r.name)}</span><br /><span class="code-cell">${escapeHtml(r.code)}</span></td>
        <td class="text-muted">${escapeHtml(r.detail)}</td>
        <td class="text-muted">${escapeHtml(r.user)}</td>
        <td class="text-muted">${fmt.datetime(parseDbDate(r.created_at))}</td>
        <td class="text-muted safe-note" title="${escapeHtml(r.notes)}">${escapeHtml(r.notes || "—")}</td>
        <td>
            ${r.type === 'SALIDA' ? `<button class="btn btn-secondary btn-sm" onclick="reprintMovement('${r.id}', 'inventory')">Reimprimir</button>` : ''}
        </td>
    </tr>
    `;
        } else {
            return `
    <tr>
        <td><span class="src-badge src-badge-tool">🔧 Herramienta</span></td>
        <td>${toolStatusBadge(r.prev_status)} <span style="margin:0 4px;color:#999;">→</span> ${toolStatusBadge(r.new_status)}</td>
        <td><span class="fw-600">${escapeHtml(r.name)}</span><br /><span class="code-cell">${escapeHtml(r.code)}</span></td>
        <td class="text-muted">${escapeHtml(r.detail)}</td>
        <td class="text-muted">${escapeHtml(r.user)}</td>
        <td class="text-muted">${fmt.datetime(parseDbDate(r.created_at))}</td>
        <td class="text-muted safe-note" title="${escapeHtml(r.notes)}">${escapeHtml(r.notes || "—")}</td>
        <td>
            <button class="btn btn-secondary btn-sm" onclick="reprintMovement('${r.id}', 'tools')">Reimprimir</button>
        </td>
    </tr>
    `;
        }
    }).join("");
}

/* =========================================================
EVENTS
========================================================= */

document.getElementById("search-input")
    .addEventListener("input", debounce(() => {
        page = 0;
        loadMovements();
    }, 400));

document.getElementById("filter-type")
    .addEventListener("change", () => {
        page = 0;
        loadMovements();
    });

document.getElementById("filter-date-from")
    .addEventListener("change", () => {
        page = 0;
        updateRangeTag();
        loadMovements();
    });

document.getElementById("filter-date-to")
    .addEventListener("change", () => {
        page = 0;
        updateRangeTag();
        loadMovements();
    });

/* =========================================================
HELPERS
========================================================= */

function debounce(fn, delay) {

    let timer;

    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function escapeHtml(str = "") {

    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function parseDbDate(ts) {
    if (!ts) return null;
    const date = new Date(ts);
    date.setHours(date.getHours() - 6);
    return date;
}

function fmtDateShort(d) {

    if (!d) return "";

    const [y, m, day] = d.split("-");

    const months = [
        "Ene", "Feb", "Mar", "Abr", "May", "Jun",
        "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
    ];

    return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
}

function updateRangeTag() {

    const from = document.getElementById("filter-date-from").value;

    const to = document.getElementById("filter-date-to").value;

    const tag = document.getElementById("range-tag");

    if (from || to) {

        document.getElementById("range-tag-text").textContent =
            `${from ? fmtDateShort(from) : "Inicio"} → ${to ? fmtDateShort(to) : "Hoy"}`;

        tag.classList.add("show");

    } else {
        tag.classList.remove("show");
    }
}

function clearDates() {

    document.getElementById("filter-date-from").value = "";
    document.getElementById("filter-date-to").value = "";

    updateRangeTag();

    page = 0;

    loadMovements();
}

function getReference(m) {

    if (m.movement_type === "ENTRADA") {
        return m.suppliers?.company_name || "—";
    }

    if (m.movement_type === "SALIDA") {
        return m.projects?.name || "—";
    }

    if (m.movement_type === "TRANSFERENCIA") {
        return "Transferencia interna";
    }

    return "—";
}

async function reprintMovement(id, source) {
    try {
        if (source === 'inventory') {
            const { data, error } = await db
                .from('inventory_movements')
                .select(`
              id, movement_type, quantity, previous_stock, new_stock, notes, created_at,
              products!inner(name, code), warehouses(name), projects(name), users(full_name)
            `)
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;
            if (!data) { Toast.show('Movimiento no encontrado', 'error'); return; }
            if (data.movement_type !== 'SALIDA') {
                Toast.show('Solo se pueden reimprimir salidas de inventario', 'error');
                return;
            }
            generateInventoryExitPDF(data);
            Toast.show('Reimpresión de salida generada', 'success');
            return;
        }

        if (source === 'tools') {
            const { data, error } = await db
                .from('herramienta_movements')
                .select(`
              id, prev_status, new_status, prev_warehouse_name, new_warehouse_name, notes, created_at,
              herramientas!inner(codigo_head, nombre), users!herramienta_movements_created_by_fkey(full_name)
            `)
                .eq('id', id)
                .maybeSingle();

            if (error) throw error;
            if (!data) { Toast.show('Movimiento no encontrado', 'error'); return; }
            if (!data.prev_warehouse_name || !data.new_warehouse_name) {
                Toast.show('Este movimiento no es una transferencia válida', 'error');
                return;
            }
            generateToolTransferPDF(data);
            Toast.show('Reimpresión de transferencia generada', 'success');
            return;
        }

        Toast.show('Tipo de movimiento no soportado', 'error');
    } catch (err) {
        console.error('reprintMovement error:', err);
        Toast.show(err.message || 'Error al reimprimir movimiento', 'error');
    }
}

function generateInventoryExitPDF(movement) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('La librería jsPDF no está disponible.');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const date = new Date(movement.created_at || Date.now());
    const folioMatch = String(movement.notes || '').match(/\[Folio:\s*([^\]]+)\]/);
    const folio = folioMatch ? folioMatch[1] : `SAL-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const warehouseName = movement.warehouses?.name || '—';
    const projectName = movement.projects?.name || 'Sin tipo de salida';
    const userName = movement.users?.full_name || 'Usuario';
    const productName = movement.products?.name || '—';
    const productCode = movement.products?.code || '—';
    const notes = movement.notes || '';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('VALE DE SALIDA DE INVENTARIO', 40, 50);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Folio: ${folio}`, 40, 72);
    doc.text(`Fecha: ${date.toLocaleDateString('es-MX')} ${date.toLocaleTimeString('es-MX')}`, 40, 86);
    doc.text(`Almacén Origen: ${warehouseName}`, 40, 100);
    doc.text(`Destino / Obra: ${projectName}`, 40, 114);
    doc.text(`Responsable: ${userName}`, 40, 128);

    doc.setFont('helvetica', 'bold');
    doc.text('Producto / Insumo', 40, 158);
    doc.setFont('helvetica', 'normal');
    doc.text(`${productName} (${productCode})`, 40, 172);

    doc.setFont('helvetica', 'bold');
    doc.text('Cantidad', 40, 192);
    doc.setFont('helvetica', 'normal');
    doc.text(String(movement.quantity || 0), 110, 192);

    doc.setFont('helvetica', 'bold');
    doc.text('Stock anterior', 40, 208);
    doc.setFont('helvetica', 'normal');
    doc.text(String(movement.previous_stock || 0), 125, 208);

    doc.setFont('helvetica', 'bold');
    doc.text('Stock actual', 40, 224);
    doc.setFont('helvetica', 'normal');
    doc.text(String(movement.new_stock || 0), 115, 224);

    if (notes) {
        doc.setFont('helvetica', 'bold');
        doc.text('Notas:', 40, 244);
        doc.setFont('helvetica', 'normal');
        const noteLines = doc.splitTextToSize(notes, 500);
        doc.text(noteLines, 40, 258);
    }

    const signatureY = 500;
    doc.setLineWidth(0.5);
    doc.line(70, signatureY, 220, signatureY);
    doc.text('ENTREGÓ', 70, signatureY + 14);
    doc.line(330, signatureY, 480, signatureY);
    doc.text('RECIBIÓ', 330, signatureY + 14);

    doc.save(`vale_salida_${folio}.pdf`);
}

function generateToolTransferPDF(movement) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('La librería jsPDF no está disponible.');
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const date = new Date(movement.created_at || Date.now());
    const folio = `TRF-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const toolName = movement.herramientas?.nombre || '—';
    const toolCode = movement.herramientas?.codigo_head || '—';
    const userName = movement.users?.full_name || 'Usuario';
    const notes = movement.notes || '';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('VALE DE TRANSFERENCIA DE HERRAMIENTA', 40, 50);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Folio: ${folio}`, 40, 72);
    doc.text(`Fecha: ${date.toLocaleDateString('es-MX')} ${date.toLocaleTimeString('es-MX')}`, 40, 86);
    doc.text(`Herramienta: ${toolName}`, 40, 100);
    doc.text(`Código: ${toolCode}`, 40, 114);
    doc.text(`Origen: ${movement.prev_warehouse_name || '—'}`, 40, 128);
    doc.text(`Destino: ${movement.new_warehouse_name || '—'}`, 40, 142);
    doc.text(`Responsable: ${userName}`, 40, 156);
    doc.text(`Estado anterior: ${movement.prev_status || '—'}`, 40, 170);
    doc.text(`Estado nuevo: ${movement.new_status || '—'}`, 40, 184);

    if (notes) {
        doc.setFont('helvetica', 'bold');
        doc.text('Notas:', 40, 204);
        doc.setFont('helvetica', 'normal');
        const noteLines = doc.splitTextToSize(notes, 500);
        doc.text(noteLines, 40, 218);
    }

    const signatureY = 460;
    doc.setLineWidth(0.5);
    doc.line(70, signatureY, 220, signatureY);
    doc.text('ENTREGÓ', 70, signatureY + 14);
    doc.line(330, signatureY, 480, signatureY);
    doc.text('RECIBIÓ', 330, signatureY + 14);

    doc.save(`vale_transferencia_${folio}.pdf`);
}

function movBadge(type) {
    const map = {
        ENTRADA: { label: "Entrada", color: "#1a8a4a", bg: "rgba(26,138,74,.12)" },
        SALIDA: { label: "Salida", color: "#b52525", bg: "rgba(181,37,37,.12)" },
        TRANSFERENCIA: { label: "Transferencia", color: "#1a6fa0", bg: "rgba(26,111,160,.12)" },
    };
    const item = map[type] || { label: type || "—", color: "#555", bg: "#eee" };
    return `<span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:99px;font-size:.75rem;font-weight:700;background:${item.bg};color:${item.color};">${item.label}</span>`;
}

function toolStatusBadge(status) {
    if (!status) return '<span class="text-muted">—</span>';
    const map = {
        ACTIVA: { label: 'Activa', color: '#1a8a4a', bg: 'rgba(26,138,74,.12)' },
        EN_MANTENIMIENTO: { label: 'Mantenimiento', color: '#1a6fa0', bg: 'rgba(26,111,160,.12)' },
        REPARACION: { label: 'Reparación', color: '#b52525', bg: 'rgba(181,37,37,.12)' },
        RESGUARDO: { label: 'Resguardo', color: '#555', bg: 'rgba(100,100,100,.12)' },
    };
    const item = map[status] || { label: status, color: '#555', bg: '#eee' };
    return `<span class="tool-status-badge" style="background:${item.bg};color:${item.color};">${item.label}</span>`;
}



/* =========================================================
PAGINATION
========================================================= */

function renderPagination() {

    const totalPages = Math.ceil(
        totalCount / PAGE_SIZE
    );

    const pag = document.getElementById("pagination");

    if (totalPages <= 1) {
        pag.innerHTML = "";
        return;
    }

    pag.innerHTML = `
    <button
      class="btn btn-secondary btn-sm"
      onclick="changePage(${page - 1})"
      ${page === 0 ? "disabled" : ""}
    >
      ← Anterior
    </button>

    <span class="text-muted">
      Página ${page + 1} de ${totalPages}
    </span>

    <button
      class="btn btn-secondary btn-sm"
      onclick="changePage(${page + 1})"
      ${page >= totalPages - 1 ? "disabled" : ""}
    >
      Siguiente →
    </button>
  `;
}

function changePage(p) {

    page = p;

    loadMovements();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

/* =========================================================
GENERAR EXCEL
========================================================= */

async function generateReport() {

    try {

        const dfrom = document.getElementById("filter-date-from").value;
        const dto = document.getElementById("filter-date-to").value;
        const type = document.getElementById("filter-type").value;
        const q = document.getElementById("search-input").value.trim();

        const wb = XLSX.utils.book_new();

        /* ── Hoja Inventario ── */
        if (currentSource !== 'tools') {
            let invQ = db
                .from("inventory_movements")
                .select(`id, movement_type, quantity, previous_stock, new_stock, notes, created_at, products!inner(name, code), warehouses(name), suppliers(company_name), projects(name), users(full_name)`)
                .order("created_at", { ascending: false })
                .limit(2000);

            invQ = applyWarehouseFilter(invQ, "warehouse_id");
            if (type) invQ = invQ.eq("movement_type", type);
            if (q) invQ = invQ.or(`name.ilike.%${q}%,code.ilike.%${q}%`, { foreignTable: "products" });
            invQ = applyDateFilter(invQ, dfrom, dto);

            const { data: invData, error: invErr } = await invQ;
            if (invErr) throw invErr;

            if ((invData || []).length) {
                const sd = [["Tipo", "Código", "Producto", "Almacén", "Cantidad", "Stock Anterior", "Stock Actual", "Referencia", "Usuario", "Fecha", "Notas"]];
                invData.forEach(m => sd.push([
                    m.movement_type, m.products?.code || "", m.products?.name || "",
                    m.warehouses?.name || "", m.quantity || 0, m.previous_stock || 0, m.new_stock || 0,
                    getReference(m), m.users?.full_name || "",
                    new Date(m.created_at).toLocaleString("es-MX"), m.notes || ""
                ]));
                const ws = XLSX.utils.aoa_to_sheet(sd);
                ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 30 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 35 }];
                XLSX.utils.book_append_sheet(wb, ws, "Inventario");
            }
        }

        /* ── Hoja Herramientas ── */
        if (currentSource !== 'inventory' && !type) {
            let toolQ = db
                .from("herramienta_movements")
                .select(`id, prev_status, new_status, prev_warehouse_name, new_warehouse_name, notes, created_at, herramientas(codigo_head, nombre), users!herramienta_movements_created_by_fkey(full_name)`)
                .order("created_at", { ascending: false })
                .limit(2000);

            toolQ = applyDateFilter(toolQ, dfrom, dto);

            const { data: toolData, error: toolErr } = await toolQ;
            if (toolErr) throw toolErr;

            let toolRows = toolData || [];
            if (q) {
                const ql = q.toLowerCase();
                toolRows = toolRows.filter(m =>
                    (m.herramientas?.nombre || '').toLowerCase().includes(ql) ||
                    (m.herramientas?.codigo_head || '').toLowerCase().includes(ql)
                );
            }

            if (toolRows.length) {
                const sd2 = [["Código", "Herramienta", "Estatus Anterior", "Estatus Nuevo", "Almacén Origen", "Almacén Destino", "Usuario", "Fecha", "Notas"]];
                toolRows.forEach(m => sd2.push([
                    m.herramientas?.codigo_head || "", m.herramientas?.nombre || "",
                    m.prev_status || "", m.new_status || "",
                    m.prev_warehouse_name || "", m.new_warehouse_name || "",
                    m.users?.full_name || "",
                    new Date(m.created_at).toLocaleString("es-MX"), m.notes || ""
                ]));
                const ws2 = XLSX.utils.aoa_to_sheet(sd2);
                ws2["!cols"] = [{ wch: 16 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 35 }];
                XLSX.utils.book_append_sheet(wb, ws2, "Herramientas");
            }
        }

        if (!wb.SheetNames.length) {
            Toast.show("No hay datos para exportar", "error");
            return;
        }

        XLSX.writeFile(wb, `movimientos_${Date.now()}.xlsx`);
        Toast.show("Reporte generado correctamente", "success");

    } catch (err) {
        console.error(err);
        Toast.show(err.message || "Error generando reporte", "error");
    }
}
