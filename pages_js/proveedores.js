
const user = Auth.requireAuth();
const canEdit = Auth.isAdmin() || Auth.isSupervisor() || Auth.isCoordinador();
let allData = [];

if (user) {
    renderSidebar("nav-suppliers");

    if (canEdit) {
        document.getElementById("btn-new-supplier").style.display = "";
    } else {
        document.getElementById("readonly-notice").style.display = "block";
        document.getElementById("actions-col").style.display = "none";
    }

    loadSuppliers();
}

async function loadSuppliers() {
    const tbody = document.getElementById("suppliers-body");
    tbody.innerHTML = loadingRow(6);

    const { data, error } = await db.from("suppliers").select("*").order("company_name");
    if (error) { tbody.innerHTML = emptyRow(6, "Error cargando datos"); return; }
    allData = data || [];
    renderTable(allData);
}

function renderTable(data) {
    const tbody = document.getElementById("suppliers-body");
    document.getElementById("record-count").textContent = `${data.length} proveedor(es)`;
    if (!data.length) { tbody.innerHTML = emptyRow(6, "Sin proveedores registrados"); return; }

    tbody.innerHTML = data.map(s => {
        const editCell = canEdit
            ? `<td><button class="btn btn-ghost btn-sm" onclick="openEdit(${JSON.stringify(s).replace(/"/g, '&quot;')})">Editar</button></td>`
            : `<td></td>`;
        return `
        <tr>
          <td class="fw-600">${s.company_name}</td>
          <td class="text-muted">${s.contact_name || "—"}</td>
          <td class="text-muted">${s.phone || "—"}</td>
          <td class="text-muted">${s.email || "—"}</td>
          <td class="text-muted">${fmt.date(s.created_at)}</td>
          ${editCell}
        </tr>
      `;
    }).join("");
}

document.getElementById("search-input").addEventListener("input", () => {
    const q = document.getElementById("search-input").value.toLowerCase();
    renderTable(allData.filter(s =>
        s.company_name.toLowerCase().includes(q) ||
        (s.contact_name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q)
    ));
});

function openCreate() {
    if (!canEdit) { Toast.show("Sin permiso para crear proveedores", "error"); return; }
    document.getElementById("modal-title").textContent = "Nuevo Proveedor";
    ["sup-id", "sup-company", "sup-contact", "sup-phone", "sup-email", "sup-address"]
        .forEach(id => document.getElementById(id).value = "");
    Modal.open("modal-supplier");
}

function openEdit(s) {
    if (!canEdit) { Toast.show("Sin permiso para editar proveedores", "error"); return; }
    document.getElementById("modal-title").textContent = "Editar Proveedor";
    document.getElementById("sup-id").value = s.id;
    document.getElementById("sup-company").value = s.company_name;
    document.getElementById("sup-contact").value = s.contact_name || "";
    document.getElementById("sup-phone").value = s.phone || "";
    document.getElementById("sup-email").value = s.email || "";
    document.getElementById("sup-address").value = s.address || "";
    Modal.open("modal-supplier");
}

document.getElementById("btn-sup-save").addEventListener("click", async () => {
    if (!canEdit) { Toast.show("Sin permiso", "error"); return; }

    const id = document.getElementById("sup-id").value;
    const company = document.getElementById("sup-company").value.trim();
    if (!company) { Toast.show("El nombre de empresa es obligatorio", "error"); return; }

    const payload = {
        company_name: company,
        contact_name: document.getElementById("sup-contact").value.trim() || null,
        phone: document.getElementById("sup-phone").value.trim() || null,
        email: document.getElementById("sup-email").value.trim() || null,
        address: document.getElementById("sup-address").value.trim() || null,
    };

    const btn = document.getElementById("btn-sup-save");
    btn.disabled = true; btn.textContent = "Guardando...";

    try {
        let error;
        if (id) {
            ({ error } = await db.from("suppliers").update(payload).eq("id", id));
        } else {
            ({ error } = await db.from("suppliers").insert(payload));
        }
        if (error) throw error;
        Toast.show(id ? "Proveedor actualizado" : "Proveedor creado", "success");
        Modal.close("modal-supplier");
        loadSuppliers();
    } catch (err) {
        Toast.show(err.message || "Error al guardar", "error");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
});
