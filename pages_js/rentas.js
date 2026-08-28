// =========================================================
// HEAD STORE — Rentas Module Controller
// =========================================================

const user = Auth.requireAuth();
const canEdit = Auth.isAdmin();
const allowedWarehouseIds = Auth.getAllowedWarehouseIds();
const isRestricted = allowedWarehouseIds !== null;

let warehousesList = [];
let rentsList = [];

// Initialize Page
if (user) {
    renderSidebar("nav-rentas");

    if (canEdit) {
        document.getElementById("btn-new-rent").style.display = "";
    }

    loadAll();
}

// Load Warehouses and Rents
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

        // Populate warehouses dropdown in modal
        const selectWh = document.getElementById("rent-warehouse");
        selectWh.innerHTML = '<option value="">Seleccione un almacén...</option>' +
            warehousesList.map(w => `<option value="${w.id}">${w.name} (${w.code})</option>`).join('');

        // 2. Fetch rents
        let rentQuery = db.from("rentas").select("*");
        if (isRestricted) {
            rentQuery = rentQuery.in("warehouse_id", allowedWarehouseIds);
        }
        const { data: rentData, error: rentError } = await rentQuery.order("created_at", { ascending: false });

        if (rentError) {
            if (rentError.code === "42P01") {
                rentsList = [];
                renderAccordion();
                Toast.show("Tabla 'rentas' no encontrada. Ejecuta el script SQL en Supabase.", "error", 7000);
                container.prepend(createSqlWarningBanner());
                return;
            }
            throw rentError;
        }

        rentsList = rentData || [];

        // 3. Actualización automática de estatus basados en fecha de pago
        await actualizarEstatusAutomatico();

        // 4. Check for payment alerts and send emails
        await verificarAlertasDePago();

        // 5. Ordenar almacenes inteligentemente
        ordenarAlmacenes();

        renderAccordion();
    } catch (err) {
        console.error("Error al cargar datos:", err);
        Toast.show("Error al cargar almacenes o rentas", "error");
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

// Calculate remaining days between current date and payment date
function calcularDiasRestantes(fechaPagoStr) {
    if (!fechaPagoStr) return null;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const fechaPago = new Date(fechaPagoStr);
    // Adjust timezone offset to prevent date shifting
    fechaPago.setMinutes(fechaPago.getMinutes() + fechaPago.getTimezoneOffset());
    fechaPago.setHours(0, 0, 0, 0);

    const diffTime = fechaPago.getTime() - hoy.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Synchronize statuses automatically based on payment dates
async function actualizarEstatusAutomatico() {
    let updatedCount = 0;

    for (const r of rentsList) {
        // Ignorar las rentas finalizadas o canceladas
        if (r.estado === "FINALIZADA" || r.estado === "CANCELADA") continue;

        const dias = calcularDiasRestantes(r.fecha_pago);
        if (dias === null) continue;

        let nuevoEstado = "ACTIVA";
        if (dias < 0) {
            nuevoEstado = "VENCIDA";
        } else if (dias <= 7) {
            nuevoEstado = "PROXIMO A PAGO";
        }

        if (r.estado !== nuevoEstado) {
            try {
                const { error } = await db
                    .from("rentas")
                    .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
                    .eq("id", r.id);
                if (!error) {
                    r.estado = nuevoEstado;
                    updatedCount++;
                } else {
                    console.error(`Error al auto-actualizar la renta ${r.id} a ${nuevoEstado}:`, error);
                }
            } catch (err) {
                console.error(err);
            }
        }
    }

    if (updatedCount > 0) {
        Toast.show(`Se actualizaron ${updatedCount} estatus de renta automáticamente`, "info");
    }
}

// Sort warehouses by urgency
function ordenarAlmacenes() {
    warehousesList.sort((a, b) => {
        const scoreA = getWarehouseSortScore(a);
        const scoreB = getWarehouseSortScore(b);
        if (scoreA !== scoreB) {
            return scoreA - scoreB;
        }
        return a.name.localeCompare(b.name);
    });
}

// Get sorting score for a warehouse based on active or urgent rents
function getWarehouseSortScore(w) {
    const wRents = rentsList.filter(r => r.warehouse_id === w.id);
    const activeRents = wRents.filter(r => r.estado === "ACTIVA" || r.estado === "VENCIDA");

    if (activeRents.length > 0) {
        // Find minimum days remaining among active/vencida rents
        const minDays = Math.min(...activeRents.map(r => {
            const d = calcularDiasRestantes(r.fecha_pago);
            return d !== null ? d : Infinity;
        }));

        // Active rents take priority. Urgent ones (minDays <= 7) will have smaller values
        // than non-urgent ones, placing them at the absolute top.
        return minDays;
    } else if (wRents.length > 0) {
        // Has rents, but no active rents (all finished or cancelled)
        return 1000000;
    } else {
        // No rents at all
        return 2000000;
    }
}

// Verify payment alerts and trigger emails for exactly 7 days remaining
async function verificarAlertasDePago() {
    const rentasPorNotificar = rentsList.filter(r => {
        if (r.estado !== "ACTIVA" || r.alerta_enviada) return false;
        const dias = calcularDiasRestantes(r.fecha_pago);
        return dias === 7; // Alerta exacta de 7 días
    });

    if (rentasPorNotificar.length === 0) return;

    console.log(`[Alertas] Se encontraron ${rentasPorNotificar.length} rentas para enviar recordatorio de pago (7 días restantes).`);

    for (const renta of rentasPorNotificar) {
        await enviarCorreoRecordatorio(renta, 7);
    }
}

// Programmatic email sending function (EmailJS integration template)
async function enviarCorreoRecordatorio(renta, dias) {
    console.log(`[Email] Enviando recordatorio para la renta de ${renta.cliente}. Faltan ${dias} días.`);

    try {
        const payloadEmail = {
            service_id: "default_service", // Configurar en EmailJS
            template_id: "template_payment_reminder", // Configurar en EmailJS
            user_id: "USER_ID_DE_EMAILJS", // Configurar su public key de EmailJS
            template_params: {
                cliente: renta.cliente,
                fecha_pago: fmt.date(renta.fecha_pago),
                dias_restantes: dias,
                monto: fmt.number(renta.monto),
                descripcion: renta.descripcion || "Sin descripción"
            }
        };

        let apiSuccess = true;

        // Execute API call only if credentials are set (avoid breaking the app in development)
        if (payloadEmail.user_id !== "USER_ID_DE_EMAILJS") {
            const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payloadEmail)
            });
            if (!response.ok) {
                const txt = await response.text();
                throw new Error(txt);
            }
        } else {
            console.log("%c[Email Config Warning] Para activar el envío real de correos, edite 'USER_ID_DE_EMAILJS' en rentas.js con sus credenciales de EmailJS.", "color: orange; font-weight: bold;");
            apiSuccess = true; // Simulación para pruebas
        }

        if (apiSuccess) {
            // Mark as alert sent in Supabase database
            const { error } = await db
                .from("rentas")
                .update({ alerta_enviada: true, updated_at: new Date().toISOString() })
                .eq("id", renta.id);

            if (error) throw error;

            renta.alerta_enviada = true;
            Toast.show(`Recordatorio de pago enviado por correo para ${renta.cliente}`, "success");
        }
    } catch (err) {
        console.error("Error al enviar correo de recordatorio:", err);
        Toast.show(`No se pudo enviar correo para ${renta.cliente}: ${err.message}`, "error");
    }
}

// Create SQL Warning Banner for missing table
function createSqlWarningBanner() {
    const banner = document.createElement("div");
    banner.className = "stat-card red";
    banner.style.marginBottom = "20px";
    banner.innerHTML = `
        <div class="stat-label" style="color:var(--red); font-weight:700;">⚠️ TABLA DE RENTAS NO ENCONTRADA EN SUPABASE</div>
        <div style="font-size:0.85rem; margin-top:8px; line-height:1.4;">
            La tabla <code>rentas</code> aún no existe en su base de datos.
            <br>Por favor ejecute el script SQL que se encuentra en: 
            <a href="../sql/create_rentas_table.sql" target="_blank" style="text-decoration: underline; font-weight: 600;">sql/create_rentas_table.sql</a>
            dentro del editor de Supabase para poder comenzar a registrar rentas.
        </div>
    `;
    return banner;
}

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
        const wRents = rentsList.filter(r => r.warehouse_id === w.id);
        const activeCount = wRents.filter(r => r.estado === "ACTIVA").length;

        // Rents rows or empty state
        let rentsTableHTML = "";
        if (wRents.length === 0) {
            rentsTableHTML = `
                <div style="padding:32px; text-align:center; color:var(--gray-light);">
                    <p style="font-size:0.85rem; margin-bottom:4px;">📍 Sin rentas registradas en este almacén</p>
                    <span style="font-size:0.75rem; color:var(--gray-light);">Haz clic en "Nueva Renta" para registrar una.</span>
                </div>
            `;
        } else {
            rentsTableHTML = `
                <div class="table-wrap">
                    <table class="rents-table">
                        <thead>
                            <tr>
                                <th>Cliente</th>
                                <th>Descripción / Elementos</th>
                                <th style="width:110px;">Inicio</th>
                                <th style="width:110px;">Fin</th>
                                <th style="width:160px;">Próximo Pago</th>
                                <th style="width:120px;">Monto</th>
                                <th style="width:110px;">Estado</th>
                                ${canEdit ? '<th style="width:90px; text-align:center;">Acciones</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${wRents.map(r => {
                const editBtn = canEdit
                    ? `<td style="text-align:center; vertical-align:middle;">
                                         <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); openEdit(${JSON.stringify(r).replace(/"/g, '&quot;')})">Editar</button>
                                       </td>`
                    : "";

                // Calculate payment date warnings
                const dias = calcularDiasRestantes(r.fecha_pago);
                let pagoHtml = "";
                if (dias === null) {
                    pagoHtml = '<span class="text-muted">—</span>';
                } else if (dias < 0) {
                    pagoHtml = `
                                        <div style="color:var(--red); font-weight:700; line-height: 1.2;">
                                            🚨 Vencido hace ${Math.abs(dias)} d
                                            <div style="font-size:0.72rem; font-weight:normal; color:var(--gray-light); margin-top:2px;">${fmt.date(r.fecha_pago)}</div>
                                        </div>
                                    `;
                } else if (dias === 0) {
                    pagoHtml = `
                                        <div style="color:var(--red); font-weight:700; line-height: 1.2;">
                                            ⚠️ ¡Vence Hoy!
                                            <div style="font-size:0.72rem; font-weight:normal; color:var(--gray-light); margin-top:2px;">${fmt.date(r.fecha_pago)}</div>
                                        </div>
                                    `;
                } else if (dias <= 7) {
                    pagoHtml = `
                                        <div style="color:var(--orange); font-weight:700; line-height: 1.2;">
                                            ⚠️ En ${dias} días
                                            <div style="font-size:0.72rem; font-weight:normal; color:var(--gray-light); margin-top:2px;">${fmt.date(r.fecha_pago)}</div>
                                        </div>
                                    `;
                } else {
                    pagoHtml = `
                                        <div style="color:var(--green); font-weight:600; line-height: 1.2;">
                                            En ${dias} días
                                            <div style="font-size:0.72rem; font-weight:normal; color:var(--gray-light); margin-top:2px;">${fmt.date(r.fecha_pago)}</div>
                                        </div>
                                    `;
                }

                return `
                                    <tr>
                                        <td style="font-weight:600; white-space:nowrap; vertical-align:middle;">${r.cliente}</td>
                                        <td style="font-size:0.82rem; color:var(--gray-dark); max-width: 280px; white-space: normal; word-break: break-word; vertical-align:middle;">
                                            ${r.descripcion || "—"}
                                        </td>
                                        <td style="white-space:nowrap; vertical-align:middle;">${fmt.date(r.fecha_inicio)}</td>
                                        <td style="white-space:nowrap; vertical-align:middle;">${r.fecha_fin ? fmt.date(r.fecha_fin) : "Indefinida"}</td>
                                        <td style="white-space:nowrap; vertical-align:middle;">${pagoHtml}</td>
                                        <td style="font-family:var(--font-mono); font-weight:700; color:var(--black); vertical-align:middle;">$ ${fmt.number(r.monto)}</td>
                                        <td style="vertical-align:middle;">
                                            <span class="badge badge-${r.estado.toLowerCase().replace(/\s+/g, '-')}">${r.estado}</span>
                                        </td>
                                        ${editBtn}
                                    </tr>
                                `;
            }).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        const activeBadge = activeCount > 0
            ? `<span class="badge badge-normal" style="font-size: 0.65rem; padding: 2px 8px;">${activeCount} activa(s)</span>`
            : `<span class="badge badge-storekeeper" style="font-size: 0.65rem; padding: 2px 8px; color: var(--gray-light);">Sin rentas activas</span>`;

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
                        ${activeBadge}
                        <span class="rents-summary-badge">${wRents.length} total</span>
                        <svg class="accordion-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9" />
                        </svg>
                    </div>
                </div>
                <div class="accordion-content">
                    <div style="padding: 16px 22px;">
                        ${rentsTableHTML}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Toggle accordion open/closed
function toggleAccordion(whId) {
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
                content.style.maxHeight = "2000px";
            }
        }, 300);
    }
}

// Open modal for creation
function openCreate() {
    if (!canEdit) { Toast.show("Sin permiso para registrar rentas", "error"); return; }
    document.getElementById("modal-title").textContent = "Nueva Renta";
    document.getElementById("rent-id").value = "";
    document.getElementById("rent-warehouse").value = "";
    document.getElementById("rent-warehouse").disabled = false;
    document.getElementById("rent-cliente").value = "";
    document.getElementById("rent-descripcion").value = "";

    const hoyStr = new Date().toISOString().split('T')[0];
    document.getElementById("rent-fecha-inicio").value = hoyStr;
    document.getElementById("rent-fecha-fin").value = "";

    // Default next payment date to 30 days from now
    const proximoMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    document.getElementById("rent-fecha-pago").value = proximoMes;

    document.getElementById("rent-monto").value = "";
    document.getElementById("rent-estado").value = "ACTIVA";

    Modal.open("modal-renta");
}

// Open modal for editing
function openEdit(rent) {
    if (!canEdit) { Toast.show("Sin permiso para editar rentas", "error"); return; }
    document.getElementById("modal-title").textContent = "Editar Renta";
    document.getElementById("rent-id").value = rent.id;
    document.getElementById("rent-warehouse").value = rent.warehouse_id;
    document.getElementById("rent-warehouse").disabled = true;
    document.getElementById("rent-cliente").value = rent.cliente;
    document.getElementById("rent-descripcion").value = rent.descripcion || "";
    document.getElementById("rent-fecha-inicio").value = rent.fecha_inicio;
    document.getElementById("rent-fecha-fin").value = rent.fecha_fin || "";
    document.getElementById("rent-fecha-pago").value = rent.fecha_pago;
    document.getElementById("rent-monto").value = rent.monto;
    document.getElementById("rent-estado").value = rent.estado;

    Modal.open("modal-renta");
}

// Save or update rent
document.getElementById("btn-rent-save").addEventListener("click", async () => {
    if (!canEdit) { Toast.show("Sin permiso para guardar", "error"); return; }

    const id = document.getElementById("rent-id").value;
    const warehouse_id = document.getElementById("rent-warehouse").value;
    const cliente = document.getElementById("rent-cliente").value.trim();
    const descripcion = document.getElementById("rent-descripcion").value.trim();
    const fecha_inicio = document.getElementById("rent-fecha-inicio").value;
    const fecha_fin = document.getElementById("rent-fecha-fin").value || null;
    const fecha_pago = document.getElementById("rent-fecha-pago").value;
    const montoStr = document.getElementById("rent-monto").value;
    const estado = document.getElementById("rent-estado").value;

    if (!warehouse_id || !cliente || !fecha_inicio || !fecha_pago || !montoStr) {
        Toast.show("Completa todos los campos obligatorios (*)", "error");
        return;
    }

    const monto = parseFloat(montoStr);
    if (isNaN(monto) || monto < 0) {
        Toast.show("El monto debe ser un número positivo", "error");
        return;
    }

    const btn = document.getElementById("btn-rent-save");
    btn.disabled = true;
    btn.textContent = "Guardando...";

    // Check if the payment date has changed. If so, reset the alert flag to allow email resending
    let resetAlerta = false;
    if (id) {
        const oldRent = rentsList.find(r => r.id === id);
        if (oldRent && oldRent.fecha_pago !== fecha_pago) {
            resetAlerta = true;
        }
    }

    const payload = {
        warehouse_id,
        cliente,
        descripcion,
        fecha_inicio,
        fecha_fin,
        fecha_pago,
        monto,
        estado,
        updated_at: new Date().toISOString()
    };

    if (resetAlerta) {
        payload.alerta_enviada = false;
    }

    try {
        let error;
        if (id) {
            ({ error } = await db.from("rentas").update(payload).eq("id", id));
        } else {
            // When inserting, alert flag is false by default
            payload.alerta_enviada = false;
            ({ error } = await db.from("rentas").insert(payload));
        }

        if (error) throw error;

        Toast.show(id ? "Renta actualizada con éxito" : "Renta registrada con éxito", "success");
        Modal.close("modal-renta");
        loadAll();
    } catch (err) {
        console.error("Error al guardar renta:", err);
        Toast.show("Error al guardar: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Guardar";
    }
});
