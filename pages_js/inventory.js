
// State of pagination
let currentPage = 1;
const pageSize = 50;
let totalRecords = 0;

const user = Auth.requireAuth();
// SUPERVISOR ahora es de solo lectura — solo ADMIN puede editar inventario
const canEdit = Auth.canEdit();
// STOREKEEPER y COORDINADOR pueden registrar entradas y salidas
const canEntryExit = Auth.isAdmin() || Auth.isAlmacenista() || Auth.isCoordinador();
let allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

// Catálogos en memoria para validación masiva
let catalogProducts = {};  // { code → { id, name, unit, minimum_stock } }
let catalogProductsArray = [];
let catalogWarehouses = {}; // { code → { id, name } }
let catalogWarehousesArray = [];
let catalogProjectsArray = [];

// ── Diagnóstico de librerías PDF ──
(function checkPDFLibs() {
    const jsPDFok = !!(window.jspdf && window.jspdf.jsPDF);
    const doc = jsPDFok ? new window.jspdf.jsPDF() : null;
    const autoTableOk = !!(doc && typeof doc.autoTable === "function");
    console.info(`[PDF Libs] jsPDF: ${jsPDFok ? "✓ OK" : "✗ NO CARGÓ"} | autoTable: ${autoTableOk ? "✓ OK" : "✗ NO CARGÓ"}`);
    if (!jsPDFok) console.warn("[PDF Libs] Verifica conexión a internet. unpkg.com debe estar accesible.");
})();

if (user) {
    renderSidebar("nav-inventory");

    if (!isRestricted) {
        document.getElementById("filter-warehouse").style.display = "";
    }

    // Acciones de escritura: solo ADMIN puede ajustar y hacer carga masiva
    // ADMIN y STOREKEEPER pueden registrar entradas y salidas
    // SUPERVISOR es de solo lectura
    if (canEdit) {
        document.getElementById("btn-bulk").style.display = "";
        document.getElementById("btn-adjust").style.display = "";
    } else {
        document.getElementById("btn-bulk").style.display = "none";
        document.getElementById("btn-adjust").style.display = "none";
    }
    if (canEntryExit) {
        document.getElementById("btn-entry").style.display = "";
        document.getElementById("btn-exit").style.display = "";
    } else {
        document.getElementById("btn-entry").style.display = "none";
        document.getElementById("btn-exit").style.display = "none";
    }

    loadAll();
}

/* ══════════════════════════════════════
   INVENTARIO PRINCIPAL
══════════════════════════════════════ */
function renderPagination() {

    const totalPages =
        Math.ceil(totalRecords / pageSize);

    const container =
        document.getElementById("pagination");

    if (totalPages <= 1) {
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        
            <button
            class="btn btn-secondary"
            ${currentPage === 1 ? "disabled" : ""}
            onclick="loadInventory(${currentPage - 1})">
            ← Anterior
            </button>

            <span>
            Página ${currentPage} de ${totalPages}
            </span>

            <button
            class="btn btn-secondary"
            ${currentPage === totalPages ? "disabled" : ""}
            onclick="loadInventory(${currentPage + 1})">
            Siguiente →
            </button>

        `;
}

async function loadAll() {
    // loadFormSelects primero: refresca allowedWarehouseIds desde user_warehouses (para SUPERVISOR/STOREKEEPER)
    // loadInventory después: usa los IDs ya actualizados para filtrar correctamente
    if (Auth.isAdmin()) {
        // ADMIN: pueden correr en paralelo sin restricción de almacenes
        await Promise.all([loadInventory(), loadFormSelects()]);
    } else {
        await loadFormSelects();
        await loadInventory();
    }
}


async function loadInventory(page = 1) {

    const tbody = document.getElementById("inventory-body");
    tbody.innerHTML = loadingRow(8);

    currentPage = page;

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const q = document.getElementById("search-input").value.trim();
    const st = document.getElementById("filter-status").value;
    const wh = document.getElementById("filter-warehouse").value;

    let query = db
        .from("inventory")
        .select(`
                    id,
                    stock,
                    reserved_stock,
                    stock_status,
                    last_movement_at,
                    products!inner (
                        id,
                        code,
                        name,
                        minimum_stock,
                        unit,
                        categories(name)
                    ),
                    warehouses (
                        id,
                        name
                    )
                `, { count: "exact" })

    // RESTRICCIÓN ALMACENES
    if (isRestricted) {

        if (allowedWarehouseIds.length === 0) {

            tbody.innerHTML = emptyRow(
                8,
                "No tienes almacenes asignados"
            );

            return;
        }

        query = query.in(
            "warehouse_id",
            allowedWarehouseIds
        );
    }

    // BUSCADOR
    if (q) {
        query = query.ilike("products.name", `%${q}%`);
        console.log(q);
    }

    // STATUS
    if (st) {
        query = query.eq("stock_status", st);
    }

    // ALMACÉN
    if (wh) {
        query = query.eq("warehouse_id", wh);
    }

    const { data, error, count } = await query
        .range(from, to)
        .order("last_movement_at", {
            ascending: false
        });

    if (error) {

        console.error(error);

        tbody.innerHTML = emptyRow(
            8,
            error.message
        );

        return;
    }

    totalRecords = count || 0;

    renderTable(data || []);

    renderPagination();
}

function renderTable(data) {
    const tbody = document.getElementById("inventory-body");
    document.getElementById("record-count").textContent = `${data.length} registro(s)`;
    if (!data.length) { tbody.innerHTML = emptyRow(8, "Sin registros de inventario"); return; }

    tbody.innerHTML = data.map(r => `
      <tr>
        <td class="code-cell">${r.products?.code || "—"}</td>
        <td><span class="fw-600">${r.products?.name || "—"}</span></td>
        <td class="text-muted">${r.products?.categories?.name || "—"}</td>
        <td class="text-muted">${r.warehouses?.name || "—"}</td>
        <td class="text-mono fw-600" style="font-size:1rem;">
          ${r.stock} <span class="text-muted" style="font-size:0.72rem;">${r.products?.unit || ""}</span>
        </td>
        <td class="text-muted">${r.products?.minimum_stock ?? 0}</td>
        <td>${stockBadge(r.stock_status)}</td>
        <td class="text-muted">${fmt.datetime(r.last_movement_at)}</td>
      </tr>
    `).join("");
}

let searchTimeout;

document.getElementById("search-input")
    .addEventListener("input", () => {

        clearTimeout(searchTimeout);

        searchTimeout = setTimeout(() => {
            loadInventory(1);
        }, 400);

    });
document.getElementById("filter-status").addEventListener("change", applyFilters);
document.getElementById("filter-warehouse").addEventListener("change", applyFilters);

function applyFilters() {
    loadInventory(1);
}

async function loadFormSelects() {
    // Para SUPERVISOR y STOREKEEPER: consultar user_warehouses directamente en la DB
    // para obtener siempre los almacenes actualizados (no depender solo de sessionStorage)
    if (!Auth.isAdmin() && !Auth.isCoordinador()) {
        const { data: uwRows, error: uwError } = await db
            .from("user_warehouses")
            .select("warehouse_id")
            .eq("user_id", user.id);

        if (!uwError && uwRows && uwRows.length > 0) {
            const freshIds = uwRows.map(r => r.warehouse_id);
            // Actualizar allowedWarehouseIds con datos frescos de la DB
            allowedWarehouseIds = freshIds;
            // Sincronizar también en el objeto de sesión
            user.allowed_warehouses = freshIds;
            sessionStorage.setItem("hs_user", JSON.stringify(user));
        } else if (!uwError) {
            // Sin filas en user_warehouses: sin almacenes asignados
            allowedWarehouseIds = [];
            user.allowed_warehouses = [];
            sessionStorage.setItem("hs_user", JSON.stringify(user));
        }
    }

    let whQuery = db.from("warehouses").select("id, name, code").eq("is_active", true);
    if (!Auth.isAdmin() && !Auth.isCoordinador() && allowedWarehouseIds !== null) {
        if (allowedWarehouseIds.length > 0) {
            whQuery = whQuery.in("id", allowedWarehouseIds);
        } else {
            // Sin almacenes asignados: devolver lista vacía sin consulta extra
            whQuery = whQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
        }
    }

    const [
        { data: warehouses },
        { data: products },
        { data: suppliers },
        { data: projects }
    ] = await Promise.all([
        whQuery,
        db.from("products").select("id, name, code, unit, minimum_stock").eq("is_active", true).order("name"),
        db.from("suppliers").select("id, company_name").order("company_name"),
        db.from("projects").select("id, name, code").eq("is_active", true).order("name"),
    ]);

    // Construir catálogos en memoria para validación de carga masiva
    catalogProductsArray = products || [];
    catalogWarehousesArray = warehouses || [];
    catalogProjectsArray = projects || [];
    (products || []).forEach(p => {
        if (p && p.code) catalogProducts[p.code.toString().trim().toUpperCase()] = p;
    });
    (warehouses || []).forEach(w => {
        if (w && w.code) catalogWarehouses[w.code.toString().trim().toUpperCase()] = w;
    });

    // Options for warehouse filter dropdown
    const filterWh = document.getElementById("filter-warehouse");
    if (filterWh) {
        let filterWhHtml = "";
        if (isRestricted) {
            if ((warehouses || []).length > 1) {
                filterWhHtml = '<option value="">Todos mis almacenes asignados</option>';
            } else if ((warehouses || []).length === 0) {
                filterWhHtml = '<option value="">Sin almacenes asignados</option>';
            }
        } else {
            filterWhHtml = '<option value="">Todos los almacenes</option>';
        }
        (warehouses || []).forEach(w => {
            filterWhHtml += `<option value="${w.id}">${w.name}</option>`;
        });
        filterWh.innerHTML = filterWhHtml;
    }

    const entryWh = document.getElementById("entry-warehouse");
    const exitWh = document.getElementById("exit-warehouse");

    let whOptionsHtml = "";
    (warehouses || []).forEach(w => {
        whOptionsHtml += `<option value="${w.id}">${w.name}</option>`;
    });
    entryWh.innerHTML = whOptionsHtml;
    exitWh.innerHTML = whOptionsHtml;

    if (isRestricted && (warehouses || []).length === 1) {
        entryWh.disabled = true;
        exitWh.disabled = true;
    }

    const entryProd = document.getElementById("entry-product");
    const exitProd = document.getElementById("exit-product");

    let prodOptionsHtml = "";
    (products || []).forEach(p => {
        prodOptionsHtml += `<option value="${p.id}">${p.name} (${p.code})</option>`;
    });
    entryProd.innerHTML = prodOptionsHtml;
    exitProd.innerHTML = prodOptionsHtml;

    let supplierOptionsHtml = '<option value="">Sin proveedor</option>';
    (suppliers || []).forEach(s => {
        supplierOptionsHtml += `<option value="${s.id}">${s.company_name}</option>`;
    });
    document.getElementById("entry-supplier").innerHTML = supplierOptionsHtml;

    let projectOptionsHtml = '<option value="">Sin tipo de salida</option>';
    (projects || []).forEach(p => {
        projectOptionsHtml += `<option value="${p.id}">${p.name} (${p.code})</option>`;
    });
    document.getElementById("exit-project").innerHTML = projectOptionsHtml;
    updateExitDestinationField();
}



/* ── Filtrado Dinámico de Productos por Código o Nombre ── */
function filterProductsSelect(selectId, searchTerm) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    const term = (searchTerm || "").trim().toLowerCase();

    let filtered = catalogProductsArray;
    if (term) {
        filtered = catalogProductsArray.filter(p =>
            (p.name && p.name.toLowerCase().includes(term)) ||
            (p.code && p.code.toLowerCase().includes(term))
        );
    }

    let html = "";
    filtered.forEach(p => {
        html += `<option value="${p.id}">${p.name} (${p.code})</option>`;
    });

    if (filtered.length === 0) {
        html = '<option value="">No se encontraron resultados</option>';
    }

    selectEl.innerHTML = html;
}

/* ── Contador de Folios (atómico, generado en la base de datos) ── */
// Usa la función get_next_folio(p_tipo text) ya existente en Supabase.
// Antes usaba localStorage, que es local a cada navegador/dispositivo
// y por eso generaba folios repetidos entre usuarios distintos.
async function getNextFolio(type) {
    // type: 'ENT' para entradas, 'SAL' para salidas
    const { data, error } = await db.rpc("get_next_folio", { p_tipo: type });
    if (error) {
        console.error("[Folio Error]", error);
        throw new Error("No se pudo generar el folio: " + error.message);
    }
    return data;
}

/* ── Entrada Dinámica Multiproducto y PDF ── */
let entryItems = [];

window.openEntryModal = function () {
    entryItems = [];

    // Asegurar que botones de cerrar/cancelar estén habilitados
    const btnClose = document.getElementById("btn-entry-close");
    const btnCancel = document.getElementById("btn-entry-cancel");
    if (btnClose) btnClose.disabled = false;
    if (btnCancel) btnCancel.disabled = false;

    // Resetear búsqueda de producto
    const entrySearch = document.getElementById("entry-product-search");
    if (entrySearch) entrySearch.value = "";
    filterProductsSelect("entry-product", "");

    // Resetear todos los campos del formulario interno
    const entryProd = document.getElementById("entry-product");
    if (entryProd && entryProd.options.length > 0) entryProd.selectedIndex = 0;
    document.getElementById("entry-quantity").value = "";
    document.getElementById("entry-notes").value = "";

    // Resetear proveedor a la primera opción ("Sin proveedor")
    const entrySupplier = document.getElementById("entry-supplier");
    if (entrySupplier) entrySupplier.selectedIndex = 0;

    renderEntryItemsList();
    Modal.open("modal-entry");
};

document.getElementById("entry-product-search").addEventListener("input", (e) => {
    filterProductsSelect("entry-product", e.target.value);
});

function renderEntryItemsList() {
    const listContainer = document.getElementById("entry-items-list");
    if (!listContainer) return;

    if (entryItems.length === 0) {
        listContainer.innerHTML = `
                        <div style="text-align:center; padding:12px; font-size:0.78rem; color:var(--gray-light);">
                            No se han agregado insumos a la entrada.
                        </div>
                    `;
        return;
    }

    let html = `
                    <table style="width:100%; font-size:0.78rem; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid #efefef; text-align:left;">
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid);">Insumo</th>
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid); text-align:right; width:80px;">Cantidad</th>
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid); text-align:center; width:40px;"></th>
                            </tr>
                        </thead>
                        <tbody>
                `;

    entryItems.forEach((item, idx) => {
        html += `
                        <tr style="border-bottom:1px solid #f2f2f2;">
                            <td style="padding:6px 0;">
                                <span class="fw-600">${item.productName}</span><br/>
                                <span style="font-size:0.65rem; color:var(--gray-light); font-family:var(--font-mono);">${item.productCode}</span>
                            </td>
                            <td style="padding:6px 0; text-align:right; font-weight:600; font-family:var(--font-mono);">${item.quantity} ${item.productUnit || ''}</td>
                            <td style="padding:6px 0; text-align:center;">
                                <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red); padding:2px;" onclick="removeEntryItem(${idx})">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px; height:12px;">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </td>
                        </tr>
                    `;
    });

    html += `
                        </tbody>
                    </table>
                `;

    listContainer.innerHTML = html;
}

window.removeEntryItem = function (idx) {
    entryItems.splice(idx, 1);
    renderEntryItemsList();
};

// Evento para agregar insumo a la lista
document.getElementById("btn-add-entry-item").addEventListener("click", () => {
    const prodSelect = document.getElementById("entry-product");
    const qtyInput = document.getElementById("entry-quantity");

    const productId = prodSelect.value;
    const quantity = parseInt(qtyInput.value);

    if (!productId) {
        Toast.show("Selecciona un producto", "error");
        return;
    }
    if (isNaN(quantity) || quantity < 1) {
        Toast.show("Ingresa una cantidad mayor a 0", "error");
        return;
    }

    // Obtener datos reales del producto desde catalogProducts
    let productObj = null;
    for (let code in catalogProducts) {
        if (catalogProducts[code].id === productId) {
            productObj = catalogProducts[code];
            break;
        }
    }

    const optionText = prodSelect.options[prodSelect.selectedIndex].text;
    const productName = productObj ? productObj.name : optionText.replace(/\s\([^)]+\)$/, "");
    const productCode = productObj ? productObj.code : "";
    const productUnit = productObj ? productObj.unit : "";

    // Verificar si ya existe en la lista para sumarle
    const existing = entryItems.find(item => item.productId === productId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        entryItems.push({
            productId,
            productName,
            productCode,
            productUnit,
            quantity
        });
    }

    qtyInput.value = "";
    renderEntryItemsList();
});

// Función para generar PDF de Entrada
function generateEntryPDF(warehouseName, supplierName, notes, items, user, folio) {
    // Validar jsPDF
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error("La librería jsPDF no está disponible.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Validar AutoTable
    if (typeof doc.autoTable !== "function") {
        throw new Error("El plugin AutoTable no cargó correctamente.");
    }

    console.log("[PDF] jsPDF OK");
    console.log("[PDF] autoTable:", typeof doc.autoTable);

    const primaryColor = [245, 196, 0];
    const darkColor = [26, 26, 26];

    // HEADER
    doc.setFillColor(...darkColor);
    doc.rect(0, 0, 210, 36, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("HEAD STORE", 15, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("SISTEMA DE CONTROL DE INVENTARIOS - VALE DE ENTRADA", 15, 26);

    // FOLIO en esquina superior derecha del header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(245, 196, 0);
    doc.text("FOLIO:", 148, 14);
    doc.setFontSize(11);
    doc.text(folio || "—", 160, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFillColor(...primaryColor);
    doc.rect(15, 29, 180, 1.2, 'F');

    // TÍTULO
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("COMPROBANTE OFICIAL DE ENTRADA DE MATERIALES", 15, 48);

    // INFO GENERAL
    doc.setFontSize(9.5);

    let y = 58;

    // FOLIO como campo de información prominente
    doc.setFont("helvetica", "bold");
    doc.text("Folio:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(26, 26, 200);
    doc.text(folio || "—", 45, y);
    doc.setTextColor(...darkColor);

    doc.setFont("helvetica", "bold");
    doc.text("Almacén Destino:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(warehouseName || "-", 145, y);

    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text("Fecha y Hora:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleString("es-MX"), 45, y);

    y += 6;

    const roleLabels = {
        ADMIN: "Administrador",
        SUPERVISOR: "Supervisor",
        ALMACENISTA: "Almacenista",
        COORDINADOR: "Coordinador"
    };

    const roleLabel = roleLabels[user.role] || user.role;

    doc.setFont("helvetica", "bold");
    doc.text("Responsable:", 15, y);

    doc.setFont("helvetica", "normal");
    doc.text(`${user.full_name} - ${roleLabel}`, 45, y);

    doc.setFont("helvetica", "bold");
    doc.text("Proveedor:", 110, y);

    doc.setFont("helvetica", "normal");
    doc.text(supplierName || "Sin proveedor", 145, y);

    // NOTAS
    if (notes) {
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Observaciones:", 15, y);

        doc.setFont("helvetica", "normal");
        const splitNotes = doc.splitTextToSize(notes, 145);
        doc.text(splitNotes, 45, y);
        y += splitNotes.length * 4.5;
    }

    y += 10;

    // TABLA
    const tableHeaders = [[
        "Código",
        "Insumo / Descripción",
        "Unidad",
        "Cantidad"
    ]];

    const tableData = items.map(item => [
        item.productCode || "-",
        item.productName || "-",
        item.productUnit || "pza",
        String(item.quantity || 0)
    ]);

    doc.autoTable({
        startY: y,
        head: tableHeaders,
        body: tableData,
        headStyles: {
            fillColor: darkColor,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9
        },
        bodyStyles: {
            fontSize: 8.5
        },
        alternateRowStyles: {
            fillColor: [248, 248, 248]
        },
        columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 105 },
            2: { cellWidth: 25 },
            3: {
                cellWidth: 20,
                halign: 'right'
            }
        },
        margin: {
            left: 15,
            right: 15
        }
    });

    // POSICIÓN FINAL SEGURA
    let finalY = 150;
    if (doc.lastAutoTable && doc.lastAutoTable.finalY) {
        finalY = doc.lastAutoTable.finalY + 25;
    }

    // NUEVA PÁGINA SI ES NECESARIO
    if (finalY > 255) {
        doc.addPage();
        finalY = 40;
    }

    // FIRMAS
    doc.setDrawColor(200, 200, 200);
    doc.line(30, finalY, 90, finalY);
    doc.line(120, finalY, 180, finalY);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(
        "ENTREGÓ (PROVEEDOR)",
        60,
        finalY + 4,
        { align: "center" }
    );
    doc.text(
        "RECIBIÓ (ALMACÉN)",
        150,
        finalY + 4,
        { align: "center" }
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(
        supplierName || "Proveedor",
        60,
        finalY + 8,
        { align: "center" }
    );
    doc.text(
        user.full_name || "Almacén",
        150,
        finalY + 8,
        { align: "center" }
    );

    // GUARDAR PDF
    const dateStr = new Date().toISOString().slice(0, 10);
    const folioSlug = (folio || "SN").replace(/[^a-zA-Z0-9-_]/g, "-");
    doc.save(`vale_entrada_${folioSlug}_${dateStr}.pdf`);
}

function buildMovementNotes(baseNotes, folio, destinationName, fallbackText) {
    let text = "";

    if (folio) {
        text += `[Folio: ${folio}]`;
    }

    const cleanedBase = (baseNotes || "").trim();
    if (cleanedBase) {
        text += text ? ` ${cleanedBase}` : cleanedBase;
    } else if (!text) {
        text = fallbackText;
    }

    if (destinationName && destinationName.trim()) {
        text += text ? ` | Destino: ${destinationName.trim()}` : `Destino: ${destinationName.trim()}`;
    }

    return text;
}

// Guardar Entrada Multiproducto y descargar PDF
document.getElementById("btn-entry-save").addEventListener("click", async () => {
    const warehouseId = document.getElementById("entry-warehouse").value;
    const supplierId = document.getElementById("entry-supplier").value || null;
    const notes = document.getElementById("entry-notes").value || null;

    if (!warehouseId) {
        Toast.show("Selecciona el almacén de destino", "error");
        return;
    }
    if (entryItems.length === 0) {
        Toast.show("Debes agregar al menos un insumo a la entrada", "error");
        return;
    }
    if (isRestricted && !allowedWarehouseIds.includes(warehouseId)) {
        Toast.show("No tienes permiso para operar en este almacén", "error");
        return;
    }

    const btn = document.getElementById("btn-entry-save");
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Registrando...`;

    const btnClose = document.getElementById("btn-entry-close");
    const btnCancel = document.getElementById("btn-entry-cancel");
    if (btnClose) btnClose.disabled = true;
    if (btnCancel) btnCancel.disabled = true;

    try {
        // Generar folio ANTES de guardar para incluirlo en las notas
        const entryFolio = await getNextFolio("ENT");
        const warehouseName = document.getElementById("entry-warehouse")?.selectedOptions?.[0]?.text || "Sin almacén";
        const notesWithDestination = buildMovementNotes(notes, entryFolio, warehouseName, "Entrada múltiple registrada");

        // Procesar cada ingreso uno por uno
        for (const item of entryItems) {
            const { error } = await db.rpc("register_inventory_entry", {
                p_warehouse_id: warehouseId,
                p_product_id: item.productId,
                p_supplier_id: supplierId,
                p_quantity: item.quantity,
                p_user_id: user.id,
                p_notes: notesWithDestination,
            });
            if (error) throw error;
        }

        Toast.show("Entrada registrada correctamente", "success");

        // Generar y descargar el PDF
        const whSelect = document.getElementById("entry-warehouse");
        const entryWarehouseName = whSelect.options[whSelect.selectedIndex].text;

        const suppSelect = document.getElementById("entry-supplier");
        const supplierName = supplierId
            ? suppSelect.options[suppSelect.selectedIndex].text
            : "Sin proveedor";

        try {
            generateEntryPDF(entryWarehouseName, supplierName, notesWithDestination, entryItems, user, entryFolio);
        } catch (pdfErr) {
            console.error("[PDF Error]", pdfErr);
            Toast.show("Entrada registrada. Error al generar PDF: " + pdfErr.message, "info");
        }

        btn.disabled = false;
        Modal.close("modal-entry");
        loadInventory();
    } catch (err) {
        console.error("Error al registrar entrada:", err);
        Toast.show(err.message || "Error al registrar la entrada", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/></svg> Registrar Entrada y Descargar PDF`;
        if (btnClose) btnClose.disabled = false;
        if (btnCancel) btnCancel.disabled = false;
    }
});

/* ── Salida Dinámica Multiproducto y PDF ── */
let exitItems = [];

function isExitFromEmpacadora() {
    const whSelect = document.getElementById("exit-warehouse");
    const selectedText = whSelect?.selectedOptions?.[0]?.text?.trim().toLowerCase() || "";
    return selectedText.includes("empacadora");
}

function updateExitDestinationField() {
    const select = document.getElementById("exit-project");
    const label = document.getElementById("exit-destination-label");
    if (!select || !label) return;

    const isEmpacadora = isExitFromEmpacadora();
    label.textContent = isEmpacadora ? "Almacén Destino *" : "Tipo Salida / Obra *";

    if (isEmpacadora) {
        let html = '<option value="">Sin almacén destino</option>';
        catalogWarehousesArray.forEach(w => {
            if (w && w.id) {
                html += `<option value="${w.id}">${w.name}</option>`;
            }
        });
        select.innerHTML = html;
    } else {
        let html = '<option value="">Sin tipo de salida</option>';
        catalogProjectsArray.forEach(p => {
            if (p && p.id) {
                html += `<option value="${p.id}">${p.name} (${p.code})</option>`;
            }
        });
        select.innerHTML = html;
    }
}

window.openExitModal = function () {
    exitItems = [];

    // Asegurar que botones de cerrar/cancelar estén habilitados
    const btnClose = document.getElementById("btn-exit-close");
    const btnCancel = document.getElementById("btn-exit-cancel");
    if (btnClose) btnClose.disabled = false;
    if (btnCancel) btnCancel.disabled = false;

    // Resetear búsqueda de producto
    const exitSearch = document.getElementById("exit-product-search");
    if (exitSearch) exitSearch.value = "";
    filterProductsSelect("exit-product", "");

    // Resetear todos los campos del formulario interno
    const exitProd = document.getElementById("exit-product");
    if (exitProd && exitProd.options.length > 0) exitProd.selectedIndex = 0;
    document.getElementById("exit-quantity").value = "";
    document.getElementById("exit-notes").value = "";
    updateExitDestinationField();
    renderExitItemsList();
    Modal.open("modal-exit");
};

document.getElementById("exit-product-search").addEventListener("input", (e) => {
    filterProductsSelect("exit-product", e.target.value);
    // Resetear stock info al filtrar
    updateExitStockInfo();
});

/* ── Muestra stock actual al seleccionar producto/almacén en salida ── */
async function updateExitStockInfo() {
    const stockInfo = document.getElementById("exit-stock-info");
    const exitProd = document.getElementById("exit-product");
    const exitWh = document.getElementById("exit-warehouse");
    const qtyInput = document.getElementById("exit-quantity");

    const productId = exitProd ? exitProd.value : null;
    const warehouseId = exitWh ? exitWh.value : null;

    if (!productId || !warehouseId) {
        if (stockInfo) stockInfo.style.display = "none";
        if (qtyInput) { qtyInput.removeAttribute("max"); }
        return;
    }

    try {
        const { data, error } = await db
            .from("inventory")
            .select("stock")
            .eq("product_id", productId)
            .eq("warehouse_id", warehouseId)
            .single();

        if (error || !data) {
            stockInfo.style.display = "block";
            stockInfo.style.background = "#fff3cd";
            stockInfo.style.color = "#856404";
            stockInfo.style.border = "1px solid #ffc107";
            stockInfo.textContent = "⚠ Sin registro de stock en este almacén";
            if (qtyInput) qtyInput.removeAttribute("max");
            return;
        }

        const stock = data.stock || 0;
        stockInfo.style.display = "block";
        if (qtyInput) qtyInput.setAttribute("max", stock);

        if (stock === 0) {
            stockInfo.style.background = "rgba(224,53,53,.12)";
            stockInfo.style.color = "#b52525";
            stockInfo.style.border = "1px solid rgba(224,53,53,.3)";
            stockInfo.textContent = "🚫 Stock actual: 0 — Sin disponibilidad";
        } else if (stock <= 5) {
            stockInfo.style.background = "rgba(230,126,34,.12)";
            stockInfo.style.color = "#c0620a";
            stockInfo.style.border = "1px solid rgba(230,126,34,.3)";
            stockInfo.textContent = `⚠ Stock actual: ${stock} (stock bajo)`;
        } else {
            stockInfo.style.background = "rgba(39,174,96,.12)";
            stockInfo.style.color = "#1a8a4a";
            stockInfo.style.border = "1px solid rgba(39,174,96,.3)";
            stockInfo.textContent = `✓ Stock actual: ${stock} — Máx. a pedir`;
        }
    } catch (e) {
        console.error("Error consultando stock:", e);
    }
}

document.getElementById("exit-product").addEventListener("change", () => updateExitStockInfo());
document.getElementById("exit-warehouse").addEventListener("change", () => {
    updateExitStockInfo();
    updateExitDestinationField();
});

function renderExitItemsList() {
    const listContainer = document.getElementById("exit-items-list");
    if (!listContainer) return;

    if (exitItems.length === 0) {
        listContainer.innerHTML = `
                        <div style="text-align:center; padding:12px; font-size:0.78rem; color:var(--gray-light);">
                            No se han agregado insumos a la salida.
                        </div>
                    `;
        return;
    }

    let html = `
                    <table style="width:100%; font-size:0.78rem; border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid #efefef; text-align:left;">
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid);">Insumo</th>
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid); text-align:right; width:80px;">Cantidad</th>
                                <th style="padding:4px 0; font-weight:600; color:var(--gray-mid); text-align:center; width:40px;"></th>
                            </tr>
                        </thead>
                        <tbody>
                `;

    exitItems.forEach((item, idx) => {
        html += `
                        <tr style="border-bottom:1px solid #f2f2f2;">
                            <td style="padding:6px 0;">
                                <span class="fw-600">${item.productName}</span><br/>
                                <span style="font-size:0.65rem; color:var(--gray-light); font-family:var(--font-mono);">${item.productCode}</span>
                            </td>
                            <td style="padding:6px 0; text-align:right; font-weight:600; font-family:var(--font-mono);">${item.quantity} ${item.productUnit || ''}</td>
                            <td style="padding:6px 0; text-align:center;">
                                <button type="button" class="btn btn-ghost btn-sm" style="color:var(--red); padding:2px;" onclick="removeExitItem(${idx})">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px; height:12px;">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </td>
                        </tr>
                    `;
    });

    html += `
                        </tbody>
                    </table>
                `;

    listContainer.innerHTML = html;
}

window.removeExitItem = function (idx) {
    exitItems.splice(idx, 1);
    renderExitItemsList();
};

// Evento para agregar insumo a la lista
document.getElementById("btn-add-exit-item").addEventListener("click", () => {
    const prodSelect = document.getElementById("exit-product");
    const qtyInput = document.getElementById("exit-quantity");

    const productId = prodSelect.value;
    const quantity = parseInt(qtyInput.value);

    if (!productId) {
        Toast.show("Selecciona un producto", "error");
        return;
    }
    if (isNaN(quantity) || quantity < 1) {
        Toast.show("Ingresa una cantidad mayor a 0", "error");
        return;
    }

    // Validar contra stock disponible
    const stockInfoEl = document.getElementById("exit-stock-info");
    const maxAttr = qtyInput.getAttribute("max");
    if (maxAttr !== null) {
        const maxStock = parseInt(maxAttr);
        // Calcular total ya agregado de este producto en la lista
        const alreadyAdded = exitItems
            .filter(item => item.productId === productId)
            .reduce((sum, item) => sum + item.quantity, 0);
        if (quantity + alreadyAdded > maxStock) {
            Toast.show(`Stock insuficiente. Disponible: ${maxStock - alreadyAdded}`, "error");
            return;
        }
    }

    // Obtener datos reales del producto desde catalogProducts
    let productObj = null;
    for (let code in catalogProducts) {
        if (catalogProducts[code].id === productId) {
            productObj = catalogProducts[code];
            break;
        }
    }

    const optionText = prodSelect.options[prodSelect.selectedIndex].text;
    const productName = productObj ? productObj.name : optionText.replace(/\s\([^)]+\)$/, "");
    const productCode = productObj ? productObj.code : "";
    const productUnit = productObj ? productObj.unit : "";

    // Verificar si ya existe en la lista para sumarle
    const existing = exitItems.find(item => item.productId === productId);
    if (existing) {
        existing.quantity += quantity;
    } else {
        exitItems.push({
            productId,
            productName,
            productCode,
            productUnit,
            quantity
        });
    }

    qtyInput.value = "";
    renderExitItemsList();
});

// Función para generar PDF de Salida
function generateExitPDF(warehouseName, projectName, notes, items, user, folio) {

    // Validar jsPDF
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error("La librería jsPDF no está disponible.");
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Validar AutoTable
    if (typeof doc.autoTable !== "function") {
        throw new Error("El plugin AutoTable no cargó correctamente.");
    }

    console.log("[PDF] jsPDF OK");
    console.log("[PDF] autoTable:", typeof doc.autoTable);

    const primaryColor = [245, 196, 0];
    const darkColor = [26, 26, 26];

    // HEADER
    doc.setFillColor(...darkColor);
    doc.rect(0, 0, 210, 36, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("HEAD STORE", 15, 18);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("SISTEMA DE CONTROL DE INVENTARIOS - VALE DE SALIDA", 15, 26);

    // FOLIO en esquina superior derecha del header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(245, 196, 0);
    doc.text("FOLIO:", 148, 14);
    doc.setFontSize(11);
    doc.text(folio || "—", 160, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFillColor(...primaryColor);
    doc.rect(15, 29, 180, 1.2, 'F');

    // TÍTULO
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("COMPROBANTE OFICIAL DE SALIDA DE MATERIALES", 15, 48);

    // INFO GENERAL
    doc.setFontSize(9.5);

    let y = 58;

    // FOLIO como campo de información prominente
    doc.setFont("helvetica", "bold");
    doc.text("Folio:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(26, 26, 200);
    doc.text(folio || "—", 45, y);
    doc.setTextColor(...darkColor);

    doc.setFont("helvetica", "bold");
    doc.text("Almacén Origen:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(warehouseName || "-", 145, y);

    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text("Fecha y Hora:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(new Date().toLocaleString("es-MX"), 45, y);

    y += 6;

    const roleLabels = {
        ADMIN: "Administrador",
        SUPERVISOR: "Supervisor",
        ALMACENISTA: "Almacenista",
        COORDINADOR: "Coordinador"
    };

    const roleLabel = roleLabels[user.role] || user.role;

    doc.setFont("helvetica", "bold");
    doc.text("Responsable:", 15, y);

    doc.setFont("helvetica", "normal");
    doc.text(`${user.full_name} - ${roleLabel}`, 45, y);

    doc.setFont("helvetica", "bold");
    doc.text("Destino / Obra:", 110, y);

    doc.setFont("helvetica", "normal");
    doc.text(projectName || "Sin tipo de salida", 145, y);

    // NOTAS
    if (notes) {

        y += 6;

        doc.setFont("helvetica", "bold");
        doc.text("Observaciones:", 15, y);

        doc.setFont("helvetica", "normal");

        const splitNotes = doc.splitTextToSize(notes, 145);

        doc.text(splitNotes, 45, y);

        y += splitNotes.length * 4.5;
    }

    y += 10;

    // TABLA
    const tableHeaders = [[
        "Código",
        "Insumo / Descripción",
        "Unidad",
        "Cantidad"
    ]];

    const tableData = items.map(item => [
        item.productCode || "-",
        item.productName || "-",
        item.productUnit || "pza",
        String(item.quantity || 0)
    ]);

    // VALIDACIÓN extra
    if (typeof doc.autoTable !== "function") {
        throw new Error("autoTable no está disponible");
    }

    doc.autoTable({
        startY: y,

        head: tableHeaders,

        body: tableData,

        headStyles: {
            fillColor: darkColor,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9
        },

        bodyStyles: {
            fontSize: 8.5
        },

        alternateRowStyles: {
            fillColor: [248, 248, 248]
        },

        columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 105 },
            2: { cellWidth: 25 },
            3: {
                cellWidth: 20,
                halign: 'right'
            }
        },

        margin: {
            left: 15,
            right: 15
        }
    });

    // POSICIÓN FINAL SEGURA
    let finalY = 150;

    if (
        doc.lastAutoTable &&
        doc.lastAutoTable.finalY
    ) {
        finalY = doc.lastAutoTable.finalY + 25;
    }

    // NUEVA PÁGINA SI ES NECESARIO
    if (finalY > 255) {
        doc.addPage();
        finalY = 40;
    }

    // FIRMAS
    doc.setDrawColor(200, 200, 200);

    doc.line(30, finalY, 90, finalY);
    doc.line(120, finalY, 180, finalY);

    doc.setFontSize(8.5);

    doc.setFont("helvetica", "bold");

    doc.text(
        "ENTREGÓ (ALMACÉN)",
        60,
        finalY + 4,
        { align: "center" }
    );

    doc.text(
        "RECIBIÓ (OBRA)",
        150,
        finalY + 4,
        { align: "center" }
    );

    doc.setFont("helvetica", "normal");

    doc.setFontSize(8);

    doc.text(
        user.full_name || "Almacén",
        60,
        finalY + 8,
        { align: "center" }
    );

    doc.text(
        projectName || "Responsable de Obra",
        150,
        finalY + 8,
        { align: "center" }
    );

    // GUARDAR PDF
    const dateStr = new Date().toISOString().slice(0, 10);
    const folioSlug = (folio || "SN").replace(/[^a-zA-Z0-9-_]/g, "-");
    doc.save(`vale_salida_${folioSlug}_${dateStr}.pdf`);
}

// Guardar Salida Multiproducto y descargar PDF
document.getElementById("btn-exit-save").addEventListener("click", async () => {
    const warehouseId = document.getElementById("exit-warehouse").value;
    const destinationSelect = document.getElementById("exit-project");
    const isEmpacadoraExit = isExitFromEmpacadora();
    const projectId = isEmpacadoraExit ? null : (destinationSelect.value || null);
    const notes = document.getElementById("exit-notes").value || null;

    if (!warehouseId) {
        Toast.show("Selecciona el almacén de origen", "error");
        return;
    }
    if (exitItems.length === 0) {
        Toast.show("Debes agregar al menos un insumo a la salida", "error");
        return;
    }
    if (isRestricted && !allowedWarehouseIds.includes(warehouseId)) {
        Toast.show("No tienes permiso para operar en este almacén", "error");
        return;
    }

    const btn = document.getElementById("btn-exit-save");
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Registrando...`;

    const btnClose = document.getElementById("btn-exit-close");
    const btnCancel = document.getElementById("btn-exit-cancel");
    if (btnClose) btnClose.disabled = true;
    if (btnCancel) btnCancel.disabled = true;

    try {
        // Generar folio ANTES de guardar para incluirlo en las notas
        const exitFolio = await getNextFolio("SAL");
        const destinationLabel = destinationSelect?.selectedOptions?.[0]?.text || "Sin destino";
        const notesWithDestination = buildMovementNotes(notes, exitFolio, destinationLabel, "Salida múltiple registrada");

        // Procesar cada egreso uno por uno
        for (const item of exitItems) {
            const { error } = await db.rpc("register_inventory_exit", {
                p_warehouse_id: warehouseId,
                p_product_id: item.productId,
                p_project_id: projectId,
                p_quantity: item.quantity,
                p_user_id: user.id,
                p_notes: notesWithDestination,
            });
            if (error) throw error;
        }

        Toast.show("Salida registrada correctamente", "success");

        // Generar y descargar el PDF
        const whSelect = document.getElementById("exit-warehouse");
        const warehouseName = whSelect.options[whSelect.selectedIndex].text;

        const projSelect = document.getElementById("exit-project");
        const projectName = projSelect?.selectedOptions?.[0]?.text || "Sin tipo de salida";

        try {
            generateExitPDF(warehouseName, projectName, notesWithDestination, exitItems, user, exitFolio);
        } catch (pdfErr) {
            console.error("[PDF Error]", pdfErr);
            Toast.show("Salida registrada. Error al generar PDF: " + pdfErr.message, "info");
        }

        btn.disabled = false;
        Modal.close("modal-exit");
        loadInventory();
    } catch (err) {
        console.error("Error al registrar salida:", err);
        Toast.show(err.message || "Error al registrar la salida", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/></svg> Registrar Salida y Descargar PDF`;
        if (btnClose) btnClose.disabled = false;
        if (btnCancel) btnCancel.disabled = false;
    }
});

/* ══════════════════════════════════════
   CARGA MASIVA — MÓDULO COMPLETO
══════════════════════════════════════ */
let bulkStep = 1;
let bulkRows = [];  // filas parseadas y validadas
let bulkValid = [];  // solo filas sin error crítico

// Códigos de ejemplo a ignorar
const EXAMPLE_CODES = new Set(["PROD-001", "PROD-002", "PROD-003", "PROD-004", "PROD-005"]);

function openBulk() {
    if (Auth.isAlmacenista()) { Toast.show("Sin permiso", "error"); return; }
    resetBulk();
    Modal.open("modal-bulk");
}

function closeBulk() {
    Modal.close("modal-bulk");
    setTimeout(resetBulk, 300);
}

function resetBulk() {
    bulkStep = 1; bulkRows = []; bulkValid = [];
    goStep(1);
    document.getElementById("bulk-file-input").value = "";
    document.getElementById("preview-body").innerHTML = "";
    document.getElementById("bulk-summary").innerHTML = "";
    document.getElementById("result-log").innerHTML = "";
    document.getElementById("bulk-progress").style.width = "0%";
    document.getElementById("btn-bulk-action").disabled = true;
    document.getElementById("btn-bulk-action").textContent = "Procesar archivo";
}

function goStep(n) {
    bulkStep = n;
    for (let i = 1; i <= 3; i++) {
        const tab = document.getElementById(`step-tab-${i}`);
        const pane = document.getElementById(`bulk-step-${i}`);
        tab.className = "step" + (i < n ? " done" : i === n ? " active" : "");
        if (pane) pane.style.display = i === n ? "" : "none";
        // update step number icon for done steps
        const numEl = tab.querySelector(".step-num");
        if (i < n) numEl.textContent = "✓";
        else numEl.textContent = i;
    }
}

/* ── Drag & Drop ── */
const uploadZone = document.getElementById("upload-zone");
uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", e => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
});

document.getElementById("bulk-file-input").addEventListener("change", e => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
});

/* ── Leer y validar Excel ── */
function handleFile(file) {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
        Toast.show("Archivo no válido. Usa .xlsx o .xls", "error"); return;
    }

    const reader = new FileReader();
    reader.onload = e => {
        try {
            const wb = XLSX.read(e.target.result, { type: "array" });
            // Buscar hoja "INVENTARIO" primero, si no la primera
            const sheetName = wb.SheetNames.includes("INVENTARIO")
                ? "INVENTARIO"
                : wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });

            if (!raw.length) {
                Toast.show("El archivo está vacío o no tiene datos", "error"); return;
            }

            validateAndPreview(raw);
        } catch (err) {
            Toast.show("Error leyendo el archivo Excel: " + err.message, "error");
        }
    };
    reader.readAsArrayBuffer(file);
}

function normalizeHeader(key) {
    if (!key) return "";
    return key.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // eliminar acentos/diacríticos
        .replace(/\*/g, "")              // eliminar asteriscos
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");     // mantener solo alfanuméricos y guiones bajos
}

async function searchProducts(q) {
    const { data } = await db
        .from("products")
        .select("id, name, code")
        .ilike("name", `%${q}%`)
        .limit(20);
    renderResults(data);
}

function validateAndPreview(raw) {
    bulkRows = [];
    bulkValid = [];

    // Normalizar claves de cabecera (elimina acentos, *, espacios, mayúsculas)
    const normalized = raw.map(row => {
        const n = {};
        Object.keys(row).forEach(k => { n[normalizeHeader(k)] = row[k]; });
        return n;
    });

    // Validar presencia de columnas requeridas en el set de todas las claves encontradas en el archivo
    const allKeys = new Set();
    normalized.forEach(row => {
        Object.keys(row).forEach(k => allKeys.add(k));
    });

    const requiredCols = ["codigo_producto", "stock_inicial", "almacen_codigo"];
    const missingCols = requiredCols.filter(c => !allKeys.has(c));
    if (missingCols.length) {
        Toast.show(`Faltan columnas obligatorias: ${missingCols.join(", ")}`, "error"); return;
    }

    let countOk = 0, countErr = 0, countWarn = 0;

    normalized.forEach((row, idx) => {
        const code = String(row.codigo_producto || "").trim().toUpperCase();
        const whCode = String(row.almacen_codigo || "").trim().toUpperCase();
        const stock = parseInt(row.stock_inicial) || 0;
        const minStk = parseInt(row.stock_minimo) || 0;
        const notas = String(row.notas || "").trim();

        // Ignorar filas vacías
        if (!code && !whCode) return;

        // Ignorar filas de ejemplo
        if (EXAMPLE_CODES.has(code)) return;

        // Ignorar filas de instrucciones / advertencias del template
        if (code.includes("INGRESA") || code.includes("DATOS") || code.startsWith("↓") || code.startsWith("↑")) return;

        const errors = [];
        const warnings = [];

        // Validar producto
        const product = catalogProducts[code];
        if (!product) errors.push(`Producto "${code}" no existe en el catálogo`);

        // Validar almacén
        const warehouse = catalogWarehouses[whCode];
        if (!warehouse) errors.push(`Almacén "${whCode}" no existe`);

        // Validar stock
        if (stock <= -1) errors.push("DEBE SER UN VALOR POSITIVO ");

        // Restricción STOREKEEPER (doble check)
        if (warehouse && isRestricted && !allowedWarehouseIds.includes(warehouse.id)) {
            errors.push(`Sin permiso para el almacén "${whCode}"`);
        }

        // Advertencia stock mínimo
        if (minStk < 0) warnings.push("stock_minimo negativo, se usará 0");

        const status = errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok";
        if (status === "ok") countOk++;
        if (status === "error") countErr++;
        if (status === "warn") { countOk++; countWarn++; }

        const entry = {
            _idx: idx + 2, // fila Excel (1-indexed + encabezado)
            code, whCode, stock,
            minStk: Math.max(0, minStk),
            notas,
            productId: product?.id || null,
            warehouseId: warehouse?.id || null,
            productName: product?.name || row.nombre_producto || "—",
            warehouseName: warehouse?.name || "—",
            errors, warnings, status,
        };

        bulkRows.push(entry);
        if (status !== "error") bulkValid.push(entry);
    });

    if (!bulkRows.length) {
        Toast.show("No se encontraron filas de datos válidas (revisa que no sean solo filas de ejemplo)", "error");
        return;
    }

    // Renderizar resumen
    document.getElementById("bulk-summary").innerHTML = `
      <span class="chip chip-total">Total: ${bulkRows.length}</span>
      <span class="chip chip-ok">✓ Válidas: ${countOk}</span>
      ${countErr ? `<span class="chip chip-error">✗ Errores: ${countErr}</span>` : ""}
      ${countWarn ? `<span class="chip chip-warn">⚠ Advertencias: ${countWarn}</span>` : ""}
    `;

    // Renderizar tabla de vista previa
    document.getElementById("preview-body").innerHTML = bulkRows.map(r => {
        const rowClass = r.status === "error" ? "row-error" : r.status === "warn" ? "row-warn" : "row-ok";
        const statusCell = r.status === "error"
            ? `<span class="badge badge-out">✗ Error</span>`
            : r.status === "warn"
                ? `<span class="badge badge-low">⚠ Advertencia</span>`
                : `<span class="badge badge-normal">✓ Válida</span>`;

        const errText = [...r.errors, ...r.warnings].join(" · ");
        return `
        <tr class="${rowClass}" title="${errText}">
          <td class="text-muted text-mono">${r._idx}</td>
          <td class="${r.errors.some(e => e.includes("Producto")) ? "cell-error" : ""}">
            ${r.code}<br/><span style="font-size:0.72rem; color:var(--gray-light);">${r.productName}</span>
          </td>
          <td class="text-muted" style="font-size:0.78rem; max-width:120px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.productName}</td>
          <td class="${r.errors.some(e => e.includes("Almacén")) ? "cell-error" : "text-muted"}">
            ${r.whCode}<br/><span style="font-size:0.72rem; color:var(--gray-light);">${r.warehouseName}</span>
          </td>
          <td class="text-mono fw-600 ${r.errors.some(e => e.includes("stock_inicial")) ? "cell-error" : ""}">${r.stock}</td>
          <td class="text-muted text-mono">${r.minStk}</td>
          <td class="text-muted" style="max-width:100px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.notas || "—"}</td>
          <td>${statusCell}${errText ? `<br/><span style="font-size:0.65rem; color:var(--red);">${errText}</span>` : ""}</td>
        </tr>
      `;
    }).join("");

    goStep(2);
    const btn = document.getElementById("btn-bulk-action");
    if (bulkValid.length > 0) {
        btn.disabled = false;
        btn.textContent = `Cargar ${bulkValid.length} fila(s) válida(s)`;
    } else {
        btn.disabled = true;
        btn.textContent = "Sin filas válidas para cargar";
    }
}

/* ── Ejecutar carga ── */
document.getElementById("btn-bulk-action").addEventListener("click", async () => {
    if (bulkStep === 1) return; // aún no hay preview
    if (bulkStep === 2) await executeBulkLoad();
});

async function executeBulkLoad() {
    goStep(3);
    document.getElementById("btn-bulk-action").disabled = true;
    document.getElementById("btn-bulk-action").textContent = "Procesando...";

    const log = document.getElementById("result-log");
    const bar = document.getElementById("bulk-progress");
    const total = bulkValid.length;
    let success = 0, failed = 0;

    log.innerHTML = `<span class="log-ok">Iniciando carga de ${total} registro(s)...</span>\n`;

    for (let i = 0; i < total; i++) {
        const r = bulkValid[i];
        bar.style.width = `${Math.round(((i + 1) / total) * 100)}%`;

        try {
            const { error } = await db.rpc("register_inventory_entry", {
                p_warehouse_id: r.warehouseId,
                p_product_id: r.productId,
                p_supplier_id: null,
                p_quantity: r.stock,
                p_user_id: user.id,
                p_notes: r.notas || `Carga masiva fila ${r._idx}`,
            });

            if (error) throw error;

            // Actualizar stock mínimo si viene en el archivo
            if (r.minStk > 0) {
                await db.from("products")
                    .update({ minimum_stock: r.minStk })
                    .eq("id", r.productId);
            }

            success++;
            log.innerHTML += `<span class="log-ok">✓ Fila ${r._idx} — ${r.code} → ${r.warehouseName} (+${r.stock})</span>\n`;
        } catch (err) {
            failed++;
            log.innerHTML += `<span class="log-err">✗ Fila ${r._idx} — ${r.code}: ${err.message}</span>\n`;
        }

        // Auto-scroll al final del log
        log.scrollTop = log.scrollHeight;

        // Pequeña pausa para no saturar Supabase
        if (i < total - 1) await sleep(120);
    }

    bar.style.width = "100%";
    bar.style.background = failed === 0 ? "var(--green)" : failed === total ? "var(--red)" : "var(--orange)";

    // Resumen final
    document.getElementById("bulk-result-summary").innerHTML = `
      <span class="chip chip-total">Total procesadas: ${total}</span>
      <span class="chip chip-ok">✓ Exitosas: ${success}</span>
      ${failed ? `<span class="chip chip-error">✗ Con error: ${failed}</span>` : ""}
    `;

    log.innerHTML += `\n<span class="${failed === 0 ? "log-ok" : "log-warn"}">── Carga finalizada: ${success} exitosa(s), ${failed} con error ──</span>`;

    const btn = document.getElementById("btn-bulk-action");
    btn.disabled = false;
    btn.textContent = "Cerrar";
    btn.onclick = () => {
        closeBulk();
        loadInventory();
    };

    if (success > 0) {
        Toast.show(`Carga masiva completada: ${success} registro(s) insertados`, "success");
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ══════════════════════════════════════
   MÓDULO AJUSTE MASIVO DE INVENTARIO
══════════════════════════════════════ */

// Estado del ajuste masivo
let adjItems = []; // [{productId, productName, productCode, unit, currentStock, type, qty}]
let adjItemCounter = 0;

// ── Abrir modal ──
window.openAdjustModal = function () {
    if (!canEdit) { Toast.show("Sin permiso para realizar ajustes", "error"); return; }

    // Poblar almacenes
    const adjWh = document.getElementById("adj-warehouse");
    const entryWh = document.getElementById("entry-warehouse");
    adjWh.innerHTML = entryWh.innerHTML;

    // Reset estado
    adjItems = [];
    adjItemCounter = 0;
    document.getElementById("adj-reason").value = "";
    document.getElementById("adj-product-search").value = "";
    document.getElementById("adj-product-dropdown").style.display = "none";
    renderAdjTable();

    Modal.open("modal-adjust");
};

// ── Renderizar tabla de ítems ──
function renderAdjTable() {
    const tbody = document.getElementById("adj-items-body");
    if (adjItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:22px 0;color:var(--gray-light);font-size:0.82rem;">
                    Busca y agrega productos usando el buscador de abajo
                </td></tr>`;
        document.getElementById("btn-adj-save").disabled = true;
        updateAdjSummary();
        return;
    }

    tbody.innerHTML = adjItems.map(item => {
        const newStock = calcNewStock(item);
        const diff = newStock - item.currentStock;
        const cls = diff > 0 ? "up" : diff < 0 ? "down" : "neutral";
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "=";
        return `
                <tr data-adj-id="${item.id}">
                    <td class="td-product">
                        <div style="font-weight:600;font-size:0.82rem;">${item.productName}</div>
                        <div style="font-size:0.70rem;color:var(--gray-light);">${item.productCode} · ${item.unit || '—'}</div>
                    </td>
                    <td class="td-stock">${item.currentStock}</td>
                    <td class="td-type">
                        <select class="adj-type-select" onchange="adjChangeType(${item.id}, this.value)">
                            <option value="up"   ${item.type === 'up' ? 'selected' : ''}>▲ Incremento</option>
                            <option value="down" ${item.type === 'down' ? 'selected' : ''}>▼ Decremento</option>
                            <option value="set"  ${item.type === 'set' ? 'selected' : ''}>= Fijar</option>
                        </select>
                    </td>
                    <td class="td-qty">
                        <input type="number" class="adj-qty-input" min="0" value="${item.qty}"
                            oninput="adjChangeQty(${item.id}, this.value)" placeholder="0" />
                    </td>
                    <td class="td-new">
                        <span class="new-val-cell ${cls}">${arrow} ${newStock}</span>
                    </td>
                    <td class="td-del">
                        <button class="btn-adj-del-row" onclick="adjRemoveItem(${item.id})" title="Eliminar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                            </svg>
                        </button>
                    </td>
                </tr>`;
    }).join("");

    document.getElementById("btn-adj-save").disabled = false;
    updateAdjSummary();
}

function calcNewStock(item) {
    const qty = parseInt(item.qty) || 0;
    if (item.type === "up") return item.currentStock + qty;
    if (item.type === "down") return Math.max(0, item.currentStock - qty);
    if (item.type === "set") return qty;
    return item.currentStock;
}

function updateAdjSummary() {
    const total = adjItems.length;
    const up = adjItems.filter(i => i.type === "up").length;
    const down = adjItems.filter(i => i.type === "down").length;
    const set = adjItems.filter(i => i.type === "set").length;
    document.getElementById("adj-summ-total").textContent = total;
    document.getElementById("adj-summ-up").textContent = up;
    document.getElementById("adj-summ-down").textContent = down;
    document.getElementById("adj-summ-set").textContent = set;
}

window.adjChangeType = function (id, val) {
    const item = adjItems.find(i => i.id === id);
    if (item) { item.type = val; renderAdjTable(); }
};

window.adjChangeQty = function (id, val) {
    const item = adjItems.find(i => i.id === id);
    if (item) {
        item.qty = parseInt(val) || 0;
        // Actualizar solo la celda de nuevo stock sin re-renderizar completo
        const row = document.querySelector(`tr[data-adj-id="${id}"]`);
        if (row) {
            const newStock = calcNewStock(item);
            const diff = newStock - item.currentStock;
            const cls = diff > 0 ? "up" : diff < 0 ? "down" : "neutral";
            const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "=";
            const cell = row.querySelector(".new-val-cell");
            if (cell) { cell.className = `new-val-cell ${cls}`; cell.textContent = `${arrow} ${newStock}`; }
        }
        updateAdjSummary();
    }
};

window.adjRemoveItem = function (id) {
    adjItems = adjItems.filter(i => i.id !== id);
    renderAdjTable();
};

// ── Buscador de productos (dropdown) ──
const adjSearchInput = document.getElementById("adj-product-search");
const adjDropdown = document.getElementById("adj-product-dropdown");

adjSearchInput.addEventListener("input", () => {
    const term = adjSearchInput.value.trim().toLowerCase();
    if (!term) { adjDropdown.style.display = "none"; return; }
    const results = catalogProductsArray.filter(p =>
        (p.name && p.name.toLowerCase().includes(term)) ||
        (p.code && p.code.toLowerCase().includes(term))
    ).slice(0, 30);
    if (results.length === 0) {
        adjDropdown.innerHTML = `<div class="adj-dd-item" style="color:var(--gray-light);">Sin resultados</div>`;
    } else {
        adjDropdown.innerHTML = results.map(p =>
            `<div class="adj-dd-item" data-prod-id="${p.id}">
                        ${p.name} <span class="dd-code">${p.code}</span>
                    </div>`
        ).join("");
        adjDropdown.querySelectorAll(".adj-dd-item").forEach(el => {
            el.addEventListener("click", () => adjAddProductFromDropdown(el.dataset.prodId));
        });
    }
    // Posición del dropdown
    const rect = adjSearchInput.getBoundingClientRect();
    adjDropdown.style.top = (adjSearchInput.offsetTop + adjSearchInput.offsetHeight + 2) + "px";
    adjDropdown.style.left = adjSearchInput.offsetLeft + "px";
    adjDropdown.style.width = adjSearchInput.offsetWidth + "px";
    adjDropdown.style.display = "block";
});

adjSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") adjDropdown.style.display = "none";
});

document.addEventListener("click", (e) => {
    if (!adjSearchInput.contains(e.target) && !adjDropdown.contains(e.target)) {
        adjDropdown.style.display = "none";
    }
});

document.getElementById("btn-adj-clear-search").addEventListener("click", () => {
    adjSearchInput.value = "";
    adjDropdown.style.display = "none";
    adjSearchInput.focus();
});

// Cambio de almacén → refrescar stocks de todos los ítems
document.getElementById("adj-warehouse").addEventListener("change", async () => {
    const whId = document.getElementById("adj-warehouse").value;
    if (!whId || adjItems.length === 0) return;
    for (const item of adjItems) {
        item.currentStock = await fetchAdjStock(item.productId, whId);
    }
    renderAdjTable();
});

async function fetchAdjStock(productId, warehouseId) {
    if (!productId || !warehouseId) return 0;
    try {
        const { data, error } = await db
            .from("inventory")
            .select("stock")
            .eq("product_id", productId)
            .eq("warehouse_id", warehouseId)
            .maybeSingle();
        if (error) throw error;
        return data ? (data.stock || 0) : 0;
    } catch (e) {
        console.error("Error consultando stock:", e);
        return 0;
    }
}

async function adjAddProductFromDropdown(productId) {
    // Cerrar dropdown
    adjDropdown.style.display = "none";
    adjSearchInput.value = "";

    // Evitar duplicados
    if (adjItems.find(i => i.productId === productId)) {
        Toast.show("Este producto ya está en la lista", "info");
        adjSearchInput.focus();
        return;
    }

    const product = catalogProductsArray.find(p => p.id === productId);
    if (!product) return;

    const warehouseId = document.getElementById("adj-warehouse").value;
    const stock = await fetchAdjStock(productId, warehouseId);

    adjItems.push({
        id: ++adjItemCounter,
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        unit: product.unit || "",
        currentStock: stock,
        type: "up",
        qty: 0
    });

    renderAdjTable();
    adjSearchInput.focus();
}

// ── Aplicar ajuste masivo ──
document.getElementById("btn-adj-save").addEventListener("click", async () => {
    const warehouseId = document.getElementById("adj-warehouse").value;
    const reason = document.getElementById("adj-reason").value.trim();

    if (!warehouseId) { Toast.show("Selecciona un almacén", "error"); return; }
    if (!reason) { Toast.show("El motivo del ajuste es obligatorio", "error"); return; }
    if (adjItems.length === 0) { Toast.show("Agrega al menos un producto", "error"); return; }

    // Validar cantidades
    for (const item of adjItems) {
        if (item.qty < 0 || isNaN(item.qty)) {
            Toast.show(`Cantidad inválida en: ${item.productName}`, "error"); return;
        }
    }

    if (isRestricted && !allowedWarehouseIds.includes(warehouseId)) {
        Toast.show("No tienes permiso para operar en este almacén", "error"); return;
    }

    const btn = document.getElementById("btn-adj-save");
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Aplicando ${adjItems.length} ajustes...`;

    let applied = 0;
    let errors = [];

    try {
        // Un único folio para todo el lote
        const adjFolio = await getNextFolio("AJU");
        const notesText = `[Folio: ${adjFolio}] AJUSTE MASIVO: ${reason}`;

        for (const item of adjItems) {
            const qty = parseInt(item.qty) || 0;
            let entryQty = 0, exitQty = 0;

            if (item.type === "up") {
                entryQty = qty;
            } else if (item.type === "down") {
                exitQty = Math.min(qty, item.currentStock);
            } else if (item.type === "set") {
                const diff = qty - item.currentStock;
                if (diff > 0) entryQty = diff;
                else if (diff < 0) exitQty = Math.abs(diff);
                // diff === 0: sin cambio, se omite
            }

            try {
                if (entryQty > 0) {
                    const { error } = await db.rpc("register_inventory_entry", {
                        p_warehouse_id: warehouseId,
                        p_product_id: item.productId,
                        p_supplier_id: null,
                        p_quantity: entryQty,
                        p_user_id: user.id,
                        p_notes: notesText,
                    });
                    if (error) throw error;
                    applied++;
                } else if (exitQty > 0) {
                    const { error } = await db.rpc("register_inventory_exit", {
                        p_warehouse_id: warehouseId,
                        p_product_id: item.productId,
                        p_project_id: null,
                        p_quantity: exitQty,
                        p_user_id: user.id,
                        p_notes: notesText,
                    });
                    if (error) throw error;
                    applied++;
                } else {
                    applied++; // sin cambio (set con diff=0)
                }
            } catch (itemErr) {
                errors.push(`${item.productCode}: ${itemErr.message}`);
            }
        }

        if (errors.length === 0) {
            Toast.show(`✅ Folio ${adjFolio} — ${applied} ajuste(s) aplicado(s) correctamente`, "success");
        } else {
            Toast.show(`⚠️ Folio ${adjFolio} — ${applied - errors.length} ok, ${errors.length} error(es)`, "info");
            console.warn("Errores en ajuste masivo:", errors);
        }

        Modal.close("modal-adjust");
        loadInventory();
    } catch (err) {
        console.error("Error al aplicar ajuste masivo:", err);
        Toast.show(err.message || "Error al aplicar el ajuste masivo", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="12" y2="12"/><line x1="15" y1="15" x2="12" y2="12"/></svg> Aplicar Ajuste Masivo`;
    }
});

/* ══════════════════════════════════════
   EXPORTAR INVENTARIO A EXCEL
══════════════════════════════════════ */
window.exportInventoryExcel = async function () {
    const btnExport = document.getElementById("btn-export-excel");
    const origHTML = btnExport.innerHTML;
    btnExport.disabled = true;
    btnExport.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Exportando...`;

    try {
        // Traer TODOS los registros usando fetchAll
        const allData = await fetchAll(
            (from, to) => {
                let q = db
                    .from("inventory")
                    .select(`
                                id,
                                stock,
                                reserved_stock,
                                stock_status,
                                last_movement_at,
                                products!inner (
                                    id,
                                    code,
                                    name,
                                    minimum_stock,
                                    unit,
                                    categories(name)
                                ),
                                warehouses (
                                    id,
                                    name
                                )
                            `);
                if (isRestricted && allowedWarehouseIds.length > 0) {
                    q = q.in("warehouse_id", allowedWarehouseIds);
                }
                return q.range(from, to).order("last_movement_at", { ascending: false });
            },
            null,
            500
        );

        if (!allData || allData.length === 0) {
            Toast.show("No hay datos en el inventario para exportar", "info");
            return;
        }

        const statusLabel = { NORMAL: "Normal", LOW: "Stock Bajo", OUT: "Agotado" };

        // Construir filas
        const rows = allData.map(r => ({
            "Código": r.products?.code || "",
            "Producto": r.products?.name || "",
            "Categoría": r.products?.categories?.name || "",
            "Almacén": r.warehouses?.name || "",
            "Stock Actual": r.stock ?? 0,
            "Stock Reservado": r.reserved_stock ?? 0,
            "Stock Mínimo": r.products?.minimum_stock ?? 0,
            "Unidad": r.products?.unit || "",
            "Estado": statusLabel[r.stock_status] || r.stock_status || "",
            "Último Movimiento": r.last_movement_at ? new Date(r.last_movement_at).toLocaleString("es-MX") : "",
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        // Anchos de columna
        ws["!cols"] = [
            { wch: 16 }, // Código
            { wch: 36 }, // Producto
            { wch: 22 }, // Categoría
            { wch: 22 }, // Almacén
            { wch: 14 }, // Stock Actual
            { wch: 16 }, // Stock Reservado
            { wch: 14 }, // Stock Mínimo
            { wch: 10 }, // Unidad
            { wch: 14 }, // Estado
            { wch: 22 }, // Último Movimiento
        ];

        XLSX.utils.book_append_sheet(wb, ws, "INVENTARIO");

        // Hoja de metadatos
        const metaRows = [
            ["HEAD STORE — Exportación de Inventario"],
            [""],
            ["Fecha de exportación:", new Date().toLocaleString("es-MX")],
            ["Exportado por:", user.full_name || "—"],
            ["Total de registros:", allData.length],
        ];
        const wsMeta = XLSX.utils.aoa_to_sheet(metaRows);
        wsMeta["!cols"] = [{ wch: 28 }, { wch: 36 }];
        XLSX.utils.book_append_sheet(wb, wsMeta, "INFO");

        const dateStr = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, `inventario_headstore_${dateStr}.xlsx`);
        Toast.show(`Inventario exportado: ${allData.length} registros`, "success");

    } catch (err) {
        console.error("Error exportando inventario:", err);
        Toast.show("Error al exportar: " + err.message, "error");
    } finally {
        btnExport.disabled = false;
        btnExport.innerHTML = origHTML;
    }
};

/* ── Descargar plantilla Excel ── */
function downloadTemplate(e) {
    e.preventDefault();
    // Construir un workbook mínimo con SheetJS que coincida con la plantilla
    const wb = XLSX.utils.book_new();

    // Hoja INVENTARIO
    const headers = [
        "codigo_producto *", "nombre_producto *", "unidad *",
        "categoria", "stock_inicial *", "stock_minimo",
        "almacen_codigo *", "notas"
    ];
    const examples = [
        ["PROD-001", "Varilla corrugada 3/8", "kg", "Materiales de Construcción", 500, 50, "ALM-CENTRAL", "Lote enero"],
        ["PROD-002", "Cemento gris 50kg", "saco", "Materiales de Construcción", 200, 20, "ALM-CENTRAL", ""],
        ["PROD-003", "Cable THW calibre 12", "m", "Eléctrico", 300, 30, "ALM-CENTRAL", ""],
        ["PROD-004", "Llave stillson 14\"", "pza", "Herramientas", 15, 5, "ALM-CENTRAL", ""],
        ["PROD-005", "Tubo PVC 4\" hidráulico", "m", "Plomería", 80, 10, "ALM-CENTRAL", ""],
    ];

    // Fila de aviso
    const noticeRow = ["↓  INGRESA TUS DATOS DESDE AQUÍ  ↓", "", "", "", "", "", "", ""];

    const sheetData = [headers, ...examples, noticeRow];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Anchos de columna aproximados
    ws["!cols"] = [16, 28, 10, 20, 12, 12, 16, 22].map(w => ({ wch: w }));

    XLSX.utils.book_append_sheet(wb, ws, "INVENTARIO");

    // Hoja INSTRUCCIONES
    const instrData = [
        ["HEAD STORE — Instrucciones de Carga Masiva"],
        [""],
        ["CAMPOS OBLIGATORIOS (marcados con *)"],
        ["  codigo_producto * → Código único del producto (debe existir en el catálogo)"],
        ["  nombre_producto * → Nombre referencial (no se usa para insertar)"],
        ["  unidad *          → Unidad de medida: pza, kg, m, lt, saco, etc."],
        ["  stock_inicial *   → Cantidad inicial (entero positivo)"],
        ["  almacen_codigo *  → Código exacto del almacén (ej: ALM-CENTRAL)"],
        [""],
        ["CAMPOS OPCIONALES"],
        ["  categoria         → Nombre de categoría (referencia visual)"],
        ["  stock_minimo      → Cantidad mínima antes de alerta (0 si no aplica)"],
        ["  notas             → Comentarios u observaciones del lote"],
        [""],
        ["ERRORES COMUNES"],
        ["  El código de producto no existe → Verifica en el catálogo de Productos"],
        ["  El código de almacén no existe  → Verifica en la pantalla de Almacenes"],
        ["  Stock 0 o negativo              → stock_inicial debe ser > 0"],
        ["  Las filas de ejemplo (PROD-001 a PROD-005) se ignoran automáticamente"],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instrData);
    ws2["!cols"] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, ws2, "INSTRUCCIONES");

    XLSX.writeFile(wb, "plantilla_inventario_headstore.xlsx");
    Toast.show("Plantilla descargada correctamente", "success");
}