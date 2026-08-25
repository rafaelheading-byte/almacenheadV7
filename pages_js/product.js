
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

let selectedImageBase64 = null;

async function loadProducts() {
    const tbody = document.getElementById("products-body");
    tbody.innerHTML = loadingRow(10);

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
        technical_sheet_url,
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
        tbody.innerHTML = emptyRow(10, error.message);
        return;
    }
    allData = data || [];
    renderTable(allData);
}

function renderTable(data) {
    const tbody = document.getElementById("products-body");
    document.getElementById("record-count").textContent = `${data.length} producto(s)`;
    if (!data.length) { tbody.innerHTML = emptyRow(10, "Sin productos registrados"); return; }

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
          <td style="text-align: center;">
            ${p.technical_sheet_url ? `
              <a href="${p.technical_sheet_url}" target="_blank" class="btn btn-ghost btn-icon btn-sm" title="Ficha Técnica" style="display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--black); background: var(--yellow); border-radius: var(--radius); transition: all var(--transition);">
                <img src="../img/canon.png" alt="Ficha Técnica" style="width: 32px; height: 32px; object-fit: contain; border-radius: var(--radius); border: 1px solid var(--gray-light); cursor: pointer;" />
              </a>
            ` : '—'}
          </td>
          <td style="text-align: center;">
            ${p.image_url ? `
              <img src="${p.image_url}" alt="${p.name}" style="width: 40px; height: 40px; object-fit: contain; border-radius: var(--radius); border: 1px solid var(--gray-light); cursor: pointer;" onclick="previewImage('${p.image_url.replace(/'/g, "\\'")}', '${p.name.replace(/'/g, "\\'")}')" />
            ` : '—'}
          </td>
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

// Configurar carga de archivo de imagen y conversión a Base64
document.getElementById("prod-image-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        Toast.show("La imagen no debe superar los 2MB", "error");
        e.target.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        selectedImageBase64 = event.target.result;
        document.getElementById("modal-image-preview").src = selectedImageBase64;
        document.getElementById("image-preview-container").style.display = "block";
        document.getElementById("file-name-text").textContent = file.name;
    };
    reader.readAsDataURL(file);
});

function removeSelectedImage() {
    selectedImageBase64 = null;
    document.getElementById("prod-image-file").value = "";
    document.getElementById("modal-image-preview").src = "";
    document.getElementById("image-preview-container").style.display = "none";
    document.getElementById("file-name-text").textContent = "Sin archivo";
}

function previewImage(src, name) {
    document.getElementById("preview-image-title").textContent = name || "Vista Previa";
    document.getElementById("preview-image-element").src = src;
    Modal.open("modal-image-preview-large");
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
    document.getElementById("prod-tech-sheet").value = "";
    document.getElementById("prod-category").value = "";

    removeSelectedImage();

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
    document.getElementById("prod-tech-sheet").value = p.technical_sheet_url || "";
    document.getElementById("prod-category").value = p.categories?.id || "";

    if (p.image_url) {
        selectedImageBase64 = p.image_url;
        document.getElementById("modal-image-preview").src = p.image_url;
        document.getElementById("image-preview-container").style.display = "block";
        document.getElementById("file-name-text").textContent = "Imagen cargada";
    } else {
        removeSelectedImage();
    }

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
    const techSheet = document.getElementById("prod-tech-sheet").value.trim() || null;
    const imageUrl = selectedImageBase64;

    if (!code || !name || !unit) {
        Toast.show("Código, nombre y unidad son obligatorios", "error"); return;
    }

    const payload = {
        code,
        name,
        description: desc,
        unit,
        minimum_stock: minstock,
        category_id: catId,
        image_url: imageUrl,
        technical_sheet_url: techSheet
    };
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

function printAllProducts() {
    const q = document.getElementById("search-input").value.toLowerCase();
    const cat = document.getElementById("filter-category").value;
    const filtered = allData.filter(p => {
        const mq = !q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
        const mc = !cat || p.categories?.id === cat;
        return mq && mc;
    });

    if (filtered.length === 0) {
        Toast.show("No hay productos para imprimir", "error");
        return;
    }

    const win = window.open('', '_blank');
    if (!win) {
        Toast.show("Permite las ventanas emergentes para poder imprimir", "error");
        return;
    }

    const fechaStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
    const horaStr = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const css = `
        @page { size: Letter landscape; margin: 10mm 12mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; color: #0d0d0d; font-size: 8.5pt; background: #fff; padding: 10px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2.5px solid #0d0d0d; padding-bottom: 8px; margin-bottom: 12px; }
        .title-area h1 { font-size: 14pt; font-weight: 900; letter-spacing: 0.5px; }
        .title-area p { font-size: 7.5pt; color: #666; margin-top: 1px; }
        .meta-info { text-align: right; font-size: 7.5pt; color: #444; }
        .meta-info strong { color: #0d0d0d; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #f0f0f0; color: #0d0d0d; font-weight: 700; text-transform: uppercase; font-size: 7pt; letter-spacing: 0.5px; border-bottom: 1.5px solid #0d0d0d; padding: 6px 4px; text-align: left; }
        td { border-bottom: 1px solid #e0e0e0; padding: 6px 4px; font-size: 8pt; vertical-align: middle; }
        tr:nth-child(even) { background: #fafafa; }
        .code-cell { font-family: monospace; font-weight: 700; color: #555; }
        .name-cell { font-weight: bold; }
        .img-cell img { width: 32px; height: 32px; object-fit: contain; border-radius: 4px; border: 1px solid #ddd; }
        .badge { display: inline-block; padding: 2px 6px; font-size: 7pt; font-weight: bold; border-radius: 3px; background: #e0e0e0; color: #333; }
        .badge-active { background: #d4edda; color: #155724; }
        .badge-inactive { background: #f8d7da; color: #721c24; }
        @media print {
            body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
    `;

    let tableRowsHtml = filtered.map(p => {
        const categoryName = p.categories?.name || '—';
        const imgHtml = p.image_url ? `<img src="${p.image_url}" alt="Img" />` : '—';

        return `
            <tr>
                <td class="code-cell">${p.code}</td>
                <td class="name-cell">${p.name}</td>
                <td>${categoryName}</td>
                <td>${p.unit}</td>
                <td class="img-cell" style="text-align: center;">${imgHtml}</td>
            </tr>
        `;
    }).join('');

    const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8"/>
            <title>Catálogo de Productos - HEAD STORE</title>
            <style>${css}</style>
        </head>
        <body>
            <div class="header">
                <div class="title-area">
                    <h1>HEAD STORE \u00b7 CATÁLOGO DE PRODUCTOS</h1>
                    <p>Reporte generado desde el sistema de inventarios</p>
                </div>
                <div class="meta-info">
                    <div>Fecha: <strong>${fechaStr}</strong> \u00b7 Hora: <strong>${horaStr}</strong></div>
                    <div>Registros: <strong>${filtered.length}</strong></div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 10%;">Código</th>
                        <th style="width: 50%;">Nombre</th>
                        <th style="width: 15%;">Categoría</th>
                        <th style="width: 10%;">Unidad</th>
                        <th style="width: 15%; text-align: center;">Imagen</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
            </table>
            <script>
                window.addEventListener('load', () => {
                    setTimeout(() => {
                        window.print();
                    }, 500);
                });
            <\/script>
        </body>
        </html>
    `;

    win.document.write(html);
    win.document.close();
}
