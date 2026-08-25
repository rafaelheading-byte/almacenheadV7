
const user = Auth.requireAuth();
// STOREKEEPER solo puede ver el catálogo
const canEdit = Auth.isAdmin() || Auth.isSupervisor() || Auth.isCoordinador();
let allData = [];

if (user) {
    renderSidebar("nav-products");

    if (canEdit) {
        document.getElementById("btn-new-product").style.display = "";
    } else {
        // STOREKEEPER: aviso de solo lectura, ocultar columna acciones
        document.getElementById("readonly-notice").style.display = "block";
        document.getElementById("actions-col").style.display = "none";
    }

    loadAll();
}

async function loadAll() {
    await Promise.all([loadProducts(), loadCategories()]);
}

async function loadCategories() {
    const { data } = await db.from("categories").select("id, name").order("name");
    const filterCat = document.getElementById("filter-category");
    const modalCat = document.getElementById("prod-category");

    let filterCatHtml = '<option value="">Todas las categorías</option>';
    let modalCatHtml = '<option value="">Sin categoría</option>';
    (data || []).forEach(c => {
        const option = `<option value="${c.id}">${c.name}</option>`;
        filterCatHtml += option;
        modalCatHtml += option;
    });
    filterCat.innerHTML = filterCatHtml;
    modalCat.innerHTML = modalCatHtml;
}

async function loadProducts() {
    const tbody = document.getElementById("products-body");
    tbody.innerHTML = loadingRow(8);

    const { data, error } = await db
        .from("products")
        .select(`
        id,
        code,
        name,
        description,
        unit,
        minimum_stock,
        image_url,
        is_active,
        created_at,
        category_id,
        categories:category_id (
          id,
          name
        )
      `)
        .order("name")

    console.log("PRODUCTS:", data);
    console.log("ERROR:", error);

    if (error) {
        console.error(error);
        tbody.innerHTML = emptyRow(8, error.message);
        return;
    }
    allData = data || [];
    renderTable(allData);
}

function renderTable(data) {
    const tbody = document.getElementById("products-body");
    document.getElementById("record-count").textContent = `${data.length} producto(s)`;
    if (!data.length) { tbody.innerHTML = emptyRow(8, "Sin productos registrados"); return; }

    tbody.innerHTML = data.map(p => {
        // Columna de acciones: solo ADMIN y SUPERVISOR
        const actionsCell = canEdit ? `
        <td>
          <div style="display:flex;gap:4px;">
            <button class="btn btn-ghost btn-sm" onclick="openEdit(${JSON.stringify(p).replace(/"/g, '&quot;')})">Editar</button>
            ${Auth.isAdmin()
                ? `<button class="btn btn-ghost btn-sm" style="color:${p.is_active ? 'var(--red)' : 'var(--green)'};"
                  onclick="toggleActive('${p.id}', ${p.is_active}, '${p.name}')">
                  ${p.is_active ? "Desact." : "Activar"}
                 </button>`
                : ""}
          </div>
        </td>` : `<td></td>`;

        return `
        <tr style="${!p.is_active ? 'opacity:0.5;' : ''}">
          <td class="code-cell">${p.code}</td>
          <td class="fw-600">${p.name}</td>
          <td class="text-muted">${p.categories?.name || "—"}</td>
          <td class="text-muted">${p.unit}</td>
          <td class="text-mono">${p.minimum_stock}</td>
          <td>${p.is_active
                ? '<span class="badge badge-normal">Activo</span>'
                : '<span class="badge badge-out">Inactivo</span>'}</td>
          <td class="text-muted">${fmt.date(p.created_at)}</td>
          ${actionsCell}
        </tr>
      `;
    }).join("");
}

document.getElementById("search-input").addEventListener("input", applyFilters);
document.getElementById("filter-category").addEventListener("change", applyFilters);

function applyFilters() {
    const q = document.getElementById("search-input").value.toLowerCase();
    const cat = document.getElementById("filter-category").value;
    const filtered = allData.filter(p => {
        const mq = !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
        const mc = !cat || p.categories?.id === cat;
        return mq && mc;
    });
    renderTable(filtered);
}

function openCreate() {
    if (!canEdit) { Toast.show("Sin permiso para crear productos", "error"); return; }
    document.getElementById("modal-title").textContent = "Nuevo Producto";
    document.getElementById("prod-id").value = "";
    document.getElementById("prod-code").value = "";
    document.getElementById("prod-name").value = "";
    document.getElementById("prod-desc").value = "";
    document.getElementById("prod-unit").value = "";
    document.getElementById("prod-minstock").value = "0";
    document.getElementById("prod-image").value = "";
    document.getElementById("prod-category").value = "";
    Modal.open("modal-product");
}

function openEdit(p) {
    if (!canEdit) { Toast.show("Sin permiso para editar productos", "error"); return; }
    document.getElementById("modal-title").textContent = "Editar Producto";
    document.getElementById("prod-id").value = p.id;
    document.getElementById("prod-code").value = p.code;
    document.getElementById("prod-name").value = p.name;
    document.getElementById("prod-desc").value = p.description || "";
    document.getElementById("prod-unit").value = p.unit;
    document.getElementById("prod-minstock").value = p.minimum_stock;
    document.getElementById("prod-image").value = p.image_url || "";
    document.getElementById("prod-category").value = p.categories?.id || "";
    Modal.open("modal-product");
}

document.getElementById("btn-prod-save").addEventListener("click", async () => {
    if (!canEdit) { Toast.show("Sin permiso", "error"); return; }

    const id = document.getElementById("prod-id").value;
    const code = document.getElementById("prod-code").value.trim();
    const name = document.getElementById("prod-name").value.trim();
    const unit = document.getElementById("prod-unit").value.trim();
    const minstock = parseInt(document.getElementById("prod-minstock").value) || 0;
    const catId = document.getElementById("prod-category").value || null;
    const desc = document.getElementById("prod-desc").value.trim() || null;
    const imageUrl = document.getElementById("prod-image").value.trim() || null;

    if (!code || !name || !unit) {
        Toast.show("Código, nombre y unidad son obligatorios", "error"); return;
    }

    const payload = { code, name, description: desc, unit, minimum_stock: minstock, category_id: catId, image_url: imageUrl };
    const btn = document.getElementById("btn-prod-save");
    btn.disabled = true; btn.textContent = "Guardando...";

    try {
        let error;
        if (id) {
            ({ error } = await db.from("products").update(payload).eq("id", id));
        } else {
            ({ error } = await db.from("products").insert(payload));
        }
        if (error) throw error;
        Toast.show(id ? "Producto actualizado" : "Producto creado", "success");
        Modal.close("modal-product");
        loadProducts();
    } catch (err) {
        Toast.show(err.message || "Error al guardar", "error");
    } finally {
        btn.disabled = false; btn.textContent = "Guardar";
    }
});

function toggleActive(id, current, name) {
    if (!Auth.isAdmin()) { Toast.show("Sin permiso", "error"); return; }
    document.getElementById("confirm-msg").textContent =
        `¿Seguro que deseas ${current ? "desactivar" : "activar"} el producto "${name}"?`;
    document.getElementById("btn-confirm-ok").onclick = async () => {
        const { error } = await db.from("products").update({ is_active: !current }).eq("id", id);
        if (error) { Toast.show(error.message, "error"); return; }
        Toast.show("Producto actualizado", "success");
        Modal.close("modal-confirm");
        loadProducts();
    };
    Modal.open("modal-confirm");
}
