

const user = Auth.requireAuth();
const allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

if (user) {
  renderSidebar("nav-dashboard");

  // Fecha
  document.getElementById("topbar-date").textContent = new Date().toLocaleDateString("es-MX", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  // Bienvenida
  document.getElementById("welcome-name").textContent = user.full_name;
  document.getElementById("welcome-role").innerHTML = roleBadge(user.role);

  loadDashboard();
}

async function loadDashboard() {
  // Construir query de inventario según rol
  let invQuery = db.from("inventory").select("stock, stock_status, warehouse_id");
  let movQuery = db.from("inventory_movements")
    .select("movement_type, quantity, created_at, products(name), warehouse_id")
    .order("created_at", { ascending: false })
    .limit(8);

  // STOREKEEPER: filtrar por sus almacenes
  if (isRestricted && allowedWarehouseIds.length > 0) {
    invQuery = invQuery.in("warehouse_id", allowedWarehouseIds);
    movQuery = movQuery.in("warehouse_id", allowedWarehouseIds);
  } else if (isRestricted && allowedWarehouseIds.length === 0) {
    // Sin almacén asignado
    renderEmptyDashboard();
    return;
  }

  const [invRes, movRes] = await Promise.all([invQuery, movQuery]);

  const inv = invRes.data || [];

  // Stats — STOREKEEPER ve solo su alcance, ADMIN/SUPERVISOR ven todo
  let statsExtra = {};
  if (!isRestricted) {
    const [prodRes, warehRes, totalMovRes] = await Promise.all([
      db.from("products").select("id", { count: "exact" }).eq("is_active", true),
      db.from("warehouses").select("id", { count: "exact" }).eq("is_active", true),
      db.from("inventory_movements").select("id", { count: "exact" }),
    ]);
    statsExtra = {
      totalProducts: prodRes.count || 0,
      totalWarehouses: warehRes.count || 0,
      totalMovements: totalMovRes.count || 0,
    };
  }

  const lowCount = inv.filter(i => i.stock_status === "LOW").length;
  const outCount = inv.filter(i => i.stock_status === "OUT").length;
  const totalStock = inv.reduce((s, i) => s + (i.stock || 0), 0);

  // Renderizar stats según rol
  if (isRestricted) {
    document.getElementById("stats-grid").innerHTML = `
        <div class="stat-card green">
          <div class="stat-label">Unidades en tu Almacén</div>
          <div class="stat-value">${fmt.number(totalStock)}</div>
          <div class="stat-sub">Stock total asignado</div>
        </div>
        <div class="stat-card orange">
          <div class="stat-label">Stock Bajo</div>
          <div class="stat-value">${lowCount}</div>
          <div class="stat-sub">Requieren atención</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">Agotados</div>
          <div class="stat-value">${outCount}</div>
          <div class="stat-sub">Sin existencias</div>
        </div>
      `;
  } else {
    document.getElementById("stats-grid").innerHTML = `
        <div class="stat-card">
          <div class="stat-label">Productos Activos</div>
          <div class="stat-value">${statsExtra.totalProducts}</div>
          <div class="stat-sub">${statsExtra.totalWarehouses} almacén(es)</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Unidades en Stock</div>
          <div class="stat-value">${fmt.number(totalStock)}</div>
          <div class="stat-sub">Total general</div>
        </div>
        <div class="stat-card orange">
          <div class="stat-label">Stock Bajo</div>
          <div class="stat-value">${lowCount}</div>
          <div class="stat-sub">Requieren atención</div>
        </div>
        <div class="stat-card red">
          <div class="stat-label">Agotados</div>
          <div class="stat-value">${outCount}</div>
          <div class="stat-sub">Sin existencias</div>
        </div>
      `;
  }

  // Alertas de stock bajo — filtradas por almacén si es STOREKEEPER
  let lowQuery = db
    .from("dashboard_inventory_summary")
    .select("*")
    .in("stock_status", ["LOW", "OUT"])
    .order("stock", { ascending: true })
    .limit(8);

  if (isRestricted && allowedWarehouseIds.length > 0) {
    // La vista no expone warehouse_id directamente, usamos inventory con join
    const { data: lowRaw } = await db
      .from("inventory")
      .select("stock, stock_status, products(name, code), warehouses(name)")
      .in("stock_status", ["LOW", "OUT"])
      .in("warehouse_id", allowedWarehouseIds)
      .order("stock", { ascending: true })
      .limit(8);

    const lowBody = document.getElementById("low-stock-body");
    if (!lowRaw || !lowRaw.length) {
      lowBody.innerHTML = emptyRow(4, "Sin alertas de stock 🎉");
    } else {
      lowBody.innerHTML = lowRaw.map(r => `
          <tr>
            <td><span class="fw-600">${r.products?.name || "—"}</span><br/>
                <span class="code-cell">${r.products?.code || ""}</span></td>
            <td class="text-muted">${r.warehouses?.name || "—"}</td>
            <td class="text-mono fw-600">${r.stock}</td>
            <td>${stockBadge(r.stock_status)}</td>
          </tr>
        `).join("");
    }
  } else {
    const { data: lowItems } = await lowQuery;
    const lowBody = document.getElementById("low-stock-body");
    if (!lowItems || !lowItems.length) {
      lowBody.innerHTML = emptyRow(4, "Sin alertas de stock 🎉");
    } else {
      lowBody.innerHTML = lowItems.map(r => `
          <tr>
            <td><span class="fw-600">${r.product_name}</span><br/>
                <span class="code-cell">${r.product_code}</span></td>
            <td class="text-muted">${r.warehouse_name}</td>
            <td class="text-mono fw-600">${r.stock}</td>
            <td>${stockBadge(r.stock_status)}</td>
          </tr>
        `).join("");
    }
  }

  // Últimos movimientos
  const movs = movRes.data || [];
  const movBody = document.getElementById("movements-body");
  if (!movs.length) {
    movBody.innerHTML = emptyRow(4, "Sin movimientos registrados");
  } else {
    movBody.innerHTML = movs.map(m => `
        <tr>
          <td>${movBadge(m.movement_type)}</td>
          <td class="fw-600">${m.products?.name || "—"}</td>
          <td class="text-mono">${m.quantity}</td>
          <td class="text-muted">${fmt.datetime(m.created_at)}</td>
        </tr>
      `).join("");
  }
}

function renderEmptyDashboard() {
  document.getElementById("stats-grid").innerHTML = `
      <div class="stat-card" style="grid-column:1/-1;">
        <div class="stat-label">Sin almacén asignado</div>
        <div class="stat-sub">Contacta al administrador para que te asigne un almacén.</div>
      </div>`;
  document.getElementById("low-stock-body").innerHTML = emptyRow(4, "Sin almacén asignado");
  document.getElementById("movements-body").innerHTML = emptyRow(4, "Sin almacén asignado");
}


