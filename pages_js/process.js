
const user = Auth.requireAuth();
let allData = [];

if (user) { renderSidebar("nav-projects"); loadProjects(); }

async function loadProjects() {
    const tbody = document.getElementById("projects-body");
    tbody.innerHTML = loadingRow(7);
    let data;
    try {
        data = await fetchAll((from, to) =>
            db.from("projects").select("*").order("name").range(from, to)
        );
    } catch (e) { tbody.innerHTML = emptyRow(7, "Error cargando datos"); return; }
    allData = data || [];
    renderTable(allData);
}

function renderTable(data) {
    const tbody = document.getElementById("projects-body");
    document.getElementById("record-count").textContent = `${data.length} proyecto(s)`;
    if (!data.length) { tbody.innerHTML = emptyRow(7, "Sin proyectos registrados"); return; }
    tbody.innerHTML = data.map(p => `
      <tr style="${!p.is_active ? 'opacity:0.5;' : ''}">
        <td class="code-cell">${p.code}</td>
        <td class="fw-600">${p.name}</td>
        <td class="text-muted">${p.supervisor_name || "—"}</td>
        <td class="text-muted" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.address || "—"}</td>
        <td>${p.is_active ? '<span class="badge badge-normal">Activo</span>' : '<span class="badge badge-out">Inactivo</span>'}</td>
        <td class="text-muted">${fmt.date(p.created_at)}</td>
        <td>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" onclick="openEdit(${JSON.stringify(p).replace(/"/g, '&quot;')})">Editar</button>
            <button class="btn btn-ghost btn-sm" style="color:${p.is_active ? 'var(--red)' : 'var(--green)'};"
              onclick="toggleActive('${p.id}', ${p.is_active})">${p.is_active ? "Cerrar" : "Abrir"}</button>
          </div>
        </td>
      </tr>
    `).join("");
}

document.getElementById("search-input").addEventListener("input", () => {
    const q = document.getElementById("search-input").value.toLowerCase();
    renderTable(allData.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)));
});

function openCreate() {
    document.getElementById("modal-title").textContent = "Nuevo Proyecto";
    ["proj-id", "proj-code", "proj-name", "proj-supervisor", "proj-address"].forEach(id => document.getElementById(id).value = "");
    Modal.open("modal-project");
}

function openEdit(p) {
    document.getElementById("modal-title").textContent = "Editar Proyecto";
    document.getElementById("proj-id").value = p.id;
    document.getElementById("proj-code").value = p.code;
    document.getElementById("proj-name").value = p.name;
    document.getElementById("proj-supervisor").value = p.supervisor_name || "";
    document.getElementById("proj-address").value = p.address || "";
    Modal.open("modal-project");
}

document.getElementById("btn-proj-save").addEventListener("click", async () => {
    const id = document.getElementById("proj-id").value;
    const code = document.getElementById("proj-code").value.trim();
    const name = document.getElementById("proj-name").value.trim();
    if (!code || !name) { Toast.show("Código y nombre son obligatorios", "error"); return; }

    const payload = {
        code,
        name,
        supervisor_name: document.getElementById("proj-supervisor").value.trim() || null,
        address: document.getElementById("proj-address").value.trim() || null,
    };

    const btn = document.getElementById("btn-proj-save");
    btn.disabled = true; btn.textContent = "Guardando...";
    try {
        let error;
        if (id) {
            ({ error } = await db.from("projects").update(payload).eq("id", id));
        } else {
            ({ error } = await db.from("projects").insert(payload));
        }
        if (error) throw error;
        Toast.show(id ? "Proyecto actualizado" : "Proyecto creado", "success");
        Modal.close("modal-project");
        loadProjects();
    } catch (err) {
        Toast.show(err.message || "Error al guardar", "error");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
});

async function toggleActive(id, current) {
    const { error } = await db.from("projects").update({ is_active: !current }).eq("id", id);
    if (error) { Toast.show(error.message, "error"); return; }
    Toast.show("Proyecto actualizado", "success");
    loadProjects();
}