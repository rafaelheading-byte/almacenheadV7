// =========================================================
// HEAD STORE — Compras (Carátulas) Module Controller
// =========================================================

const user = Auth.requireAuth();
// Allow access to admin, coordinator, or specific user (Rafa)
const canEdit = Auth.isAdmin() || Auth.isCoordinador() || (user && user.id === "4588f3b0-737c-4ce3-b1f1-b9dbe381c8b1");
const allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

let warehousesList = [];
let requisicionesList = [];
let detallesRequiList = [];
let pedidosList = [];
let pedidoDetalleList = []; // Order details list
let suppliersList = [];
let productsList = []; // Products for auto-complete select

// Keep track of expanded requisitions across updates
const expandedRequisitions = new Set();

// Modal selection arrays (Requisitions)
let selectedReqItems = [];
let selectedTempProduct = null;

// Modal selection arrays (Orders)
let selectedPedItems = [];
let selectedTempPedProduct = null;
let currentRequisitionItems = []; // Products allowed from the requisition
let currentPedEvidenciaUrl = null;
let pendingEvidenciaFile = null;

// Initialize Page
if (user) {
    renderSidebar("nav-compras");

    if (canEdit) {
        document.getElementById("btn-new-requisicion").style.display = "";
    }

    loadAll();
}

// Load all data
async function loadAll() {
    const container = document.getElementById("warehouses-accordion-container");
    container.innerHTML = `
        <div style="display: flex; justify-content: center; padding: 40px 0;">
            <div class="spinner"></div>
        </div>
    `;

    try {
        // 1. Fetch active warehouses
        let whQuery = db.from("warehouses").select("*").eq("is_active", true);
        if (isRestricted) {
            whQuery = whQuery.in("id", allowedWarehouseIds);
        }
        const { data: whData, error: whError } = await whQuery.order("name");
        if (whError) throw whError;
        warehousesList = whData || [];

        // Populate warehouses dropdown in requisition modal
        const selectWh = document.getElementById("req-warehouse");
        selectWh.innerHTML = '<option value="">Seleccione un almacén...</option>' +
            warehousesList.map(w => `<option value="${w.id}">${w.name} (${w.code})</option>`).join('');

        // 2. Fetch suppliers for order dropdown
        const { data: supData, error: supError } = await db.from("suppliers").select("id, company_name").order("company_name");
        if (supError) throw supError;
        suppliersList = supData || [];

        // Populate suppliers select in order modal
        const selectSup = document.getElementById("ped-supplier");
        selectSup.innerHTML = '<option value="">Seleccione un proveedor...</option>' +
            suppliersList.map(s => `<option value="${s.id}">${s.company_name}</option>`).join('');

        // 3. Fetch active products for autocomplete search
        const { data: prodData, error: prodError } = await db.from("products").select("id, name, code, unit").eq("is_active", true).order("name");
        if (prodError) throw prodError;
        productsList = prodData || [];

        // 4. Fetch requisitions
        let reqQuery = db.from("requisiciones").select("*");
        if (isRestricted) {
            reqQuery = reqQuery.in("warehouse_id", allowedWarehouseIds);
        }
        const { data: reqData, error: reqError } = await reqQuery
            .order("prioridad", { ascending: true })
            .order("fecha_requisicion", { ascending: false });

        if (reqError) {
            if (reqError.code === "42P01") {
                requisicionesList = [];
                pedidosList = [];
                detallesRequiList = [];
                pedidoDetalleList = [];
                renderAccordion();
                Toast.show("Tablas de Compras no encontradas. Ejecuta el script SQL en Supabase.", "error", 7000);
                container.prepend(createSqlWarningBanner());
                return;
            }
            throw reqError;
        }
        requisicionesList = reqData || [];

        const reqIds = requisicionesList.map(r => r.id);

        if (reqIds.length > 0) {
            // 5. Fetch details (detalles_requi) linked to fetched requisitions
            const { data: detailsData, error: detailsError } = await db
                .from("detalles_requi")
                .select("*")
                .in("requisicion_id", reqIds);

            if (detailsError) {
                if (detailsError.code === "42P01") {
                    detallesRequiList = [];
                    pedidosList = [];
                    pedidoDetalleList = [];
                    renderAccordion();
                    container.prepend(createSqlWarningBanner());
                    return;
                }
                throw detailsError;
            }
            detallesRequiList = detailsData || [];

            // 6. Fetch orders (pedidos) linked to fetched requisitions
            const { data: pedData, error: pedError } = await db
                .from("pedidos")
                .select("*")
                .in("requisicion_id", reqIds)
                .order("created_at", { ascending: true });

            if (pedError) throw pedError;
            pedidosList = pedData || [];

            // 7. Fetch details (pedido_detalle) linked to fetched orders
            const pedIds = pedidosList.map(p => p.id);
            if (pedIds.length > 0) {
                const { data: pedDetData, error: pedDetError } = await db
                    .from("pedido_detalle")
                    .select("*")
                    .in("pedido_id", pedIds);

                if (pedDetError) {
                    if (pedDetError.code === "42P01") {
                        pedidoDetalleList = [];
                        renderAccordion();
                        container.prepend(createSqlWarningBanner());
                        return;
                    }
                    throw pedDetError;
                }
                pedidoDetalleList = pedDetData || [];
            } else {
                pedidoDetalleList = [];
            }
        } else {
            detallesRequiList = [];
            pedidosList = [];
            pedidoDetalleList = [];
        }

        // Helper to get the highest priority (min integer value) requisition of a warehouse
        const getWarehousePriority = (wId) => {
            const wReqs = requisicionesList.filter(r => r.warehouse_id === wId);
            if (wReqs.length === 0) return 999;
            return Math.min(...wReqs.map(r => parseInt(r.prioridad || 3)));
        };

        // Sort warehouses by the highest priority of their requisitions, then alphabetically by name
        warehousesList.sort((a, b) => {
            const prioA = getWarehousePriority(a.id);
            const prioB = getWarehousePriority(b.id);
            if (prioA !== prioB) {
                return prioA - prioB;
            }
            return a.name.localeCompare(b.name);
        });

        renderAccordion();
    } catch (err) {
        console.error("Error al cargar datos de compras:", err);
        Toast.show("Error al cargar datos", "error");
        container.innerHTML = `
            <div class="stat-card red">
                <div class="stat-label">Error al cargar datos</div>
                <div style="font-size:0.88rem; margin-top:8px;">
                    ${err.message || "Verifique su conexión o si el script SQL ya fue ejecutado en Supabase."}
                </div>
            </div>
        `;
    }
}

// Create SQL Warning Banner for missing tables
function createSqlWarningBanner() {
    const banner = document.createElement("div");
    banner.className = "stat-card red";
    banner.style.marginBottom = "20px";
    banner.innerHTML = `
        <div class="stat-label" style="color:var(--red); font-weight:700;">⚠️ TABLAS DE COMPRAS O DETALLES NO ENCONTRADAS EN SUPABASE</div>
        <div style="font-size:0.85rem; margin-top:8px; line-height:1.4;">
            La tabla <code>requisiciones</code>, <code>pedidos</code>, <code>detalles_requi</code> o <code>pedido_detalle</code> aún no existe en su base de datos.
            <br>Por favor ejecute el script SQL actualizado que se encuentra en: 
            <a href="../sql/create_compras_tables.sql" target="_blank" style="text-decoration: underline; font-weight: 600;">sql/create_compras_tables.sql</a>
            dentro del editor de Supabase para poder comenzar a registrar información.
        </div>
    `;
    return banner;
}

// Toggle accordion open/closed for a warehouse
window.toggleAccordion = function (whId) {
    const card = document.getElementById(`card-${whId}`);
    if (!card) return;

    const content = card.querySelector(".accordion-content");
    const isExpanded = card.classList.contains("expanded");

    if (isExpanded) {
        card.classList.remove("expanded");
        content.style.maxHeight = null;
    } else {
        card.classList.add("expanded");
        content.style.maxHeight = content.scrollHeight + "px";

        setTimeout(() => {
            if (card.classList.contains("expanded")) {
                content.style.maxHeight = "5000px";
            }
        }, 300);
    }
};

// Toggle requisition expanded detail view
window.toggleRequisitionExpand = function (reqId) {
    const row = document.getElementById(`req-row-${reqId}`);
    const detailRow = document.getElementById(`req-detail-row-${reqId}`);
    const toggleBtn = document.getElementById(`req-toggle-${reqId}`);
    if (!row || !detailRow || !toggleBtn) return;

    const card = row.closest(".table-card");
    const content = card ? card.querySelector(".accordion-content") : null;

    if (expandedRequisitions.has(reqId)) {
        expandedRequisitions.delete(reqId);
        row.classList.remove("expanded-req");
        detailRow.style.display = "none";
        toggleBtn.textContent = "[+]";
    } else {
        expandedRequisitions.add(reqId);
        row.classList.add("expanded-req");
        detailRow.style.display = "";
        toggleBtn.textContent = "[-]";
    }

    if (card && card.classList.contains("expanded") && content) {
        content.style.maxHeight = "5000px";
    }
};

// Render Collapsible Warehouses List
function renderAccordion() {
    const container = document.getElementById("warehouses-accordion-container");
    if (!warehousesList.length) {
        container.innerHTML = `
            <div class="stat-card">
                <div class="empty-state">
                    <p>No tienes almacenes asignados o no hay almacenes activos.</p>
                </div>
            </div>
        `;
        return;
    }

    container.innerHTML = warehousesList.map(w => {
        const wReqs = requisicionesList.filter(r => r.warehouse_id === w.id);

        // Sum counts of statuses
        const pendingCount = wReqs.filter(r => r.estado === "PENDIENTE").length;
        const approvedCount = wReqs.filter(r => r.estado === "APROBADA").length;
        const completedCount = wReqs.filter(r => r.estado === "COMPLETADA").length;

        let tableHTML = "";
        if (wReqs.length === 0) {
            tableHTML = `
                <div style="padding:32px; text-align:center; color:var(--gray-light);">
                    <p style="font-size:0.85rem; margin-bottom:4px;">📍 Sin requisiciones registradas en este almacén</p>
                    <span style="font-size:0.75rem; color:var(--gray-light);">Haz clic en "Nueva Requisición" para comenzar.</span>
                </div>
            `;
        } else {
            tableHTML = `
                <div class="table-wrap">
                    <table class="rents-table">
                        <thead>
                          <tr>
                            <th style="width:50px; text-align:center;">Ver</th>
                            <th style="width:140px;">Número Requisición</th>
                            <th style="width:150px; text-align:right;">Monto</th>
                            <th style="width:110px; text-align:center;">Prioridad</th>
                            <th>Concepto</th>
                            <th style="width:140px;">Solicitante</th>
                            <th style="width:110px;">Fecha</th>
                            <th style="width:120px;">Estado</th>
                            ${canEdit ? '<th style="width:180px; text-align:right;">Acciones</th>' : ''}
                          </tr>
                        </thead>
                        <tbody>
                          ${wReqs.map(req => {
                const editBtn = canEdit
                    ? `<div class="actions-cell">
                                     <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); openEditRequisicion(${JSON.stringify(req).replace(/"/g, '&quot;')})">Editar Requi</button>
                                     <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); openCreatePedido(${JSON.stringify(req).replace(/"/g, '&quot;')})">+ Pedido</button>
                                   </div>`
                    : "";

                const isExpanded = expandedRequisitions.has(req.id);
                const toggleChar = isExpanded ? "[-]" : "[+]";
                const detailStyle = isExpanded ? "" : "style='display:none;'";
                const rowClass = isExpanded ? "requisicion-row expanded-req" : "requisicion-row";

                // Get orders for this requisition
                const reqPeds = pedidosList.filter(p => p.requisicion_id === req.id);
                const totalAmount = reqPeds.reduce((acc, p) => acc + parseFloat(p.monto || 0), 0);
                const montoRestante = parseFloat(req.monto || 0) - totalAmount;

                // Get items/products for this requisition
                const reqItems = detallesRequiList.filter(d => d.requisicion_id === req.id);

                // Build nested items table HTML
                let itemsTableHTML = "";
                if (reqItems.length === 0) {
                    itemsTableHTML = `
                                    <div style="padding:14px; text-align:center; color:var(--gray-light); font-size:0.78rem;">
                                        Sin productos cargados en esta requisición.
                                    </div>
                                `;
                } else {
                    itemsTableHTML = `
                                    <table class="ped-table">
                                        <thead>
                                            <tr>
                                                <th style="width:110px;">Código</th>
                                                <th>Descripción</th>
                                                <th style="width:70px;">Unidad</th>
                                                <th style="width:90px; text-align:right;">Solicitado</th>
                                                <th style="width:90px; text-align:right;">Pedido</th>
                                                <th style="width:90px; text-align:right;">Pendiente</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${reqItems.map(it => {
                        const prod = productsList.find(p => p.id === it.producto_id);
                        const code = prod ? prod.code : "—";
                        const name = prod ? prod.name : "Producto eliminado";
                        const unit = prod ? prod.unit : "—";

                        // Calculate ordered qty for this product across all orders of this requisition
                        const pedIds = reqPeds.map(p => p.id);
                        const orderedItems = pedidoDetalleList.filter(pd => pedIds.includes(pd.pedido_id) && pd.producto_id === it.producto_id);
                        const totalOrdered = orderedItems.reduce((sum, pi) => sum + parseFloat(pi.cantidad || 0), 0);
                        const pendingQty = Math.max(0, parseFloat(it.cantidad || 0) - totalOrdered);

                        return `
                                                    <tr>
                                                        <td style="font-weight:600; font-family:var(--font-mono);">${code}</td>
                                                        <td>${name}</td>
                                                        <td>${unit}</td>
                                                        <td style="font-family:var(--font-mono); font-weight:700; text-align:right; color:#7f8c8d;">${fmt.number(it.cantidad)}</td>
                                                        <td style="font-family:var(--font-mono); font-weight:700; text-align:right; color:#2980b9;">${fmt.number(totalOrdered)}</td>
                                                        <td style="font-family:var(--font-mono); font-weight:700; text-align:right; color:${pendingQty > 0 ? '#d35400' : '#27ae60'};">${fmt.number(pendingQty)}</td>
                                                    </tr>
                                                `;
                    }).join('')}
                                        </tbody>
                                    </table>
                                `;
                }

                // Build nested orders table HTML
                let ordersTableHTML = "";
                if (reqPeds.length === 0) {
                    ordersTableHTML = `
                                    <div style="padding:14px; text-align:center; color:var(--gray-light); font-size:0.78rem;">
                                        Sin pedidos vinculados a esta requisición.
                                    </div>
                                `;
                } else {
                    ordersTableHTML = `
                                    <table class="ped-table">
                                        <thead>
                                            <tr>
                                                <th style="width:110px;">Pedido / OC</th>
                                                <th>Proveedor & Detalles Insumos</th>
                                                <th style="width:100px;">Monto</th>
                                                <th style="width:90px;">Fecha Pedido</th>
                                                <th style="width:90px;">Entrega</th>
                                                <th style="width:100px;">Estado</th>
                                                <th style="width:90px; text-align:center;">Evidencia</th>
                                                ${canEdit ? '<th style="width:80px; text-align:center;">Acciones</th>' : ''}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${reqPeds.map(ped => {
                        const prov = suppliersList.find(s => s.id === ped.proveedor_id);
                        const provName = prov ? prov.company_name : "—";

                        // Fetch items for this order
                        const pedItems = pedidoDetalleList.filter(pd => pd.pedido_id === ped.id);
                        const itemsHTML = pedItems.map(pi => {
                            const prod = productsList.find(p => p.id === pi.producto_id);
                            const pCode = prod ? prod.code : "—";
                            const pUnit = prod ? prod.unit : "";
                            return `<div style="font-size:0.75rem; margin-top:2px; color:var(--gray-mid);"><span style="font-family:var(--font-mono); font-weight:600;">${pCode}</span> · Cant: ${fmt.number(pi.cantidad)} ${pUnit}</div>`;
                        }).join('');

                        const editPedBtn = canEdit
                            ? `<td style="text-align:center; vertical-align:top;">
                                                         <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); openEditPedido(${JSON.stringify(ped).replace(/"/g, '&quot;')}, ${JSON.stringify(req).replace(/"/g, '&quot;')})">Editar</button>
                                                       </td>`
                            : "";

                        const evidenciaBtn = ped.evidencia_url
                            ? `<td style="text-align:center; vertical-align:top;">
                                                         <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:0.72rem; display:inline-flex; align-items:center; gap:4px; background:#eef6fc; color:#1f618d; border-color:#aed6f1; cursor:pointer;" title="Ver Evidencia PDF" onclick="openPdfEvidencia('${ped.id}', event)">
                                                             📄 Ver PDF
                                                         </button>
                                                       </td>`
                            : `<td style="text-align:center; vertical-align:top; color:var(--gray-light); font-size:0.75rem;">—</td>`;

                        return `
                                                    <tr>
                                                        <td style="font-weight:600; font-family:var(--font-mono); vertical-align:top;">${ped.numero_pedido}</td>
                                                        <td style="vertical-align:top;">
                                                            <strong>${provName}</strong>
                                                            ${itemsHTML ? `<div style="margin-top: 6px; border-top: 1px dashed #e6e8eb; padding-top:4px;">${itemsHTML}</div>` : ''}
                                                        </td>
                                                        <td style="font-family:var(--font-mono); font-weight:700; color:var(--black); vertical-align:top;">$ ${fmt.number(ped.monto)}</td>
                                                        <td style="vertical-align:top;">${fmt.date(ped.fecha_pedido)}</td>
                                                        <td style="vertical-align:top;">${ped.fecha_entrega ? fmt.date(ped.fecha_entrega) : "—"}</td>
                                                        <td style="vertical-align:top;">
                                                            <span class="status-badge badge-ped-${ped.estado.toLowerCase().replace(/\s+/g, '-')}">${ped.estado}</span>
                                                        </td>
                                                        ${evidenciaBtn}
                                                        ${editPedBtn}
                                                    </tr>
                                                `;
                    }).join('')}
                                        </tbody>
                                    </table>
                                `;
                }

                let priorityBadge = "";
                if (req.prioridad === 1) {
                    priorityBadge = `<span class="badge" style="background:rgba(231,76,60,0.12); color:#c0392b; font-weight:700; border:1px solid rgba(231,76,60,0.2); font-size:0.75rem; padding:2px 8px;">Alta</span>`;
                } else if (req.prioridad === 2) {
                    priorityBadge = `<span class="badge" style="background:rgba(241,196,15,0.15); color:#9a7d0a; font-weight:700; border:1px solid rgba(241,196,15,0.25); font-size:0.75rem; padding:2px 8px;">Media</span>`;
                } else {
                    priorityBadge = `<span class="badge" style="background:rgba(52,152,219,0.12); color:#2980b9; font-weight:700; border:1px solid rgba(52,152,219,0.25); font-size:0.75rem; padding:2px 8px;">Baja</span>`;
                }

                const totalColumns = canEdit ? 9 : 8;

                return `
                              <tr class="${rowClass}" id="req-row-${req.id}" onclick="toggleRequisitionExpand('${req.id}')">
                                <td style="text-align:center; vertical-align:middle;">
                                  <button class="requisicion-toggle-btn" id="req-toggle-${req.id}">${toggleChar}</button>
                                </td>
                                <td style="font-weight:600; font-family:var(--font-mono); vertical-align:middle;">${req.numero_requisicion}</td>
                                <td style="font-family:var(--font-mono); font-weight:700; text-align:right; vertical-align:middle;">
                                  $ ${fmt.number(req.monto || 0)}
                                  <div style="font-size:0.68rem; color:${montoRestante >= 0 ? 'var(--gray-light)' : '#e74c3c'}; font-weight:normal;">
                                    Resto: $ ${fmt.number(montoRestante)}
                                  </div>
                                </td>
                                <td style="text-align:center; vertical-align:middle;">${priorityBadge}</td>
                                <td style="font-size:0.85rem; color:var(--gray-dark); vertical-align:middle; max-width:300px; white-space:normal; word-break:break-word;">
                                  ${req.concepto || "—"}
                                </td>
                                <td style="vertical-align:middle;">${req.solicitante || "—"}</td>
                                <td style="white-space:nowrap; vertical-align:middle;">${fmt.date(req.fecha_requisicion)}</td>
                                <td style="vertical-align:middle;">
                                  <span class="badge badge-req-${req.estado.toLowerCase()}">${req.estado}</span>
                                </td>
                                <td style="vertical-align:middle;">${editBtn}</td>
                              </tr>
                              <tr class="pedidos-detail-row" id="req-detail-row-${req.id}" ${detailStyle}>
                                <td colspan="${totalColumns}">
                                  <div class="pedidos-container">
                                    <div style="display: grid; grid-template-columns: 4fr 5fr; gap: 24px; align-items: start;">
                                      <div>
                                        <div class="pedidos-title" style="margin-bottom: 12px;">
                                            <span>📋 Productos Solicitados (${reqItems.length})</span>
                                        </div>
                                        ${itemsTableHTML}
                                      </div>
                                      <div>
                                        <div class="pedidos-title" style="margin-bottom: 12px;">
                                            <span>📦 Pedidos asociados (${reqPeds.length})</span>
                                            <span style="font-family:var(--font-mono); font-size:0.75rem; color:var(--black); font-weight:normal;">Total: $ ${fmt.number(totalAmount)} | Resto: $ ${fmt.number(montoRestante)}</span>
                                        </div>
                                        ${ordersTableHTML}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            `;
            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Accordion headers badges
        let badgesHTML = "";
        if (pendingCount > 0) {
            badgesHTML += `<span class="badge badge-req-pendiente" style="font-size:0.65rem; padding:2px 8px; margin-right:6px;">${pendingCount} pendiente(s)</span>`;
        }
        if (approvedCount > 0) {
            badgesHTML += `<span class="badge badge-req-aprobada" style="font-size:0.65rem; padding:2px 8px; margin-right:6px;">${approvedCount} aprobada(s)</span>`;
        }
        if (completedCount > 0) {
            badgesHTML += `<span class="badge badge-req-completada" style="font-size:0.65rem; padding:2px 8px; margin-right:6px;">${completedCount} completa(s)</span>`;
        }
        if (pendingCount === 0 && approvedCount === 0 && completedCount === 0) {
            badgesHTML = `<span class="badge" style="font-size:0.65rem; padding:2px 8px; color:var(--gray-light); background:var(--gray-pale); border:1px solid var(--gray-light)">Sin pendientes</span>`;
        }

        return `
            <div class="table-card" id="card-${w.id}">
                <div class="accordion-header" onclick="toggleAccordion('${w.id}')">
                    <div class="accordion-info">
                        <div class="accordion-title-container">
                            <div class="accordion-title">${w.name}</div>
                            <div class="accordion-subtitle">${w.code} · ${w.city || ""} ${w.state ? ", " + w.state : ""}</div>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <div class="badge-container-wh">${badgesHTML}</div>
                        <span class="summary-badge">${wReqs.length} requi(s)</span>
                        <svg class="accordion-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                </div>
                <div class="accordion-content">
                    <div style="padding: 16px 22px;">
                        ${tableHTML}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// =========================================================
// REQUISICIÓN MODAL INTERACTIONS & CRUD & PRODUCT SELECTION
// =========================================================

// Autocomplete Product search input event (Requisitions - searches all active products)
window.onReqProductSearchInput = function () {
    const input = document.getElementById("req-product-search");
    const dropdown = document.getElementById("req-product-dropdown-results");
    const q = input.value.trim().toLowerCase();

    if (!q) {
        dropdown.innerHTML = "";
        dropdown.classList.remove("open");
        selectedTempProduct = null;
        return;
    }

    const matches = productsList.filter(p =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q)
    ).slice(0, 15);

    if (matches.length === 0) {
        dropdown.innerHTML = `<div style="padding:10px; font-size:0.8rem; color:var(--gray-light); text-align:center;">Sin coincidencias</div>`;
    } else {
        dropdown.innerHTML = matches.map(p => `
            <div class="product-dropdown-item" onclick="selectReqProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${p.code}', '${p.unit}')">
                <span>${p.name}</span>
                <span class="item-code">${p.code} (${p.unit})</span>
            </div>
        `).join('');
    }
    dropdown.classList.add("open");
};

// Select a product from the dropdown list (Requisition)
window.selectReqProduct = function (id, name, code, unit) {
    selectedTempProduct = { id, name, code, unit };
    document.getElementById("req-product-search").value = `${name} (${code})`;

    const dropdown = document.getElementById("req-product-dropdown-results");
    dropdown.innerHTML = "";
    dropdown.classList.remove("open");

    document.getElementById("req-product-qty").focus();
};

// Add product input to Requisition selection array
window.addInsumoToRequisicion = function () {
    if (!selectedTempProduct) {
        Toast.show("Selecciona un producto de la lista primero", "error");
        return;
    }

    const qtyStr = document.getElementById("req-product-qty").value;
    const qty = parseFloat(qtyStr);

    if (isNaN(qty) || qty <= 0) {
        Toast.show("Ingresa una cantidad mayor a cero", "error");
        return;
    }

    const existing = selectedReqItems.find(it => it.productId === selectedTempProduct.id);
    if (existing) {
        existing.quantity += qty;
    } else {
        selectedReqItems.push({
            productId: selectedTempProduct.id,
            code: selectedTempProduct.code,
            name: selectedTempProduct.name,
            unit: selectedTempProduct.unit,
            quantity: qty
        });
    }

    renderReqSelectedItems();

    document.getElementById("req-product-search").value = "";
    document.getElementById("req-product-qty").value = "";
    selectedTempProduct = null;
};

// Remove product from Requisition selection array
window.removeInsumoFromRequisicion = function (productId) {
    selectedReqItems = selectedReqItems.filter(it => it.productId !== productId);
    renderReqSelectedItems();
};

// Render the selected products inside the Requisition Modal
function renderReqSelectedItems() {
    const tbody = document.getElementById("req-items-body");
    if (selectedReqItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; color:var(--gray-light); font-size:0.8rem; padding:16px;">
                    Ningún producto seleccionado
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = selectedReqItems.map(it => `
        <tr>
            <td style="font-weight:600; font-family:var(--font-mono);">${it.code}</td>
            <td>${it.name}</td>
            <td>${it.unit}</td>
            <td style="text-align:right; font-family:var(--font-mono); font-weight:700;">${fmt.number(it.quantity)}</td>
            <td style="text-align:center; vertical-align:middle;">
                <button class="btn-delete-row" onclick="removeInsumoFromRequisicion('${it.productId}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px; height:14px;">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// Requisition Modal Open / Creation Setup
window.openCreateRequisicion = function () {
    if (!canEdit) { Toast.show("Sin permiso para registrar requisiciones", "error"); return; }
    document.getElementById("requisicion-modal-title").textContent = "Nueva Requisición";
    document.getElementById("req-id").value = "";
    document.getElementById("req-warehouse").value = "";
    document.getElementById("req-warehouse").disabled = false;
    document.getElementById("req-code").value = "";
    document.getElementById("req-solicitante").value = "";
    document.getElementById("req-concepto").value = "";
    document.getElementById("req-monto").value = "";
    document.getElementById("req-prioridad").value = "3";

    const today = new Date().toISOString().split('T')[0];
    document.getElementById("req-fecha").value = today;
    document.getElementById("req-estado").value = "PENDIENTE";

    // Reset products list
    selectedReqItems = [];
    selectedTempProduct = null;
    document.getElementById("req-product-search").value = "";
    document.getElementById("req-product-qty").value = "";
    renderReqSelectedItems();

    Modal.open("modal-requisicion");
};

// Requisition Modal Open / Edit Setup
window.openEditRequisicion = function (req) {
    if (!canEdit) { Toast.show("Sin permiso para editar requisiciones", "error"); return; }
    document.getElementById("requisicion-modal-title").textContent = "Editar Requisición";
    document.getElementById("req-id").value = req.id;
    document.getElementById("req-warehouse").value = req.warehouse_id;
    document.getElementById("req-warehouse").disabled = true;
    document.getElementById("req-code").value = req.numero_requisicion;
    document.getElementById("req-solicitante").value = req.solicitante || "";
    document.getElementById("req-concepto").value = req.concepto || "";
    document.getElementById("req-fecha").value = req.fecha_requisicion;
    document.getElementById("req-monto").value = req.monto || "";
    document.getElementById("req-prioridad").value = req.prioridad || "3";
    document.getElementById("req-estado").value = req.estado;

    // Load existing items
    const items = detallesRequiList.filter(d => d.requisicion_id === req.id);
    selectedReqItems = items.map(it => {
        const prod = productsList.find(p => p.id === it.producto_id);
        return {
            productId: it.producto_id,
            code: prod ? prod.code : "—",
            name: prod ? prod.name : "Producto eliminado",
            unit: prod ? prod.unit : "—",
            quantity: parseFloat(it.cantidad || 0)
        };
    });

    selectedTempProduct = null;
    document.getElementById("req-product-search").value = "";
    document.getElementById("req-product-qty").value = "";
    renderReqSelectedItems();

    Modal.open("modal-requisicion");
};

// Requisition Save Click Handler
document.getElementById("btn-requisicion-save").addEventListener("click", async () => {
    if (!canEdit) { Toast.show("Sin permiso para guardar", "error"); return; }

    const id = document.getElementById("req-id").value;
    const warehouse_id = document.getElementById("req-warehouse").value;
    const numero_requisicion = document.getElementById("req-code").value.trim();
    const solicitante = document.getElementById("req-solicitante").value.trim() || null;
    const concepto = document.getElementById("req-concepto").value.trim() || null;
    const fecha_requisicion = document.getElementById("req-fecha").value;
    const estado = document.getElementById("req-estado").value;

    const montoStr = document.getElementById("req-monto").value;
    const prioridadStr = document.getElementById("req-prioridad").value;

    const monto = parseFloat(montoStr || 0);
    if (isNaN(monto) || monto < 0) {
        Toast.show("El monto debe ser un número positivo", "error");
        return;
    }

    const prioridad = parseInt(prioridadStr || 3);

    if (!warehouse_id || !numero_requisicion || !fecha_requisicion || !estado) {
        Toast.show("Completa todos los campos obligatorios (*)", "error");
        return;
    }

    const btn = document.getElementById("btn-requisicion-save");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    const payload = {
        warehouse_id,
        numero_requisicion,
        solicitante,
        concepto,
        fecha_requisicion,
        monto,
        prioridad,
        estado,
        updated_at: new Date().toISOString()
    };

    try {
        let reqId = id;

        if (id) {
            const { error: masterError } = await db.from("requisiciones").update(payload).eq("id", id);
            if (masterError) throw masterError;
        } else {
            const { data: newReq, error: masterError } = await db.from("requisiciones").insert(payload).select().single();
            if (masterError) throw masterError;
            reqId = newReq.id;
        }

        if (id) {
            const { error: deleteError } = await db.from("detalles_requi").delete().eq("requisicion_id", reqId);
            if (deleteError) throw deleteError;
        }

        if (selectedReqItems.length > 0) {
            const detailPayloads = selectedReqItems.map(it => ({
                requisicion_id: reqId,
                producto_id: it.productId,
                cantidad: it.quantity
            }));
            const { error: itemsError } = await db.from("detalles_requi").insert(detailPayloads);
            if (itemsError) throw itemsError;
        }

        Toast.show(id ? "Requisición actualizada" : "Requisición registrada", "success");
        Modal.close("modal-requisicion");
        loadAll();
    } catch (err) {
        console.error("Error al guardar requisición y detalles:", err);
        Toast.show("Error al guardar: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Guardar";
    }
});


// Helper to calculate the remaining pending quantity of a product in a requisition,
// optionally excluding a specific order (e.g. when editing that order)
function getRequisitionItemPendingQty(requisicionId, productId, excludePedidoId = null) {
    const ri = detallesRequiList.find(d => d.requisicion_id === requisicionId && d.producto_id === productId);
    if (!ri) return 0;
    const originalQty = parseFloat(ri.cantidad || 0);

    const reqPeds = pedidosList.filter(p => p.requisicion_id === requisicionId && p.id !== excludePedidoId);
    const pedIds = reqPeds.map(p => p.id);
    const orderedItems = pedidoDetalleList.filter(pd => pedIds.includes(pd.pedido_id) && pd.producto_id === productId);
    const totalOrdered = orderedItems.reduce((sum, pi) => sum + parseFloat(pi.cantidad || 0), 0);

    return Math.max(0, originalQty - totalOrdered);
}


// =========================================================
// PEDIDO MODAL INTERACTIONS & CRUD & PRODUCT SELECTION
// =========================================================

// Autocomplete Product search input event (Orders - ONLY searches products in Requisition details)
window.onPedProductSearchInput = function () {
    const input = document.getElementById("ped-product-search");
    const dropdown = document.getElementById("ped-product-dropdown-results");
    const q = input.value.trim().toLowerCase();

    if (!q) {
        dropdown.innerHTML = "";
        dropdown.classList.remove("open");
        selectedTempPedProduct = null;
        document.getElementById("ped-max-qty-info").style.display = "none";
        return;
    }

    const reqId = document.getElementById("ped-requisicion-id").value;
    const currentPedidoId = document.getElementById("ped-id").value || null;

    // Filter currentRequisitionItems (detalles_requi items) matching productsList code/name
    const matches = currentRequisitionItems.map(ri => {
        const prod = productsList.find(p => p.id === ri.producto_id);
        const maxQty = getRequisitionItemPendingQty(reqId, ri.producto_id, currentPedidoId);
        return {
            ri,
            prod,
            maxQty
        };
    }).filter(match => {
        if (!match.prod) return false;
        return match.prod.code.toLowerCase().includes(q) ||
            match.prod.name.toLowerCase().includes(q);
    }).slice(0, 15);

    if (matches.length === 0) {
        dropdown.innerHTML = `<div style="padding:10px; font-size:0.8rem; color:var(--gray-light); text-align:center;">Sin coincidencias (Solo productos en la requisición)</div>`;
    } else {
        dropdown.innerHTML = matches.map(m => `
            <div class="product-dropdown-item" onclick="selectPedProduct('${m.prod.id}', '${m.prod.name.replace(/'/g, "\\'")}', '${m.prod.code}', '${m.prod.unit}', ${m.maxQty})">
                <span>${m.prod.name}</span>
                <span class="item-code">Disponible: ${fmt.number(m.maxQty)} ${m.prod.unit} · ${m.prod.code}</span>
            </div>
        `).join('');
    }
    dropdown.classList.add("open");
};

// Select a product from the dropdown list (Order)
window.selectPedProduct = function (productId, name, code, unit, maxQty) {
    selectedTempPedProduct = { id: productId, name, code, unit, maxQty };
    document.getElementById("ped-product-search").value = `${name} (${code})`;

    // Hide dropdown
    const dropdown = document.getElementById("ped-product-dropdown-results");
    dropdown.innerHTML = "";
    dropdown.classList.remove("open");

    // Display max limit info
    const maxInfo = document.getElementById("ped-max-qty-info");
    maxInfo.textContent = `Límite máximo en Requisición: ${fmt.number(maxQty)} ${unit}`;
    maxInfo.style.display = "block";

    document.getElementById("ped-product-qty").focus();
};

// Add product input to Order selection array
window.addInsumoToPedido = function () {
    if (!selectedTempPedProduct) {
        Toast.show("Selecciona un producto de la lista primero", "error");
        return;
    }

    const qtyStr = document.getElementById("ped-product-qty").value;
    const qty = parseFloat(qtyStr);

    if (isNaN(qty) || qty <= 0) {
        Toast.show("Ingresa una cantidad mayor a cero", "error");
        return;
    }

    // Validation: "al igual del máximo de pieza expresado en la requisición"
    const existing = selectedPedItems.find(it => it.productId === selectedTempPedProduct.id);
    const totalQty = (existing ? existing.quantity : 0) + qty;

    if (totalQty > selectedTempPedProduct.maxQty) {
        Toast.show(`Cantidad excedida. Máximo permitido en Requi: ${selectedTempPedProduct.maxQty}. Intentas registrar: ${totalQty}.`, "error", 5000);
        return;
    }

    if (existing) {
        existing.quantity = totalQty;
    } else {
        selectedPedItems.push({
            productId: selectedTempPedProduct.id,
            code: selectedTempPedProduct.code,
            name: selectedTempPedProduct.name,
            unit: selectedTempPedProduct.unit,
            quantity: qty,
            maxQty: selectedTempPedProduct.maxQty
        });
    }

    renderPedSelectedItems();

    document.getElementById("ped-product-search").value = "";
    document.getElementById("ped-product-qty").value = "";
    document.getElementById("ped-max-qty-info").style.display = "none";
    selectedTempPedProduct = null;
};

// Remove product from Order selection array
window.removeInsumoFromPedido = function (productId) {
    selectedPedItems = selectedPedItems.filter(it => it.productId !== productId);
    renderPedSelectedItems();
};

// Render the selected products inside the Order Modal
function renderPedSelectedItems() {
    const tbody = document.getElementById("ped-items-body");
    if (selectedPedItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; color:var(--gray-light); font-size:0.8rem; padding:16px;">
                    Ningún producto seleccionado en este pedido
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = selectedPedItems.map(it => `
        <tr>
            <td style="font-weight:600; font-family:var(--font-mono);">${it.code}</td>
            <td>${it.name}</td>
            <td>${it.unit}</td>
            <td style="text-align:right; font-family:var(--font-mono); font-weight:700;">
                ${fmt.number(it.quantity)}
                <div style="font-size:0.68rem; color:var(--gray-light); font-weight:normal;">Máx: ${fmt.number(it.maxQty)}</div>
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <button class="btn-delete-row" onclick="removeInsumoFromPedido('${it.productId}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px; height:14px;">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// Close Order product dropdown on click outside
document.addEventListener("click", function (e) {
    const dropdown = document.getElementById("ped-product-dropdown-results");
    const searchInput = document.getElementById("ped-product-search");
    if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.innerHTML = "";
        dropdown.classList.remove("open");
    }
});

// Helper function to convert base64 Data URL to Blob URL for browser tab opening
function base64ToBlobUrl(dataUrl) {
    try {
        const parts = dataUrl.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        const blob = new Blob([u8arr], { type: mime });
        return URL.createObjectURL(blob);
    } catch (e) {
        console.error("Error al convertir base64 a Blob URL:", e);
        return dataUrl;
    }
}

// Global handler to safely open PDF evidence in a new tab (supports Supabase URLs & Base64 Data URLs)
window.openPdfEvidencia = function (target, event) {
    if (event) event.stopPropagation();

    let url = target;
    // If target is a pedido ID, retrieve evidencia_url from pedidosList
    if (target && !target.startsWith("http") && !target.startsWith("data:") && !target.startsWith("blob:")) {
        const ped = pedidosList.find(p => p.id === target);
        url = ped ? ped.evidencia_url : null;
    }

    if (!url) {
        Toast.show("No hay evidencia PDF registrada en este pedido", "info");
        return;
    }

    if (url.startsWith("data:")) {
        const blobUrl = base64ToBlobUrl(url);
        window.open(blobUrl, "_blank");
    } else {
        window.open(url, "_blank");
    }
};

// Modal handler to preview current or pending PDF evidence
window.openPdfEvidenciaInModal = function (event) {
    if (event) event.preventDefault();
    if (pendingEvidenciaFile) {
        const tempUrl = URL.createObjectURL(pendingEvidenciaFile);
        window.open(tempUrl, "_blank");
    } else if (currentPedEvidenciaUrl) {
        openPdfEvidencia(currentPedEvidenciaUrl, event);
    } else {
        Toast.show("No hay evidencia cargada", "info");
    }
};

// Remove PDF evidence from Order modal
window.removePedEvidencia = function () {
    currentPedEvidenciaUrl = null;
    pendingEvidenciaFile = null;
    const fileInput = document.getElementById("ped-evidencia-file");
    if (fileInput) fileInput.value = "";
    const preview = document.getElementById("ped-evidencia-preview");
    if (preview) preview.style.display = "none";
};

// Listen for PDF file selection
document.addEventListener("change", (e) => {
    if (e.target && e.target.id === "ped-evidencia-file") {
        const file = e.target.files[0];
        if (!file) return;
        if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
            Toast.show("Selecciona un archivo PDF válido", "error");
            e.target.value = "";
            return;
        }
        pendingEvidenciaFile = file;
        const link = document.getElementById("ped-evidencia-link");
        if (link) {
            link.textContent = `📄 ${file.name} (PDF listo para guardar)`;
        }
        const preview = document.getElementById("ped-evidencia-preview");
        if (preview) preview.style.display = "flex";
    }
});

// Helper function to upload PDF file to Supabase Storage with Data URL fallback
async function uploadEvidenciaPdf(file, pedidoNum) {
    try {
        const timestamp = Date.now();
        const cleanNum = (pedidoNum || "ped").replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePath = `pedidos/${cleanNum}_${timestamp}.pdf`;

        const { data, error } = await db.storage.from("evidencias").upload(filePath, file, {
            cacheControl: "3600",
            upsert: true
        });

        if (!error && data) {
            const { data: publicUrlData } = db.storage.from("evidencias").getPublicUrl(filePath);
            if (publicUrlData && publicUrlData.publicUrl) {
                return publicUrlData.publicUrl;
            }
        }
    } catch (err) {
        console.warn("Supabase Storage bucket fallback triggered:", err);
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

// Order Modal Open / Creation Setup
window.openCreatePedido = function (req) {
    if (!canEdit) { Toast.show("Sin permiso para agregar pedidos", "error"); return; }
    document.getElementById("pedido-modal-title").textContent = "Nuevo Pedido";
    document.getElementById("ped-id").value = "";
    document.getElementById("ped-requisicion-id").value = req.id;
    document.getElementById("ped-requisicion-info").textContent = `${req.numero_requisicion} · ${req.concepto || "Sin concepto"}`;

    document.getElementById("ped-code").value = "";
    document.getElementById("ped-supplier").value = "";
    document.getElementById("ped-monto").value = "";

    const today = new Date().toISOString().split('T')[0];
    document.getElementById("ped-fecha-pedido").value = today;
    document.getElementById("ped-fecha-entrega").value = "";
    document.getElementById("ped-descripcion").value = "";
    document.getElementById("ped-estado").value = "PENDIENTE";

    // Reset Evidence PDF state
    currentPedEvidenciaUrl = null;
    pendingEvidenciaFile = null;
    const fileInput = document.getElementById("ped-evidencia-file");
    if (fileInput) fileInput.value = "";
    const preview = document.getElementById("ped-evidencia-preview");
    if (preview) preview.style.display = "none";

    // Setup Requisition Items limits
    currentRequisitionItems = detallesRequiList.filter(d => d.requisicion_id === req.id);
    selectedPedItems = [];
    selectedTempPedProduct = null;
    document.getElementById("ped-product-search").value = "";
    document.getElementById("ped-product-qty").value = "";
    document.getElementById("ped-max-qty-info").style.display = "none";
    renderPedSelectedItems();

    Modal.open("modal-pedido");
};

// Order Modal Open / Edit Setup
window.openEditPedido = function (ped, req) {
    if (!canEdit) { Toast.show("Sin permiso para editar pedidos", "error"); return; }
    document.getElementById("pedido-modal-title").textContent = "Editar Pedido";
    document.getElementById("ped-id").value = ped.id;
    document.getElementById("ped-requisicion-id").value = ped.requisicion_id;
    document.getElementById("ped-requisicion-info").textContent = `${req.numero_requisicion} · ${req.concepto || "Sin concepto"}`;

    document.getElementById("ped-code").value = ped.numero_pedido;
    document.getElementById("ped-supplier").value = ped.proveedor_id || "";
    document.getElementById("ped-monto").value = ped.monto;
    document.getElementById("ped-fecha-pedido").value = ped.fecha_pedido;
    document.getElementById("ped-fecha-entrega").value = ped.fecha_entrega || "";
    document.getElementById("ped-descripcion").value = ped.descripcion || "";
    document.getElementById("ped-estado").value = ped.estado;

    // Setup Evidence PDF state
    currentPedEvidenciaUrl = ped.evidencia_url || null;
    pendingEvidenciaFile = null;
    const fileInput = document.getElementById("ped-evidencia-file");
    if (fileInput) fileInput.value = "";
    const preview = document.getElementById("ped-evidencia-preview");
    const link = document.getElementById("ped-evidencia-link");
    if (currentPedEvidenciaUrl) {
        if (link) {
            link.href = currentPedEvidenciaUrl;
            link.textContent = "Ver Evidencia PDF Guardada";
        }
        if (preview) preview.style.display = "flex";
    } else {
        if (preview) preview.style.display = "none";
    }

    // Setup Requisition Items limits
    currentRequisitionItems = detallesRequiList.filter(d => d.requisicion_id === req.id);

    // Load existing items
    const items = pedidoDetalleList.filter(pd => pd.pedido_id === ped.id);
    selectedPedItems = items.map(it => {
        const prod = productsList.find(p => p.id === it.producto_id);
        const pending = getRequisitionItemPendingQty(req.id, it.producto_id, ped.id);
        return {
            productId: it.producto_id,
            code: prod ? prod.code : "—",
            name: prod ? prod.name : "Producto eliminado",
            unit: prod ? prod.unit : "—",
            quantity: parseFloat(it.cantidad || 0),
            maxQty: Math.max(pending, parseFloat(it.cantidad || 0))
        };
    });

    selectedTempPedProduct = null;
    document.getElementById("ped-product-search").value = "";
    document.getElementById("ped-product-qty").value = "";
    document.getElementById("ped-max-qty-info").style.display = "none";
    renderPedSelectedItems();

    Modal.open("modal-pedido");
};

// Order Save Click Handler
document.getElementById("btn-pedido-save").addEventListener("click", async () => {
    if (!canEdit) { Toast.show("Sin permiso para guardar", "error"); return; }

    const id = document.getElementById("ped-id").value;
    const requisicion_id = document.getElementById("ped-requisicion-id").value;
    const numero_pedido = document.getElementById("ped-code").value.trim();
    const proveedor_id = document.getElementById("ped-supplier").value || null;
    const montoStr = document.getElementById("ped-monto").value;
    const fecha_pedido = document.getElementById("ped-fecha-pedido").value;
    const fecha_entrega = document.getElementById("ped-fecha-entrega").value || null;
    const descripcion = document.getElementById("ped-descripcion").value.trim() || null;
    const estado = document.getElementById("ped-estado").value;

    if (!requisicion_id || !numero_pedido || !fecha_pedido || !montoStr || !estado) {
        Toast.show("Completa todos los campos obligatorios (*)", "error");
        return;
    }

    const monto = parseFloat(montoStr);
    if (isNaN(monto) || monto < 0) {
        Toast.show("El monto debe ser un número positivo", "error");
        return;
    }

    const btn = document.getElementById("btn-pedido-save");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    let evidencia_url = currentPedEvidenciaUrl;
    if (pendingEvidenciaFile) {
        btn.textContent = "Subiendo PDF...";
        try {
            evidencia_url = await uploadEvidenciaPdf(pendingEvidenciaFile, numero_pedido);
        } catch (uploadErr) {
            console.error("Error al subir archivo PDF:", uploadErr);
            Toast.show("Error procesando archivo PDF: " + uploadErr.message, "error");
            btn.disabled = false;
            btn.textContent = "Guardar";
            return;
        }
    }

    const payload = {
        requisicion_id,
        numero_pedido,
        proveedor_id,
        monto,
        fecha_pedido,
        fecha_entrega,
        descripcion,
        evidencia_url,
        estado,
        updated_at: new Date().toISOString()
    };

    try {
        let pedId = id;

        // 1. Save Master Order
        if (id) {
            const { error: masterError } = await db.from("pedidos").update(payload).eq("id", id);
            if (masterError) throw masterError;
        } else {
            const { data: newPed, error: masterError } = await db.from("pedidos").insert(payload).select().single();
            if (masterError) throw masterError;
            pedId = newPed.id;
        }

        // 2. Save Selected products (pedido_detalle)
        if (id) {
            const { error: deleteError } = await db.from("pedido_detalle").delete().eq("pedido_id", pedId);
            if (deleteError) throw deleteError;
        }

        if (selectedPedItems.length > 0) {
            const detailPayloads = selectedPedItems.map(it => ({
                pedido_id: pedId,
                producto_id: it.productId,
                cantidad: it.quantity
            }));
            const { error: itemsError } = await db.from("pedido_detalle").insert(detailPayloads);
            if (itemsError) throw itemsError;
        }

        Toast.show(id ? "Pedido actualizado con éxito" : "Pedido registrado con éxito", "success");
        Modal.close("modal-pedido");

        expandedRequisitions.add(requisicion_id);
        loadAll();
    } catch (err) {
        console.error("Error al guardar pedido y detalle:", err);
        if (err.code === "42703" || (err.message && err.message.includes("evidencia_url"))) {
            Toast.show("Falta la columna 'evidencia_url' en Supabase. Ejecuta: ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS evidencia_url TEXT;", "error", 10000);
        } else {
            Toast.show("Error al guardar: " + err.message, "error");
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Guardar";
    }
});


// =========================================================
// EXCEL EXPORTATION
// =========================================================
window.exportExcel = function () {
    if (!requisicionesList || requisicionesList.length === 0) {
        Toast.show("No hay requisiciones para exportar", "info");
        return;
    }

    const btn = document.getElementById("btn-export-excel");
    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Exportando...`;

    try {
        const wb = XLSX.utils.book_new();

        // 1. REQUISICIONES sheet
        const reqRows = requisicionesList.map(r => {
            const wh = warehousesList.find(w => w.id === r.warehouse_id);
            const reqPeds = pedidosList.filter(p => p.requisicion_id === r.id);
            const totalMonto = reqPeds.reduce((acc, p) => acc + parseFloat(p.monto || 0), 0);

            return {
                "Almacén": wh ? `${wh.name} (${wh.code})` : "—",
                "Número Requisición": r.numero_requisicion || "",
                "Solicitante": r.solicitante || "",
                "Concepto / Elementos": r.concepto || "",
                "Fecha Requisición": r.fecha_requisicion ? fmt.date(r.fecha_requisicion) : "",
                "Estado": r.estado || "",
                "Cantidad Pedidos": reqPeds.length,
                "Monto Acumulado": totalMonto
            };
        });
        const wsReq = XLSX.utils.json_to_sheet(reqRows);
        wsReq["!cols"] = [
            { wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 35 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 18 }
        ];
        XLSX.utils.book_append_sheet(wb, wsReq, "REQUISICIONES");

        // 2. DETALLES REQUISICIONES sheet
        const detRows = detallesRequiList.map(d => {
            const req = requisicionesList.find(r => r.id === d.requisicion_id);
            const wh = req ? warehousesList.find(w => w.id === req.warehouse_id) : null;
            const prod = productsList.find(p => p.id === d.producto_id);

            return {
                "Almacén": wh ? `${wh.name} (${wh.code})` : "—",
                "Número Requisición": req ? req.numero_requisicion : "—",
                "Código Producto": prod ? prod.code : "—",
                "Nombre Producto": prod ? prod.name : "Producto eliminado",
                "Unidad": prod ? prod.unit : "—",
                "Cantidad": d.cantidad || 0
            };
        });
        const wsDet = XLSX.utils.json_to_sheet(detRows);
        wsDet["!cols"] = [
            { wch: 25 }, { wch: 22 }, { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsDet, "DETALLES_REQUISICIONES");

        // 3. PEDIDOS sheet
        const pedRows = pedidosList.map(p => {
            const req = requisicionesList.find(r => r.id === p.requisicion_id);
            const wh = req ? warehousesList.find(w => w.id === req.warehouse_id) : null;
            const prov = suppliersList.find(s => s.id === p.proveedor_id);

            return {
                "Almacén": wh ? `${wh.name} (${wh.code})` : "—",
                "Requisición Relacionada": req ? req.numero_requisicion : "—",
                "Número Pedido": p.numero_pedido || "",
                "Proveedor": prov ? prov.company_name : "—",
                "Monto": p.monto || 0,
                "Fecha Pedido": p.fecha_pedido ? fmt.date(p.fecha_pedido) : "",
                "Fecha Entrega": p.fecha_entrega ? fmt.date(p.fecha_entrega) : "—",
                "Estado": p.estado || "",
                "Evidencia PDF": p.evidencia_url ? "SÍ (PDF Adjunto)" : "NO",
                "Descripción / Notas": p.descripcion || "",
                "Fecha Registro": p.created_at ? new Date(p.created_at).toLocaleString("es-MX") : ""
            };
        });
        const wsPed = XLSX.utils.json_to_sheet(pedRows);
        wsPed["!cols"] = [
            { wch: 25 }, { wch: 22 }, { wch: 18 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 30 }, { wch: 22 }
        ];
        XLSX.utils.book_append_sheet(wb, wsPed, "PEDIDOS");

        // 4. DETALLES PEDIDOS sheet
        const pedDetRows = pedidoDetalleList.map(pd => {
            const ped = pedidosList.find(p => p.id === pd.pedido_id);
            const req = ped ? requisicionesList.find(r => r.id === ped.requisicion_id) : null;
            const wh = req ? warehousesList.find(w => w.id === req.warehouse_id) : null;
            const prod = productsList.find(p => p.id === pd.producto_id);

            return {
                "Almacén": wh ? `${wh.name} (${wh.code})` : "—",
                "Requisición": req ? req.numero_requisicion : "—",
                "Número Pedido": ped ? ped.numero_pedido : "—",
                "Código Producto": prod ? prod.code : "—",
                "Nombre Producto": prod ? prod.name : "Producto eliminado",
                "Unidad": prod ? prod.unit : "—",
                "Cantidad": pd.cantidad || 0
            };
        });
        const wsPedDet = XLSX.utils.json_to_sheet(pedDetRows);
        wsPedDet["!cols"] = [
            { wch: 25 }, { wch: 22 }, { wch: 18 }, { wch: 15 }, { wch: 30 }, { wch: 12 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsPedDet, "DETALLES_PEDIDOS");

        // 5. INFO metadata sheet
        const metaRows = [
            ["HEAD STORE — Exportación de Módulo de Compras (Carátula)"],
            [""],
            ["Fecha de exportación:", new Date().toLocaleString("es-MX")],
            ["Exportado por:", user?.full_name || user?.email || "—"],
            ["Total Requisiciones:", requisicionesList.length],
            ["Total Detalles (Insumos Requi):", detallesRequiList.length],
            ["Total Pedidos:", pedidosList.length],
            ["Total Detalles (Insumos Pedido):", pedidoDetalleList.length]
        ];
        const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
        wsMeta["!cols"] = [{ wch: 28 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, wsMeta, "INFO");

        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `compras_headstore_${dateStr}.xlsx`);
        Toast.show("Datos de compras exportados con éxito", "success");
    } catch (err) {
        console.error("Error exportando compras a Excel:", err);
        Toast.show("Error al exportar: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = origHTML;
    }
};
