
const user = Auth.requireAuth();
if (user && !Auth.hasRole("ADMIN")) { window.location.href = "dashboard.html"; }

let allData = [];
let warehouses = [];

if (user) { renderSidebar("nav-users"); loadAll(); }

// ── Cambiar selector de almacén según el rol seleccionado ──
function onRoleChange(role) {
    const singleWrap = document.getElementById("warehouse-single-wrap");
    const multiWrap = document.getElementById("warehouse-multi-wrap");
    const multiSpan = document.getElementById("wh-multi-span");
    const multiNote = document.getElementById("wh-multi-note");
    if (role === "SUPERVISOR" || role === "ALMACENISTA") {
        singleWrap.style.display = "none";
        multiWrap.style.display = "block";
        if (multiSpan) {
            multiSpan.textContent = role === "SUPERVISOR" ? "(solo lectura en inventario)" : "(con permisos de escritura)";
        }
        if (multiNote) {
            multiNote.textContent = role === "SUPERVISOR" ? "Sin selección = acceso a todos los almacenes" : "Sin selección = sin acceso a almacenes";
        }
    } else {
        singleWrap.style.display = "block";
        multiWrap.style.display = "none";
    }
}

// ── Construir checkboxes de almacenes para SUPERVISOR ──
function buildWarehouseCheckboxes(selectedIds = []) {
    const container = document.getElementById("wh-checkboxes-list");
    if (!warehouses.length) {
        container.innerHTML = '<span style="color:var(--gray-light);font-size:0.8rem;">No hay almacenes activos</span>';
        return;
    }
    container.innerHTML = warehouses.map(w => `
      <label>
        <input type="checkbox" name="wh-check" value="${w.id}"
          ${selectedIds.includes(w.id) ? "checked" : ""}>
        ${w.name}
      </label>
    `).join("");
}

// ── Obtener IDs de almacenes seleccionados en el multi-selector ──
function getSelectedWarehouseIds() {
    return Array.from(
        document.querySelectorAll('#wh-checkboxes-list input[name="wh-check"]:checked')
    ).map(el => el.value);
}

async function loadAll() {
    const { data: whs } = await db.from("warehouses").select("id,name").eq("is_active", true);
    warehouses = whs || [];

    // Select único (STOREKEEPER/ADMIN)
    const whSelect = document.getElementById("user-warehouse");
    let whSelectHtml = '<option value="">Sin almacén</option>';
    warehouses.forEach(w => {
        whSelectHtml += `<option value="${w.id}">${w.name}</option>`;
    });
    whSelect.innerHTML = whSelectHtml;

    buildWarehouseCheckboxes([]);
    loadUsers();
}

async function loadUsers() {
    const tbody = document.getElementById("users-body");
    tbody.innerHTML = loadingRow(8);

    let res = await db
        .from("users")
        .select("id, full_name, email, role, phone, warehouse_id, allowed_warehouses, is_active, created_at, warehouses(name)")
        .order("full_name");

    if (res.error) {
        console.warn("[users] Falló consulta con FK warehouses, reintentando sin FK...", res.error.message);
        res = await db
            .from("users")
            .select("id, full_name, email, role, phone, warehouse_id, allowed_warehouses, is_active, created_at")
            .order("full_name");
    }

    if (res.error) {
        console.warn("[users] Falló consulta con allowed_warehouses, reintentando consulta básica...", res.error.message);
        res = await db
            .from("users")
            .select("id, full_name, email, role, phone, warehouse_id, is_active, created_at")
            .order("full_name");
        if (res.data) {
            res.data = res.data.map(u => ({ ...u, allowed_warehouses: null }));
        }
    }

    if (res.error) {
        console.error("[users] Error final cargando usuarios:", res.error);
        tbody.innerHTML = emptyRow(8, "Error cargando datos: " + (res.error.message || ""));
        return;
    }

    allData = res.data || [];

    // Consultar la tabla relacional user_warehouses para combinar los almacenes asignados
    try {
        const { data: uwAll } = await db
            .from("user_warehouses")
            .select("user_id, warehouse_id, warehouses(name)");

        if (uwAll && uwAll.length > 0) {
            allData = allData.map(u => {
                const userRows = uwAll.filter(r => r.user_id === u.id);
                if (userRows.length > 0) {
                    const allowed = userRows.map(r => r.warehouse_id);
                    return {
                        ...u,
                        allowed_warehouses: allowed,
                        warehouse_id: allowed[0] || u.warehouse_id
                    };
                }
                return u;
            });
        }
    } catch (e) {
        console.warn("[users] user_warehouses no disponible para tabla:", e);
    }

    renderTable(allData);
}

function warehouseCellHtml(u) {
    if (u.role === "SUPERVISOR" || u.role === "ALMACENISTA") {
        const ids = u.allowed_warehouses || [];
        if (!ids.length) {
            if (u.warehouse_id) {
                const whName = u.warehouses?.name || warehouses.find(w => w.id === u.warehouse_id)?.name || "—";
                return `<span class="text-muted">${whName}</span>`;
            }
            return u.role === "SUPERVISOR"
                ? '<span class="text-muted">Todos</span>'
                : '<span class="text-muted">—</span>';
        }
        const names = ids.map(id => {
            const wh = warehouses.find(w => w.id === id);
            return wh ? wh.name : id;
        });
        return `<div class="wh-badge-list">${names.map(n => `<span class="wh-badge">${n}</span>`).join("")}</div>`;
    }
    const whName = u.warehouses?.name || warehouses.find(w => w.id === u.warehouse_id)?.name || "—";
    return `<span class="text-muted">${whName}</span>`;
}

function renderTable(data) {
    const tbody = document.getElementById("users-body");
    document.getElementById("record-count").textContent = `${data.length} usuario(s)`;
    if (!data.length) { tbody.innerHTML = emptyRow(8, "Sin usuarios registrados"); return; }

    tbody.innerHTML = data.map((u) => {
        const allDataIdx = allData.findIndex(r => r.id === u.id);
        return `
      <tr style="${!u.is_active ? 'opacity:0.5;' : ''}">
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="user-avatar" style="width:28px;height:28px;font-size:0.65rem;">${initials(u.full_name)}</div>
            <span class="fw-600">${u.full_name}</span>
          </div>
        </td>
        <td class="text-muted">${u.email}</td>
        <td>${roleBadge(u.role)}</td>
        <td>${warehouseCellHtml(u)}</td>
        <td class="text-muted">${u.phone || "\u2014"}</td>
        <td>${u.is_active ? '<span class="badge badge-normal">Activo</span>' : '<span class="badge badge-out">Inactivo</span>'}</td>
        <td class="text-muted">${fmt.date(u.created_at)}</td>
        <td>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" onclick="openEdit(${allDataIdx})">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:${u.is_active ? 'var(--red)' : 'var(--green)'};"
              onclick="toggleActive('${u.id}', ${u.is_active})">${u.is_active ? "Desact." : "Activar"}</button>
          </div>
        </td>
      </tr>
    `;
    }).join("");
}

document.getElementById("search-input").addEventListener("input", () => {
    const q = document.getElementById("search-input").value.toLowerCase();
    renderTable(allData.filter(u =>
        u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    ));
});

function openCreate() {
    document.getElementById("modal-title").textContent = "Nuevo Usuario";
    ["user-id", "user-name", "user-email", "user-phone", "user-password"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("user-role").value = "ALMACENISTA";
    document.getElementById("user-warehouse").value = "";
    document.getElementById("pass-hint").textContent = "(requerida para nuevo)";
    onRoleChange("ALMACENISTA");
    buildWarehouseCheckboxes([]);
    Modal.open("modal-user");
}

function openEdit(idx) {
    const u = allData[idx];
    if (!u) return;
    document.getElementById("modal-title").textContent = "Editar Usuario";
    document.getElementById("user-id").value = u.id;
    document.getElementById("user-name").value = u.full_name;
    document.getElementById("user-email").value = u.email;
    document.getElementById("user-role").value = u.role;
    document.getElementById("user-warehouse").value = u.warehouse_id || "";
    document.getElementById("user-phone").value = u.phone || "";
    document.getElementById("user-password").value = "";
    document.getElementById("pass-hint").textContent = "(dejar vac\u00edo para no cambiar)";

    onRoleChange(u.role);
    if (u.role === "SUPERVISOR" || u.role === "ALMACENISTA") {
        buildWarehouseCheckboxes(u.allowed_warehouses || []);
    }

    Modal.open("modal-user");
}

document.getElementById("btn-user-save").addEventListener("click", async () => {
    const id = document.getElementById("user-id").value;
    const fullName = document.getElementById("user-name").value.trim();
    const email = document.getElementById("user-email").value.trim();
    const role = document.getElementById("user-role").value;
    const phone = document.getElementById("user-phone").value.trim() || null;
    const password = document.getElementById("user-password").value;

    if (!fullName || !email) { Toast.show("Nombre y email son obligatorios", "error"); return; }
    if (!id && !password) { Toast.show("La contraseña es requerida para usuarios nuevos", "error"); return; }

    let payload = { full_name: fullName, email, role, phone };

    let selectedWhs = [];
    if (role === "SUPERVISOR" || role === "ALMACENISTA") {
        selectedWhs = getSelectedWarehouseIds();
        payload.allowed_warehouses = selectedWhs.length > 0 ? selectedWhs : null;
        payload.warehouse_id = null;
    } else {
        const warehouseId = document.getElementById("user-warehouse").value || null;
        if (warehouseId) selectedWhs = [warehouseId];
        payload.warehouse_id = warehouseId;
        payload.allowed_warehouses = null;
    }

    // La contraseña NUNCA se manda directo a la tabla: se guarda aparte
    // mediante el RPC set_user_password, que genera el hash real con
    // pgcrypto del lado del servidor.

    const btn = document.getElementById("btn-user-save");
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
        let savedUser, error;
        if (id) {
            ({ data: savedUser, error } = await db.from("users").update(payload).eq("id", id).select().single());
            if (error && error.message && error.message.includes("allowed_warehouses")) {
                delete payload.allowed_warehouses;
                ({ data: savedUser, error } = await db.from("users").update(payload).eq("id", id).select().single());
            }
        } else {
            ({ data: savedUser, error } = await db.from("users").insert(payload).select().single());
            if (error && error.message && error.message.includes("allowed_warehouses")) {
                delete payload.allowed_warehouses;
                ({ data: savedUser, error } = await db.from("users").insert(payload).select().single());
            }
        }
        if (error) throw error;

        const targetUserId = id || (savedUser ? savedUser.id : null);

        // Si se escribió una contraseña, guardarla vía RPC (hash real en el servidor)
        if (password && targetUserId) {
            try {
                await Auth.setPassword(targetUserId, password);
            } catch (pwErr) {
                Toast.show(
                    (id ? "Usuario actualizado, pero " : "Usuario creado, pero ") +
                    "no se pudo guardar la contraseña: " + (pwErr.message || pwErr),
                    "error"
                );
            }
        }

        // Sincronizar en la nueva tabla relacional user_warehouses
        if (targetUserId) {
            try {
                // Eliminar asignaciones previas
                await db.from("user_warehouses").delete().eq("user_id", targetUserId);

                // Insertar nuevas asignaciones si existen almacenes seleccionados
                if (selectedWhs.length > 0) {
                    const uwPayload = selectedWhs.map(whId => ({
                        user_id: targetUserId,
                        warehouse_id: whId
                    }));
                    await db.from("user_warehouses").insert(uwPayload);
                }
            } catch (e) {
                console.warn("[users] Error al guardar en user_warehouses:", e);
            }
        }

        Toast.show(id ? "Usuario actualizado" : "Usuario creado", "success");
        Modal.close("modal-user");
        loadUsers();
    } catch (err) {
        Toast.show(err.message || "Error al guardar", "error");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
});

async function toggleActive(id, current) {
    const { error } = await db.from("users").update({ is_active: !current }).eq("id", id);
    if (error) { Toast.show(error.message, "error"); return; }
    Toast.show("Usuario actualizado", "success");
    loadUsers();
}