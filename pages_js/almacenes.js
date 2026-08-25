
const user = Auth.requireAuth();
const allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null; // STOREKEEPER

if (user) {
    renderSidebar("nav-warehouses");

    // Mostrar botón "Nuevo Almacén" solo a ADMIN
    if (Auth.isAdmin()) {
        document.getElementById("btn-new-warehouse").style.display = "";
    }



    loadWarehouses();
}

async function loadWarehouses() {
    const grid = document.getElementById("warehouses-grid");

    // STOREKEEPER: solo sus almacenes asignados
    if (isRestricted && allowedWarehouseIds.length === 0) {
        grid.innerHTML = `
        <div class="table-card" style="padding:32px; text-align:center; color:var(--gray-light);">
          <p>No tienes ningún almacén asignado.<br/>Contacta al administrador.</p>
        </div>`;
        return;
    }

    let data;
    try {
        data = await fetchAll((from, to) => {
            let q = db.from("warehouses")
                .select("*, inventory(stock, stock_status)")
                .order("name")
                .range(from, to);
            if (isRestricted && allowedWarehouseIds.length > 0)
                q = q.in("id", allowedWarehouseIds);
            return q;
        });
    } catch (e) {
        grid.innerHTML = `<p class="text-muted">Error cargando almacenes</p>`; return;
    }

    if (!data || !data.length) {
        grid.innerHTML = `<div class="stat-card"><div class="empty-state"><p>Sin almacenes registrados</p></div></div>`; return;
    }

    grid.innerHTML = data.map(w => {
        const totalStock = (w.inventory || []).reduce((s, i) => s + i.stock, 0);
        const lowCount = (w.inventory || []).filter(i => i.stock_status === "LOW").length;
        const outCount = (w.inventory || []).filter(i => i.stock_status === "OUT").length;

        // Botón Editar solo para ADMIN
        const editBtn = Auth.isAdmin()
            ? `<button class="btn btn-ghost btn-sm" onclick="openEdit(${JSON.stringify(w).replace(/"/g, '&quot;')})">Editar</button>`
            : "";

        return `
        <div class="table-card" style="padding:0;">
          <div style="padding:20px 22px; border-bottom:1px solid #efefef; display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-family:var(--font-mono); font-weight:700; font-size:1rem; margin-bottom:4px;">${w.name}</div>
              <div class="code-cell">${w.code}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center;">
              ${w.is_active
                ? '<span class="badge badge-normal">Activo</span>'
                : '<span class="badge badge-out">Inactivo</span>'}
              ${editBtn}
            </div>
          </div>
          <div style="padding:16px 22px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
            <div>
              <div class="stat-label">Unidades</div>
              <div style="font-family:var(--font-mono); font-size:1.4rem; font-weight:700;">${fmt.number(totalStock)}</div>
            </div>
            <div>
              <div class="stat-label">Stock Bajo</div>
              <div style="font-family:var(--font-mono); font-size:1.4rem; font-weight:700; color:var(--orange);">${lowCount}</div>
            </div>
            <div>
              <div class="stat-label">Agotados</div>
              <div style="font-family:var(--font-mono); font-size:1.4rem; font-weight:700; color:var(--red);">${outCount}</div>
            </div>
          </div>
          ${w.city
                ? `<div style="padding:0 22px 16px; font-size:0.8rem; color:var(--gray-light);">📍 ${w.city}${w.state ? ", " + w.state : ""}</div>`
                : ""}
        </div>
      `;
    }).join("");
}

function openCreate() {
    if (!Auth.isAdmin()) { Toast.show("Sin permiso", "error"); return; }
    document.getElementById("modal-title").textContent = "Nuevo Almacén";
    ["wh-id", "wh-name", "wh-code", "wh-city", "wh-state", "wh-address"].forEach(id =>
        document.getElementById(id).value = "");
    Modal.open("modal-warehouse");
}

function openEdit(w) {
    if (!Auth.isAdmin()) { Toast.show("Sin permiso", "error"); return; }
    document.getElementById("modal-title").textContent = "Editar Almacén";
    document.getElementById("wh-id").value = w.id;
    document.getElementById("wh-name").value = w.name;
    document.getElementById("wh-code").value = w.code;
    document.getElementById("wh-city").value = w.city || "";
    document.getElementById("wh-state").value = w.state || "";
    document.getElementById("wh-address").value = w.address || "";
    Modal.open("modal-warehouse");
}

document.getElementById("btn-wh-save").addEventListener("click", async () => {
    if (!Auth.isAdmin()) { Toast.show("Sin permiso", "error"); return; }

    const id = document.getElementById("wh-id").value;
    const name = document.getElementById("wh-name").value.trim();
    const code = document.getElementById("wh-code").value.trim();
    const city = document.getElementById("wh-city").value.trim() || null;
    const state = document.getElementById("wh-state").value.trim() || null;
    const address = document.getElementById("wh-address").value.trim() || null;

    if (!name || !code) { Toast.show("Nombre y código son obligatorios", "error"); return; }

    const btn = document.getElementById("btn-wh-save");
    btn.disabled = true; btn.textContent = "Guardando...";

    const payload = { name, code, city, state, address };
    try {
        let error;
        if (id) {
            ({ error } = await db.from("warehouses").update(payload).eq("id", id));
        } else {
            ({ error } = await db.from("warehouses").insert(payload));
        }
        if (error) throw error;
        Toast.show(id ? "Almacén actualizado" : "Almacén creado", "success");
        Modal.close("modal-warehouse");
        loadWarehouses();
    } catch (err) {
        Toast.show(err.message || "Error al guardar", "error");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
});