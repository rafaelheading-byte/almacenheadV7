
// Pagination state
let currentPage = 1;
const pageSize = 50;
let totalRecords = 0;

const user = Auth.requireAuth();
let allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

// Verify role and packing plant access
let isAccessAllowed = false;
if (user) {
    const isAdmin = user.role === "ADMIN";
    const isCoordinador = user.role === "COORDINADOR";
    const isAlmacenista = user.role === "ALMACENISTA";
    const hasEmpacadoraAccess = user.has_empacadora_access === true;
    isAccessAllowed = isAdmin || isCoordinador || (hasEmpacadoraAccess);
}

if (!isAccessAllowed) {
    showAccessDenied();
}

function showAccessDenied() {
    document.body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#fafafa;color:#333;">
                    <div style="background:#fff;padding:40px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;max-width:420px;">
                        <span style="font-size:4rem;display:block;margin-bottom:20px;">🚫</span>
                        <h2 style="margin:0 0 10px 0;font-size:1.5rem;color:#b52525;">Acceso Denegado</h2>
                        <p style="margin:0 0 20px 0;color:#666;font-size:0.9rem;line-height:1.5;">No tienes permisos para acceder al submódulo de Apartados. Debes ser administrador, coordinador o almacenista con acceso a empacadora.</p>
                        <p style="margin:0;font-size:0.8rem;color:#999;">Redirigiendo a Inventario...</p>
                    </div>
                </div>
            `;
    setTimeout(() => {
        window.location.href = "inventory.html";
    }, 3000);
}

// Memory Catalogs
let catalogProductsArray = [];
let catalogWarehousesArray = [];
let catalogProjectsArray = [];

// State of current modal
let currentModalMode = "create"; // "create", "edit", "view"
let currentApartadoId = null;
let selectedItems = []; // Array of { productId, code, name, unit, quantity }
let selectedProduct = null;
let modalStocks = {}; // { productId: stockValue }
let currentSelectedProductStock = 0; // to keep track of the selected product's stock
let currentSelectedProductReserved = 0; // to keep track of the selected product's reserved stock

// Initialize Page
window.addEventListener("DOMContentLoaded", async () => {
    if (!isAccessAllowed) return;

    renderSidebar("nav-apartados");
    await loadCatalogs();
    await loadApartados();
    setupSearchFilters();

    // Real-time quantity validation warning
    const qtyInput = document.getElementById("product-qty");
    if (qtyInput) {
        qtyInput.addEventListener("input", checkCurrentQtyWarning);
    }
});

// Load DB Catalogs
async function loadCatalogs() {
    try {
        // Fetch Warehouses
        let whQuery = db.from("warehouses").select("id, name, code").eq("is_active", true);
        if (isRestricted) {
            whQuery = whQuery.in("id", allowedWarehouseIds);
        }
        const { data: whs } = await whQuery.order("name");
        catalogWarehousesArray = whs || [];

        // Fetch Products
        const { data: prods } = await db.from("products").select("id, name, code, unit").eq("is_active", true).order("name");
        catalogProductsArray = prods || [];

        // Fetch Projects
        const { data: projs } = await db.from("projects").select("id, name, code").eq("is_active", true).order("name");
        catalogProjectsArray = projs || [];

        // Fill filters and modal forms
        fillWarehouseOptions();
    } catch (err) {
        console.error("Error cargando catálogos:", err);
        Toast.show("Error al cargar almacenes o productos", "error");
    }
}

function fillWarehouseOptions() {
    const filterWh = document.getElementById("filter-warehouse");
    const modalWh = document.getElementById("apartado-warehouse");

    if (filterWh) {
        // Clear filter options to avoid duplicating on reload
        filterWh.innerHTML = '<option value="">Todos los almacenes</option>';
        catalogWarehousesArray.forEach(w => {
            const opt = document.createElement("option");
            opt.value = w.id;
            opt.textContent = w.name;
            filterWh.appendChild(opt);
        });
    }

    if (modalWh) {
        fillModalWarehouseOptions("view");
    }
}

function fillModalWarehouseOptions(mode) {
    const modalWh = document.getElementById("apartado-warehouse");
    if (!modalWh) return;

    modalWh.innerHTML = '<option value="">Selecciona origen...</option>';
    
    let list = catalogWarehousesArray;
    if (mode === "create") {
        list = catalogWarehousesArray.filter(w => 
            w.name && w.name.toLowerCase().includes("empacadora")
        );
    }
    
    list.forEach(w => {
        const opt = document.createElement("option");
        opt.value = w.id;
        opt.textContent = `${w.name} (${w.code})`;
        modalWh.appendChild(opt);
    });
}

// Triggered when Origin Warehouse changes in the Modal
function onOriginWarehouseChange() {
    const whSelect = document.getElementById("apartado-warehouse");
    const selectedText = whSelect?.selectedOptions?.[0]?.text?.trim().toLowerCase() || "";
    const isEmpacadora = selectedText.includes("empacadora");

    const label = document.getElementById("apartado-destination-label");
    const destSelect = document.getElementById("apartado-destination");

    if (!label || !destSelect) return;

    if (isEmpacadora) {
        label.textContent = "Almacén Destino *";
        let html = '<option value="">Selecciona almacén destino...</option>';
        // Warehouses excluding the currently selected origin warehouse
        const originId = whSelect.value;
        catalogWarehousesArray.forEach(w => {
            if (w.id !== originId) {
                html += `<option value="${w.id}">${w.name} (${w.code})</option>`;
            }
        });
        destSelect.innerHTML = html;
    } else {
        label.textContent = "Tipo Salida / Obra *";
        let html = '<option value="">Selecciona destino/obra...</option>';
        catalogProjectsArray.forEach(p => {
            html += `<option value="${p.id}">${p.name} (${p.code})</option>`;
        });
        destSelect.innerHTML = html;
    }
    updateStockInfo();
    const whId = whSelect?.value;
    fetchModalStocks(whId).then(() => {
        renderSelectedItems();
    });
}

// Muestra stock actual al seleccionar producto/almacén
async function updateStockInfo() {
    const stockInfo = document.getElementById("apartado-stock-info");
    const warehouseId = document.getElementById("apartado-warehouse").value;

    if (!selectedProduct || !warehouseId) {
        if (stockInfo) stockInfo.style.display = "none";
        currentSelectedProductStock = 0;
        currentSelectedProductReserved = 0;
        return;
    }

    try {
        const { data, error } = await db
            .from("inventory")
            .select("stock")
            .eq("product_id", selectedProduct.id)
            .eq("warehouse_id", warehouseId)
            .single();

        if (error || !data) {
            currentSelectedProductStock = 0;
            currentSelectedProductReserved = 0;
            stockInfo.style.display = "block";
            stockInfo.style.background = "#fff3cd";
            stockInfo.style.color = "#856404";
            stockInfo.style.border = "1px solid #ffc107";
            stockInfo.textContent = "⚠ Sin registro de stock en este almacén";
            checkCurrentQtyWarning();
            return;
        }

        const stock = data.stock || 0;
        currentSelectedProductStock = stock;

        // Query reserved quantity in PENDIENTE and VERIFICANDO status for this warehouse and product (excluding current apartado)
        let reservedQty = 0;
        try {
            let queryAp = db
                .from("apartados")
                .select("id")
                .eq("warehouse_id", warehouseId)
                .in("status", ["PENDIENTE", "VERIFICANDO"]);

            if (currentApartadoId) {
                queryAp = queryAp.neq("id", currentApartadoId);
            }

            const { data: pendingApartados, error: apError } = await queryAp;

            if (!apError && pendingApartados && pendingApartados.length > 0) {
                const apIds = pendingApartados.map(a => a.id);
                const { data: items, error: itemsError } = await db
                    .from("apartado_items")
                    .select("quantity")
                    .eq("product_id", selectedProduct.id)
                    .in("apartado_id", apIds);

                if (!itemsError && items) {
                    reservedQty = items.reduce((sum, item) => sum + parseFloat(item.quantity || 0), 0);
                }
            }
        } catch (err) {
            console.error("Error consultando apartados pendientes:", err);
        }
        currentSelectedProductReserved = reservedQty;

        const freeStock = stock - reservedQty;
        stockInfo.style.display = "block";

        if (freeStock <= 0) {
            stockInfo.style.background = "rgba(224,53,53,.12)";
            stockInfo.style.color = "#b52525";
            stockInfo.style.border = "1px solid rgba(224,53,53,.3)";
            stockInfo.textContent = `🚫 Stock físico: ${stock} | Apartado: ${reservedQty} | Disp. libre: ${freeStock}`;
        } else if (freeStock <= 5) {
            stockInfo.style.background = "rgba(230,126,34,.12)";
            stockInfo.style.color = "#c0620a";
            stockInfo.style.border = "1px solid rgba(230,126,34,.3)";
            stockInfo.textContent = `⚠ Stock físico: ${stock} | Apartado: ${reservedQty} | Disp. libre: ${freeStock} (bajo)`;
        } else {
            stockInfo.style.background = "rgba(39,174,96,.12)";
            stockInfo.style.color = "#1a8a4a";
            stockInfo.style.border = "1px solid rgba(39,174,96,.3)";
            stockInfo.textContent = `✓ Stock físico: ${stock} | Apartado: ${reservedQty} | Disp. libre: ${freeStock}`;
        }

        checkCurrentQtyWarning();
    } catch (e) {
        console.error("Error consultando stock:", e);
    }
}

// Verifica si la cantidad a agregar excede el stock libre actual
function checkCurrentQtyWarning() {
    const qtyInput = document.getElementById("product-qty");
    const stockInfo = document.getElementById("apartado-stock-info");
    if (!qtyInput || !stockInfo || stockInfo.style.display === "none") return;

    const qty = parseFloat(qtyInput.value);
    if (isNaN(qty) || qty <= 0) {
        let text = stockInfo.textContent;
        if (text.includes(" | ⚠️")) {
            stockInfo.textContent = text.split(" | ⚠️")[0];
        }
        return;
    }

    let text = stockInfo.textContent;
    if (text.includes(" | ⚠️")) {
        text = text.split(" | ⚠️")[0];
    }

    const freeStock = currentSelectedProductStock - currentSelectedProductReserved;

    if (qty > freeStock) {
        stockInfo.style.background = "rgba(224,53,53,.12)";
        stockInfo.style.color = "#b52525";
        stockInfo.style.border = "1px solid rgba(224,53,53,.3)";
        stockInfo.textContent = `${text} | ⚠️ Excede disp. libre (Faltan: ${(qty - freeStock).toFixed(2)})`;
    } else {
        if (freeStock <= 0) {
            stockInfo.style.background = "rgba(224,53,53,.12)";
            stockInfo.style.color = "#b52525";
            stockInfo.style.border = "1px solid rgba(224,53,53,.3)";
        } else if (freeStock <= 5) {
            stockInfo.style.background = "rgba(230,126,34,.12)";
            stockInfo.style.color = "#c0620a";
            stockInfo.style.border = "1px solid rgba(230,126,34,.3)";
        } else {
            stockInfo.style.background = "rgba(39,174,96,.12)";
            stockInfo.style.color = "#1a8a4a";
            stockInfo.style.border = "1px solid rgba(39,174,96,.3)";
        }
        stockInfo.textContent = text;
    }
}

// Obtiene el stock en el modal para todos los ítems agregados
async function fetchModalStocks(warehouseId) {
    if (!warehouseId || selectedItems.length === 0) {
        modalStocks = {};
        return;
    }
    try {
        const pIds = selectedItems.map(it => it.productId);
        const { data, error } = await db
            .from("inventory")
            .select("product_id, stock")
            .eq("warehouse_id", warehouseId)
            .in("product_id", pIds);

        modalStocks = {};
        selectedItems.forEach(it => {
            modalStocks[it.productId] = 0;
        });

        if (!error && data) {
            data.forEach(r => {
                modalStocks[r.product_id] = parseFloat(r.stock ?? 0);
            });
        }
    } catch (e) {
        console.error("Error fetching modal stocks:", e);
    }
}

// Setup Event Listeners for Filters
function setupSearchFilters() {
    const search = document.getElementById("search-input");
    const filterStatus = document.getElementById("filter-status");
    const filterWh = document.getElementById("filter-warehouse");

    let timeout;
    search.addEventListener("input", () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => loadApartados(1), 300);
    });

    filterStatus.addEventListener("change", () => loadApartados(1));
    filterWh.addEventListener("change", () => loadApartados(1));
}

// Load list of Apartados
async function loadApartados(page = 1) {
    const tbody = document.getElementById("apartados-body");
    tbody.innerHTML = loadingRow(10);

    currentPage = page;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const q = document.getElementById("search-input").value.trim();
    const statusFilter = document.getElementById("filter-status").value;
    const whFilter = document.getElementById("filter-warehouse").value;

    let query = db
        .from("apartados")
        .select(`
                    id,
                    folio,
                    status,
                    notes,
                    created_at,
                    exit_folio,
                    requisicion,
                    pedido,
                    warehouses:warehouse_id (id, name),
                    projects:project_id (id, name),
                    destination_warehouses:destination_warehouse_id (id, name),
                    creator:created_by (full_name)
                `, { count: "exact" });

    if (isRestricted) {
        query = query.in("warehouse_id", allowedWarehouseIds);
    }

    if (whFilter) {
        query = query.eq("warehouse_id", whFilter);
    }

    if (statusFilter) {
        query = query.eq("status", statusFilter);
    }

    if (q) {
        query = query.ilike("folio", `%${q}%`);
    }

    const { data, error, count } = await query
        .range(from, to)
        .order("created_at", { ascending: false });

    if (error) {
        console.error(error);
        tbody.innerHTML = emptyRow(10, "Error al cargar apartados: " + error.message);
        return;
    }

    totalRecords = count || 0;
    document.getElementById("record-count").textContent = `${totalRecords} apartado(s)`;

    if (data.length === 0) {
        tbody.innerHTML = emptyRow(10, "No se encontraron apartados");
        renderPagination();
        return;
    }

    tbody.innerHTML = data.map(r => {
        // Determine destination string
        let destination = "—";
        if (r.projects?.name) {
            destination = `<span class="badge badge-normal">${r.projects.name}</span>`;
        } else if (r.destination_warehouses?.name) {
            destination = `<span class="badge badge-transfer">${r.destination_warehouses.name}</span>`;
        }

        // Status Badge
        let badgeClass = "status-pendiente";
        let statusLabel = r.status;
        if (r.status === "PENDIENTE") {
            badgeClass = "status-pendiente";
            statusLabel = "Pendiente";
        } else if (r.status === "VERIFICANDO") {
            badgeClass = "status-verificando";
            statusLabel = "Verificando";
        } else if (r.status === "COMPLETADO") {
            badgeClass = "status-completado";
            statusLabel = "Completo";
        } else if (r.status === "CANCELADO") {
            badgeClass = "status-cancelado";
            statusLabel = "Cancelado";
        }

        const dateStr = fmt.datetime(r.created_at);

        return `
                    <tr>
                        <td class="code-cell fw-600">${r.folio}</td>
                        <td class="text-mono">${r.requisicion || "—"}</td>
                        <td class="text-mono">${r.pedido || "—"}</td>
                        <td>${r.warehouses?.name || "—"}</td>
                        <td>${destination}</td>
                        <td class="text-muted">${dateStr}</td>
                        <td class="text-muted">${r.creator?.full_name || "—"}</td>
                        <td class="text-mono font-bold">${r.exit_folio || "—"}</td>
                        <td><span class="status-badge ${badgeClass}">${statusLabel}</span></td>
                        <td style="text-align:center;">
                            <button class="btn btn-secondary btn-sm" onclick="openDetailModal('${r.id}')">Ver Detalle</button>
                        </td>
                    </tr>
                `;
    }).join("");

    renderPagination();
}

function renderPagination() {
    const pag = document.getElementById("pagination");
    if (!pag) return;

    const totalPages = Math.ceil(totalRecords / pageSize);
    if (totalPages <= 1) {
        pag.innerHTML = "";
        return;
    }

    let html = "";
    if (currentPage > 1) {
        html += `<button class="btn btn-secondary btn-sm" onclick="loadApartados(${currentPage - 1})">« Ant</button>`;
    }
    html += `<span class="text-muted" style="font-size:0.8rem;">Página ${currentPage} de ${totalPages}</span>`;
    if (currentPage < totalPages) {
        html += `<button class="btn btn-secondary btn-sm" onclick="loadApartados(${currentPage + 1})">Sig »</button>`;
    }
    pag.innerHTML = html;
}

// ==========================================
// CREATING NEW APARTADO
// ==========================================
function openCreateModal() {
    currentModalMode = "create";
    currentApartadoId = null;
    selectedItems = [];

    // Title
    document.getElementById("apartado-modal-title").textContent = "📦 Nuevo Apartado";

    // Populate warehouse dropdown for create mode (only empacadora)
    fillModalWarehouseOptions("create");

    // Clear Form & auto-select warehouse if options are available
    const modalWh = document.getElementById("apartado-warehouse");
    if (modalWh && modalWh.options.length > 1) {
        modalWh.selectedIndex = 1;
    } else {
        if (modalWh) modalWh.value = "";
    }
    document.getElementById("apartado-destination").value = "";
    document.getElementById("apartado-notes").value = "";
    document.getElementById("product-search").value = "";
    document.getElementById("product-qty").value = "";
    document.getElementById("apartado-requisicion").value = "";
    document.getElementById("apartado-pedido").value = "";
    document.getElementById("apartado-requisicion").disabled = false;
    document.getElementById("apartado-pedido").disabled = false;

    selectedProduct = null;
    const stockInfo = document.getElementById("apartado-stock-info");
    if (stockInfo) stockInfo.style.display = "none";

    // Enable editing
    const container = document.getElementById("apartado-form-container");
    container.classList.remove("disabled-form");

    // Lock warehouse if restricted
    if (isRestricted) {
        const defaultWh = user.warehouse_id || (allowedWarehouseIds && allowedWarehouseIds[0]);
        if (defaultWh) {
            document.getElementById("apartado-warehouse").value = defaultWh;
        }
        document.getElementById("apartado-warehouse").disabled = true;
    } else {
        document.getElementById("apartado-warehouse").disabled = false;
    }

    document.getElementById("apartado-destination").disabled = false;
    document.getElementById("apartado-notes").disabled = false;

    // Show sections
    document.getElementById("status-row").style.display = "none";
    document.getElementById("add-item-section").style.display = "block";
    document.getElementById("th-delete-header").style.display = "";

    // Buttons
    document.getElementById("btn-apartado-cancel").style.display = "none";
    document.getElementById("btn-apartado-save").style.display = "inline-block";
    document.getElementById("btn-apartado-save").textContent = "Guardar Apartado";
    document.getElementById("btn-apartado-validate").style.display = "none";
    document.getElementById("btn-apartado-reprint").style.display = "none";
    document.getElementById("btn-apartado-print").style.display = "none";

    // Default Dynamic fields
    onOriginWarehouseChange();
    renderSelectedItems();

    Modal.open("modal-apartado");
}

// Product search typing
function onProductSearchInput() {
    const dropdown = document.getElementById("product-dropdown-results");
    const q = document.getElementById("product-search").value.trim().toLowerCase();

    if (!q) {
        dropdown.classList.remove("open");
        selectedProduct = null;
        return;
    }

    const results = catalogProductsArray.filter(p =>
        p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    ).slice(0, 10);

    if (results.length === 0) {
        dropdown.innerHTML = '<div style="padding:8px 12px;font-size:0.8rem;color:#888;">Sin resultados</div>';
    } else {
        dropdown.innerHTML = results.map(p => `
                    <div class="product-dropdown-item" onclick="selectProduct('${p.id}')">
                        <span class="item-name">${p.name}</span>
                        <span class="item-code">${p.code} (${p.unit})</span>
                    </div>
                `).join("");
    }
    dropdown.classList.add("open");
}

// Select product from search dropdown
window.selectProduct = function (productId) {
    const prod = catalogProductsArray.find(p => p.id === productId);
    if (prod) {
        selectedProduct = prod;
        document.getElementById("product-search").value = `${prod.name} (${prod.code})`;
        document.getElementById("product-qty").focus();
        updateStockInfo();
    }
    document.getElementById("product-dropdown-results").classList.remove("open");
};

// Add selected product to the table list
function addInsumoToApartado() {
    if (!selectedProduct) {
        Toast.show("Debes seleccionar un producto válido", "error");
        return;
    }
    const qtyVal = parseFloat(document.getElementById("product-qty").value);
    if (isNaN(qtyVal) || qtyVal <= 0) {
        Toast.show("La cantidad debe ser mayor a 0", "error");
        return;
    }

    // Check if already exists in list
    const existing = selectedItems.find(item => item.productId === selectedProduct.id);
    if (existing) {
        existing.quantity += qtyVal;
    } else {
        selectedItems.push({
            productId: selectedProduct.id,
            code: selectedProduct.code,
            name: selectedProduct.name,
            unit: selectedProduct.unit,
            quantity: qtyVal
        });
    }

    // Before resetting selectedProduct, save its stock in modalStocks
    modalStocks[selectedProduct.id] = currentSelectedProductStock;

    // Reset selection fields
    selectedProduct = null;
    document.getElementById("product-search").value = "";
    document.getElementById("product-qty").value = "";
    const stockInfo = document.getElementById("apartado-stock-info");
    if (stockInfo) stockInfo.style.display = "none";

    renderSelectedItems();
}

// Render selected items in table
function renderSelectedItems() {
    const tbody = document.getElementById("apartado-items-body");
    const isReadOnly = currentModalMode === "view";

    if (selectedItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;">No hay insumos agregados</td></tr>`;
        return;
    }

    tbody.innerHTML = selectedItems.map((item, idx) => {
        const stock = modalStocks[item.productId] ?? 0;
        const exceeds = item.quantity > stock;
        const warningHtml = exceeds ? `<div style="color:var(--red); font-size:0.68rem; font-weight:600; margin-top:2px; text-align:right;">⚠️ Faltan ${(item.quantity - stock).toFixed(2)} (${stock} disp.)</div>` : '';

        return `
                <tr>
                    <td class="text-mono font-bold">${item.code}</td>
                    <td>${item.name}</td>
                    <td class="text-muted">${item.unit || "pza"}</td>
                    <td style="text-align:right;">
                        ${isReadOnly ?
                `<span class="text-mono font-bold" style="${exceeds ? 'color: var(--red);' : ''}">${item.quantity}</span>` :
                `<input type="number" class="qty-input" value="${item.quantity}" min="0.01" step="any" onchange="updateItemQty(${idx}, this.value)" style="${exceeds ? 'border-color: var(--red); box-shadow: 0 0 0 2px rgba(224,53,53,.15);' : ''}" />`
            }
                        ${warningHtml}
                    </td>
                    <td style="text-align:center;">
                        ${isReadOnly ?
                `—` :
                `<button class="btn-delete-row" onclick="removeItem(${idx})">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>`
            }
                    </td>
                </tr>
                `;
    }).join("");
}

window.updateItemQty = function (idx, value) {
    const val = parseFloat(value);
    if (!isNaN(val) && val > 0) {
        selectedItems[idx].quantity = val;
        renderSelectedItems();
    } else {
        Toast.show("La cantidad debe ser mayor a 0", "error");
        renderSelectedItems(); // restore old value
    }
};

window.removeItem = function (idx) {
    selectedItems.splice(idx, 1);
    renderSelectedItems();
};

// Close modal and clean dropdowns
window.closeApartadoModal = function (force = false) {
    document.getElementById("product-dropdown-results").classList.remove("open");
    Modal.close("modal-apartado", force);
};

// ==========================================
// SAVE / UPDATE APARTADO
// ==========================================
window.saveApartado = async function () {
    const warehouseId = document.getElementById("apartado-warehouse").value;
    const destSelect = document.getElementById("apartado-destination");
    const destinationId = destSelect.value;
    const notes = document.getElementById("apartado-notes").value;
    const reqRaw = document.getElementById("apartado-requisicion").value.trim();
    const pedRaw = document.getElementById("apartado-pedido").value.trim();
    const requisicion = reqRaw ? parseInt(reqRaw, 10) : null;
    const pedido = pedRaw ? parseInt(pedRaw, 10) : null;

    if (reqRaw && (isNaN(requisicion) || requisicion <= 0)) {
        Toast.show("La requisición debe ser un número entero válido", "error");
        return;
    }
    if (pedRaw && (isNaN(pedido) || pedido <= 0)) {
        Toast.show("El pedido debe ser un número entero válido", "error");
        return;
    }

    if (!warehouseId) {
        Toast.show("Selecciona el almacén de origen", "error");
        return;
    }
    if (!destinationId) {
        Toast.show("Selecciona la obra o almacén de destino", "error");
        return;
    }
    if (selectedItems.length === 0) {
        Toast.show("Debes agregar al menos un insumo al apartado", "error");
        return;
    }

    const whSelect = document.getElementById("apartado-warehouse");
    const selectedText = whSelect?.selectedOptions?.[0]?.text?.trim().toLowerCase() || "";
    const isEmpacadora = selectedText.includes("empacadora");

    const projectId = isEmpacadora ? null : destinationId;
    const destWarehouseId = isEmpacadora ? destinationId : null;

    const btn = document.getElementById("btn-apartado-save");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    try {
        if (currentModalMode === "create") {
            // Create Apartado
            const { data: newApartado, error: masterError } = await db
                .from("apartados")
                .insert({
                    warehouse_id: warehouseId,
                    project_id: projectId,
                    destination_warehouse_id: destWarehouseId,
                    notes: notes || null,
                    created_by: user.id,
                    status: "PENDIENTE",
                    requisicion: requisicion || null,
                    pedido: pedido || null
                })
                .select()
                .single();

            if (masterError) throw masterError;

            // Insert Items
            const itemPayloads = selectedItems.map(item => ({
                apartado_id: newApartado.id,
                product_id: item.productId,
                quantity: item.quantity
            }));

            const { error: itemsError } = await db
                .from("apartado_items")
                .insert(itemPayloads);

            if (itemsError) throw itemsError;

            Toast.show("Apartado creado exitosamente", "success");
        } else if (currentModalMode === "edit") {
            // Update master record
            const { error: masterError } = await db
                .from("apartados")
                .update({
                    warehouse_id: warehouseId,
                    project_id: projectId,
                    destination_warehouse_id: destWarehouseId,
                    notes: notes || null,
                    updated_at: new Date().toISOString(),
                    requisicion: requisicion || null,
                    pedido: pedido || null
                })
                .eq("id", currentApartadoId);

            if (masterError) throw masterError;

            // Delete existing items and re-insert
            const { error: deleteError } = await db
                .from("apartado_items")
                .delete()
                .eq("apartado_id", currentApartadoId);

            if (deleteError) throw deleteError;

            const itemPayloads = selectedItems.map(item => ({
                apartado_id: currentApartadoId,
                product_id: item.productId,
                quantity: item.quantity
            }));

            const { error: itemsError } = await db
                .from("apartado_items")
                .insert(itemPayloads);

            if (itemsError) throw itemsError;

            Toast.show("Apartado actualizado exitosamente", "success");
        }

        btn.disabled = false;
        closeApartadoModal(true);
        loadApartados();
    } catch (err) {
        console.error("Error guardando apartado:", err);
        Toast.show("Error al guardar: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = currentModalMode === "create" ? "Guardar Apartado" : "Guardar Cambios";
    }
};

// ==========================================
// DETALLE Y EDICIÓN
// ==========================================
window.openDetailModal = async function (apartadoId) {
    currentApartadoId = apartadoId;
    selectedItems = [];

    selectedProduct = null;
    const stockInfo = document.getElementById("apartado-stock-info");
    if (stockInfo) stockInfo.style.display = "none";

    try {
        // Fetch Master Data
        const { data: master, error: masterError } = await db
            .from("apartados")
            .select(`
                        id,
                        folio,
                        status,
                        notes,
                        warehouse_id,
                        project_id,
                        destination_warehouse_id,
                        exit_folio,
                        requisicion,
                        pedido
                    `)
            .eq("id", apartadoId)
            .single();

        if (masterError) throw masterError;

        // Fetch Items (Detail)
        const { data: items, error: itemsError } = await db
            .from("apartado_items")
            .select(`
                        id,
                        product_id,
                        quantity,
                        products (
                            id,
                            code,
                            name,
                            unit
                        )
                    `)
            .eq("apartado_id", apartadoId);

        if (itemsError) throw itemsError;

        // Load items to state
        selectedItems = items.map(it => ({
            productId: it.product_id,
            code: it.products?.code || "—",
            name: it.products?.name || "—",
            unit: it.products?.unit || "pza",
            quantity: parseFloat(it.quantity)
        }));

        // Populate Fields
        document.getElementById("apartado-notes").value = master.notes || "";
        fillModalWarehouseOptions("edit");
        document.getElementById("apartado-warehouse").value = master.warehouse_id;
        document.getElementById("apartado-requisicion").value = master.requisicion || "";
        document.getElementById("apartado-pedido").value = master.pedido || "";
        onOriginWarehouseChange(); // recalculate dynamic destination select options

        const destinationVal = master.project_id || master.destination_warehouse_id || "";
        document.getElementById("apartado-destination").value = destinationVal;

        // Title
        document.getElementById("apartado-modal-title").textContent = `📦 Detalle de Apartado — ${master.folio}`;

        // Status Row
        document.getElementById("status-row").style.display = "grid";
        const badgeContainer = document.getElementById("apartado-status-badge-container");

        let badgeClass = "status-pendiente";
        let statusLabel = master.status;
        if (master.status === "PENDIENTE") {
            badgeClass = "status-pendiente";
            statusLabel = "Pendiente";
        } else if (master.status === "VERIFICANDO") {
            badgeClass = "status-verificando";
            statusLabel = "Verificando";
        } else if (master.status === "COMPLETADO") {
            badgeClass = "status-completado";
            statusLabel = "Completo";
        } else if (master.status === "CANCELADO") {
            badgeClass = "status-cancelado";
            statusLabel = "Cancelado";
        }
        badgeContainer.innerHTML = `<span class="status-badge ${badgeClass}">${statusLabel}</span>`;

        // Configure status selector visibility
        const statusSelect = document.getElementById("apartado-status-select");
        if (statusSelect) {
            statusSelect.value = master.status;
            if (master.status === "PENDIENTE" || master.status === "VERIFICANDO") {
                statusSelect.style.display = "inline-block";
            } else {
                statusSelect.style.display = "none";
            }
        }

        if (master.status === "COMPLETADO") {
            document.getElementById("exit-folio-container").style.display = "flex";
            document.getElementById("apartado-exit-folio").textContent = master.exit_folio || "—";
        } else {
            document.getElementById("exit-folio-container").style.display = "none";
        }

        // Modal Mode Configuration
        const container = document.getElementById("apartado-form-container");

        if (master.status === "PENDIENTE" || master.status === "VERIFICANDO") {
            currentModalMode = "edit";

            // Enable fields
            container.classList.remove("disabled-form");
            document.getElementById("apartado-warehouse").disabled = true; // Lock warehouse for all existing apartados
            document.getElementById("apartado-destination").disabled = false;
            document.getElementById("apartado-notes").disabled = false;
            document.getElementById("apartado-requisicion").disabled = false;
            document.getElementById("apartado-pedido").disabled = false;

            // Show edit sections
            document.getElementById("add-item-section").style.display = "block";
            document.getElementById("th-delete-header").style.display = "";

            // Buttons
            document.getElementById("btn-apartado-cancel").style.display = "inline-block";
            document.getElementById("btn-apartado-save").style.display = "inline-block";
            document.getElementById("btn-apartado-save").textContent = "Guardar Cambios";

            // "Generar Salida" visible for ADMIN and warehouse staff with packing plant access
            if (isAccessAllowed) {
                document.getElementById("btn-apartado-validate").style.display = "inline-block";
            } else {
                document.getElementById("btn-apartado-validate").style.display = "none";
            }
            document.getElementById("btn-apartado-reprint").style.display = "none";

        } else {
            // COMPLETADO or CANCELADO -> read-only
            currentModalMode = "view";

            // Disable fields
            container.classList.add("disabled-form");
            document.getElementById("apartado-warehouse").disabled = true;
            document.getElementById("apartado-destination").disabled = true;
            document.getElementById("apartado-notes").disabled = true;
            document.getElementById("apartado-requisicion").disabled = true;
            document.getElementById("apartado-pedido").disabled = true;

            // Hide edit sections
            document.getElementById("add-item-section").style.display = "none";
            document.getElementById("th-delete-header").style.display = "none";

            // Buttons
            document.getElementById("btn-apartado-cancel").style.display = "none";
            document.getElementById("btn-apartado-save").style.display = "none";
            document.getElementById("btn-apartado-validate").style.display = "none";

            if (master.status === "COMPLETADO") {
                document.getElementById("btn-apartado-reprint").style.display = "inline-block";
            } else {
                document.getElementById("btn-apartado-reprint").style.display = "none";
            }
        }

        document.getElementById("btn-apartado-print").style.display = "inline-block";
        await fetchModalStocks(master.warehouse_id);
        renderSelectedItems();
        Modal.open("modal-apartado");

    } catch (err) {
        console.error("Error abriendo detalle:", err);
        Toast.show("Error al cargar detalles del apartado", "error");
    }
};

// Cancel / Delete Apartado
window.cancelApartado = async function () {
    if (!currentApartadoId) return;

    if (!confirm("¿Estás seguro de que deseas cancelar este apartado? Esta acción no se puede deshacer.")) {
        return;
    }

    const btn = document.getElementById("btn-apartado-cancel");
    btn.disabled = true;

    try {
        const { error } = await db
            .from("apartados")
            .update({
                status: "CANCELADO",
                updated_at: new Date().toISOString()
            })
            .eq("id", currentApartadoId);

        if (error) throw error;

        Toast.show("Apartado cancelado correctamente", "success");
        closeApartadoModal();
        loadApartados();
    } catch (err) {
        console.error("Error cancelando apartado:", err);
        Toast.show("Error al cancelar: " + err.message, "error");
    } finally {
        btn.disabled = false;
    }
};

// Change Apartado Status manually
window.changeApartadoStatus = async function (newStatus) {
    if (!currentApartadoId) return;

    // If changing to COMPLETADO, trigger validation and exit generation flow
    if (newStatus === "COMPLETADO") {
        try {
            const { data: currentAp, error } = await db
                .from("apartados")
                .select("status")
                .eq("id", currentApartadoId)
                .single();

            if (!error && currentAp) {
                // Reset select dropdown value to current status in case validation is cancelled or fails
                document.getElementById("apartado-status-select").value = currentAp.status;
            }
        } catch (err) {
            console.error("Error retrieving current status:", err);
        }

        // Trigger exit generation
        validateAndGenerateExit();
        return;
    }

    const statusLabel = newStatus === "VERIFICANDO" ? "Verificando" : "Pendiente";
    if (!confirm(`¿Estás seguro de cambiar el estado del apartado a "${statusLabel}"?`)) {
        try {
            const { data: currentAp, error } = await db
                .from("apartados")
                .select("status")
                .eq("id", currentApartadoId)
                .single();

            if (!error && currentAp) {
                document.getElementById("apartado-status-select").value = currentAp.status;
            }
        } catch (err) {
            console.error("Error resetting status dropdown:", err);
        }
        return;
    }

    try {
        const { error } = await db
            .from("apartados")
            .update({
                status: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq("id", currentApartadoId);

        if (error) throw error;

        Toast.show("Estado actualizado correctamente", "success");
        openDetailModal(currentApartadoId);
        loadApartados();
    } catch (err) {
        console.error("Error al cambiar estado:", err);
        Toast.show("Error al cambiar estado: " + err.message, "error");
        
        // Reset dropdown
        try {
            const { data: currentAp, error: fetchErr } = await db
                .from("apartados")
                .select("status")
                .eq("id", currentApartadoId)
                .single();

            if (!fetchErr && currentAp) {
                document.getElementById("apartado-status-select").value = currentAp.status;
            }
        } catch (err2) {
            console.error("Error resetting status dropdown:", err2);
        }
    }
};

// ==========================================
// VALIDAR Y GENERAR SALIDA (VALIDACIÓN DE STOCK FÍSICO)
// ==========================================
window.validateAndGenerateExit = async function () {
    if (!currentApartadoId) return;

    // Client-side quick check using modalStocks to verify stock availability
    const insufficient = selectedItems.filter(item => {
        const stock = modalStocks[item.productId] ?? 0;
        return item.quantity > stock;
    });

    if (insufficient.length > 0) {
        const names = insufficient.map(it => it.name).join(", ");
        Toast.show(`No se puede generar la salida. Stock insuficiente para: ${names}`, "error");
        return;
    }

    // Double confirmation
    if (!confirm("¿Proceder con la validación física y registrar la salida definitiva? Esto descontará los insumos del almacén de origen.")) {
        return;
    }

    const btn = document.getElementById("btn-apartado-validate");
    btn.disabled = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Validando...`;

    try {
        // Fetch latest details to be completely safe
        const { data: master, error: mErr } = await db
            .from("apartados")
            .select("warehouse_id, project_id, destination_warehouse_id, folio, notes, requisicion, pedido")
            .eq("id", currentApartadoId)
            .single();

        if (mErr) throw mErr;

        // Validate warehouse stock levels for each item
        // Fetch stock for these products in the source warehouse
        const pIds = selectedItems.map(it => it.productId);
        const { data: stockRecords, error: sErr } = await db
            .from("inventory")
            .select("product_id, stock")
            .eq("warehouse_id", master.warehouse_id)
            .in("product_id", pIds);

        if (sErr) throw sErr;

        // Map stocks for quick lookup
        const stockMap = {};
        (stockRecords || []).forEach(r => {
            stockMap[r.product_id] = parseFloat(r.stock ?? 0);
        });

        // Verify stock availability
        const insufficientItems = [];
        selectedItems.forEach(item => {
            const currentStock = stockMap[item.productId] ?? 0;
            if (currentStock < item.quantity) {
                insufficientItems.push({
                    name: item.name,
                    stock: currentStock,
                    req: item.quantity
                });
            }
        });

        if (insufficientItems.length > 0) {
            const details = insufficientItems.map(it => `• ${it.name} (Stock: ${it.stock}, Solicitado: ${it.req})`).join("\n");
            throw new Error(`Stock insuficiente en almacén de origen para los siguientes productos:\n${details}`);
        }

        // Generar folio de salida
        const exitFolio = await getNextFolio("SAL");

        // Determine destination strings
        const whSelect = document.getElementById("apartado-warehouse");
        const warehouseName = whSelect?.selectedOptions?.[0]?.text || "Almacén";

        const destSelect = document.getElementById("apartado-destination");
        const destinationName = destSelect?.selectedOptions?.[0]?.text || "Sin destino";

        // Build Notes with folio and destination references
        const notes = document.getElementById("apartado-notes").value;
        let refNotes = `[Apartado: ${master.folio}]`;
        if (master.requisicion) refNotes += ` [Req: ${master.requisicion}]`;
        if (master.pedido) refNotes += ` [Ped: ${master.pedido}]`;
        const notesWithDestination = `${refNotes} [Folio: ${exitFolio}] ${notes || ""} | Destino: ${destinationName}`.trim();

        // Process exits one by one using standard RPC
        for (const item of selectedItems) {
            const { error } = await db.rpc("register_inventory_exit", {
                p_warehouse_id: master.warehouse_id,
                p_product_id: item.productId,
                p_project_id: master.project_id || null, // null if transferring to another warehouse
                p_quantity: item.quantity,
                p_user_id: user.id,
                p_notes: notesWithDestination
            });

            if (error) throw error;
        }

        // Update Apartado status to COMPLETADO
        const { error: updateError } = await db
            .from("apartados")
            .update({
                status: "COMPLETADO",
                validated_by: user.id,
                validated_at: new Date().toISOString(),
                exit_folio: exitFolio,
                updated_at: new Date().toISOString()
            })
            .eq("id", currentApartadoId);

        if (updateError) throw updateError;

        Toast.show("Salida registrada e inventario descontado con éxito", "success");

        // Generate PDF
        // Transform selectedItems array format to match pdf generator expectations
        const pdfItems = selectedItems.map(it => ({
            productId: it.productId,
            productCode: it.code,
            productName: it.name,
            productUnit: it.unit,
            quantity: it.quantity
        }));

        try {
            generateExitPDF(warehouseName, destinationName, notesWithDestination, pdfItems, user, exitFolio, master.requisicion, master.pedido);
        } catch (pdfErr) {
            console.error("[PDF Error]", pdfErr);
            Toast.show("Salida registrada. Error al generar PDF: " + pdfErr.message, "info");
        }

        closeApartadoModal();
        loadApartados();

    } catch (err) {
        console.error("Error al procesar la salida física:", err);
        alert(err.message || "Error al procesar la salida física.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Generar Salida";
    }
};

// Reprint receipt for validated/completed apartados
window.reprintApartadoExitPDF = async function () {
    if (!currentApartadoId) return;

    try {
        // Fetch Master Data
        const { data: master, error: mErr } = await db
            .from("apartados")
            .select("warehouse_id, project_id, destination_warehouse_id, folio, notes, exit_folio, requisicion, pedido")
            .eq("id", currentApartadoId)
            .single();

        if (mErr) throw mErr;

        if (!master.exit_folio) {
            Toast.show("Este apartado no cuenta con folio de salida registrado", "error");
            return;
        }

        // Fetch Warehouse Origin Name
        const { data: originWh } = await db.from("warehouses").select("name").eq("id", master.warehouse_id).single();
        const warehouseName = originWh?.name || "Almacén";

        // Fetch Destination Name
        let destinationName = "Sin destino";
        if (master.project_id) {
            const { data: proj } = await db.from("projects").select("name").eq("id", master.project_id).single();
            destinationName = proj?.name || "Obra";
        } else if (master.destination_warehouse_id) {
            const { data: destWh } = await db.from("warehouses").select("name").eq("id", master.destination_warehouse_id).single();
            destinationName = destWh?.name || "Almacén Destino";
        }

        let refNotes = `[Apartado: ${master.folio}]`;
        if (master.requisicion) refNotes += ` [Req: ${master.requisicion}]`;
        if (master.pedido) refNotes += ` [Ped: ${master.pedido}]`;
        const notesWithDestination = `${refNotes} [Folio: ${master.exit_folio}] ${master.notes || ""} | Destino: ${destinationName}`.trim();

        // Format PDF Items
        const pdfItems = selectedItems.map(it => ({
            productId: it.productId,
            productCode: it.code,
            productName: it.name,
            productUnit: it.unit,
            quantity: it.quantity
        }));

        generateExitPDF(warehouseName, destinationName, notesWithDestination, pdfItems, user, master.exit_folio, master.requisicion, master.pedido);
        Toast.show("Vale de salida reimpreso correctamente", "success");

    } catch (err) {
        console.error("Error al reimprimir:", err);
        Toast.show("Error al reimprimir PDF: " + err.message, "error");
    }
};

// Generar e Imprimir PDF del Apartado (Voucher de apartado sin validar/completado/cualquiera)
window.printApartadoPDF = async function () {
    if (!currentApartadoId) return;

    try {
        // Fetch Master Data
        const { data: master, error: mErr } = await db
            .from("apartados")
            .select("warehouse_id, project_id, destination_warehouse_id, folio, status, notes, created_at, created_by, exit_folio, requisicion, pedido")
            .eq("id", currentApartadoId)
            .single();

        if (mErr) throw mErr;

        // Fetch Warehouse Origin Name
        const { data: originWh } = await db.from("warehouses").select("name").eq("id", master.warehouse_id).single();
        const warehouseName = originWh?.name || "Almacén";

        // Fetch Destination Name
        let destinationName = "Sin destino";
        if (master.project_id) {
            const { data: proj } = await db.from("projects").select("name").eq("id", master.project_id).single();
            destinationName = proj?.name || "Obra";
        } else if (master.destination_warehouse_id) {
            const { data: destWh } = await db.from("warehouses").select("name").eq("id", master.destination_warehouse_id).single();
            destinationName = destWh?.name || "Almacén Destino";
        }

        // Fetch Creator Name
        const { data: creatorUser } = await db.from("users").select("full_name").eq("id", master.created_by).single();
        const creatorName = creatorUser?.full_name || "Usuario";

        // Format PDF Items
        const pdfItems = selectedItems.map(it => ({
            productCode: it.code,
            productName: it.name,
            productUnit: it.unit,
            quantity: it.quantity
        }));

        // Generate Apartado PDF (If it was PENDIENTE, the printout will show VERIFICANDO)
        let printedStatus = master.status;
        if (master.status === "PENDIENTE") {
            printedStatus = "VERIFICANDO";
        }

        generateApartadoPDF(warehouseName, destinationName, master.notes, pdfItems, creatorName, master.folio, printedStatus, master.created_at, master.exit_folio, master.requisicion, master.pedido);
        Toast.show("PDF de apartado generado correctamente", "success");

        // Automatically change status to VERIFICANDO if it was PENDIENTE
        if (master.status === "PENDIENTE") {
            const { error: updateError } = await db
                .from("apartados")
                .update({
                    status: "VERIFICANDO",
                    updated_at: new Date().toISOString()
                })
                .eq("id", currentApartadoId);

            if (!updateError) {
                loadApartados();
                openDetailModal(currentApartadoId);
            }
        }

    } catch (err) {
        console.error("Error al generar PDF de apartado:", err);
        Toast.show("Error al generar PDF: " + err.message, "error");
    }
};

// Generador de PDF de Apartado
function generateApartadoPDF(warehouseName, projectName, notes, items, creatorName, folio, status, createdAt, exitFolio, requisicion, pedido) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error("La librería jsPDF no está disponible.");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    if (typeof doc.autoTable !== "function") {
        throw new Error("El plugin AutoTable no cargó correctamente.");
    }

    const primaryColor = [26, 101, 168]; // Azul distintivo para Apartados
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
    doc.text("SISTEMA DE CONTROL DE INVENTARIOS - VALE DE APARTADO", 15, 26);

    // FOLIO en cabecera
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...primaryColor);
    doc.text("FOLIO:", 148, 14);
    doc.setFontSize(11);
    doc.text(folio || "—", 160, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFillColor(...primaryColor);
    doc.rect(15, 29, 180, 1.2, 'F');

    // TITLE
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("VALE DE APARTADO / RESERVA DE MATERIALES", 15, 48);

    // INFO GENERAL
    doc.setFontSize(9.5);
    let y = 58;

    doc.setFont("helvetica", "bold");
    doc.text("Folio Apartado:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(26, 101, 168);
    doc.text(folio || "—", 45, y);
    doc.setTextColor(...darkColor);

    doc.setFont("helvetica", "bold");
    doc.text("Almacén Origen:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(warehouseName || "-", 145, y);

    y += 6;

    const dateStr = createdAt ? new Date(createdAt).toLocaleString("es-MX") : "—";
    doc.setFont("helvetica", "bold");
    doc.text("Fecha Registro:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(dateStr, 45, y);

    doc.setFont("helvetica", "bold");
    doc.text("Destino / Obra:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(projectName || "Sin tipo de salida", 145, y);

    y += 6;

    doc.setFont("helvetica", "bold");
    doc.text("Creado Por:", 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(creatorName, 45, y);

    doc.setFont("helvetica", "bold");
    doc.text("Estado:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(status, 145, y);

    if (exitFolio) {
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Folio Salida:", 110, y);
        doc.setFont("helvetica", "normal");
        doc.text(exitFolio, 145, y);
    }

    if (requisicion || pedido) {
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Requisición:", 15, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(requisicion || "—"), 45, y);

        doc.setFont("helvetica", "bold");
        doc.text("Pedido:", 110, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(pedido || "—"), 145, y);
    }

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

    // TABLA DE ITEMS
    const tableHeaders = [["Código", "Insumo / Descripción", "Unidad", "Cantidad"]];
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
            fillColor: primaryColor,
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9
        },
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 105 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20, halign: 'right' }
        },
        margin: { left: 15, right: 15 }
    });

    let finalY = 150;
    if (doc.lastAutoTable && doc.lastAutoTable.finalY) {
        finalY = doc.lastAutoTable.finalY + 25;
    }

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
    doc.text("SOLICITÓ (APARTADO)", 60, finalY + 4, { align: "center" });
    doc.text("AUTORIZA (ALMACÉN)", 150, finalY + 4, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(creatorName, 60, finalY + 8, { align: "center" });
    doc.text(warehouseName, 150, finalY + 8, { align: "center" });

    // GUARDAR ARCHIVO
    const fileDateStr = new Date().toISOString().slice(0, 10);
    const folioSlug = (folio || "SN").replace(/[^a-zA-Z0-9-_]/g, "-");
    doc.save(`vale_apartado_${folioSlug}_${fileDateStr}.pdf`);
}

// Shared PDF Generator
function generateExitPDF(warehouseName, projectName, notes, items, user, folio, requisicion, pedido) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error("La librería jsPDF no está disponible.");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    if (typeof doc.autoTable !== "function") {
        throw new Error("El plugin AutoTable no cargó correctamente.");
    }

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

    // FOLIO on header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(245, 196, 0);
    doc.text("FOLIO:", 148, 14);
    doc.setFontSize(11);
    doc.text(folio || "—", 160, 14);

    doc.setTextColor(255, 255, 255);
    doc.setFillColor(...primaryColor);
    doc.rect(15, 29, 180, 1.2, 'F');

    // TITLE
    doc.setTextColor(...darkColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("COMPROBANTE OFICIAL DE SALIDA DE MATERIALES", 15, 48);

    // INFO GENERAL
    doc.setFontSize(9.5);
    let y = 58;

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

    if (requisicion || pedido) {
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Requisición:", 15, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(requisicion || "—"), 45, y);

        doc.setFont("helvetica", "bold");
        doc.text("Pedido:", 110, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(pedido || "—"), 145, y);
    }

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

    // TABLE ITEMS
    const tableHeaders = [["Código", "Insumo / Descripción", "Unidad", "Cantidad"]];
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
        bodyStyles: { fontSize: 8.5 },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
            0: { cellWidth: 35 },
            1: { cellWidth: 105 },
            2: { cellWidth: 25 },
            3: { cellWidth: 20, halign: 'right' }
        },
        margin: { left: 15, right: 15 }
    });

    let finalY = 150;
    if (doc.lastAutoTable && doc.lastAutoTable.finalY) {
        finalY = doc.lastAutoTable.finalY + 25;
    }

    if (finalY > 255) {
        doc.addPage();
        finalY = 40;
    }

    // SIGNATURE LINES
    doc.setDrawColor(200, 200, 200);
    doc.line(30, finalY, 90, finalY);
    doc.line(120, finalY, 180, finalY);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text("ENTREGÓ (ALMACÉN)", 60, finalY + 4, { align: "center" });
    doc.text("RECIBIÓ (OBRA)", 150, finalY + 4, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(user.full_name || "Almacén", 60, finalY + 8, { align: "center" });
    doc.text(projectName || "Responsable de Obra", 150, finalY + 8, { align: "center" });

    // SAVE FILE
    const dateStr = new Date().toISOString().slice(0, 10);
    const folioSlug = (folio || "SN").replace(/[^a-zA-Z0-9-_]/g, "-");
    doc.save(`vale_salida_${folioSlug}_${dateStr}.pdf`);
}

// Shared Folio counter
async function getNextFolio(type) {
    const { data, error } = await db.rpc("get_next_folio", { p_tipo: type });
    if (error) {
        console.error("[Folio Error]", error);
        throw new Error("No se pudo generar el folio de salida: " + error.message);
    }
    return data;
}