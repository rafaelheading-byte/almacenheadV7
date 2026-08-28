// =========================================================
// HEAD STORE — Utilities
// =========================================================

// ── Toast ──
const Toast = {
  show(message, type = "info", duration = 3500) {
    let container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      document.body.appendChild(container);
    }
    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    };
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.innerHTML = `${icons[type] || icons.info} <span>${message}</span>`;
    container.appendChild(t);
    setTimeout(() => {
      t.style.animation = "fadeOut 300ms ease forwards";
      setTimeout(() => t.remove(), 300);
    }, duration);
  },
};

// ── Modal ──
const Modal = {
  open(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("open");
  },
  close(id) {
    // Prevent closing if saving is in progress
    if (id === "modal-entry") {
      const btn = document.getElementById("btn-entry-save");
      if (btn && btn.disabled) return;
    }
    if (id === "modal-exit") {
      const btn = document.getElementById("btn-exit-save");
      if (btn && btn.disabled) return;
    }
    if (id === "modal-apartado") {
      const btn = document.getElementById("btn-apartado-save");
      if (btn && btn.disabled) return;
    }
    const el = document.getElementById(id);
    if (el) el.classList.remove("open");
  },
};

// Close modal on overlay click
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) {
    // Prevent closing entry, exit, or apartado modal by clicking on background
    if (e.target.id === "modal-entry" || e.target.id === "modal-exit" || e.target.id === "modal-apartado") {
      return;
    }
    e.target.classList.remove("open");
  }
});

// ── Format helpers ──
const fmt = {
  date(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("es-MX", {
      day: "2-digit", month: "short", year: "numeric",
    });
  },
  datetime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("es-MX", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  },
  number(n) {
    return Number(n || 0).toLocaleString("es-MX");
  },
};

// ── Stock badge ──
function stockBadge(status) {
  const map = {
    NORMAL: `<span class="badge badge-normal"><span class="dot dot-normal"></span>Normal</span>`,
    LOW: `<span class="badge badge-low"><span class="dot dot-low"></span>Bajo</span>`,
    OUT: `<span class="badge badge-out"><span class="dot dot-out"></span>Agotado</span>`,
  };
  return map[status] || `<span class="badge">${status}</span>`;
}

// ── Movement badge ──
function movBadge(type) {
  const map = {
    ENTRY: `<span class="badge badge-entry">Entrada</span>`,
    EXIT: `<span class="badge badge-exit">Salida</span>`,
    TRANSFER: `<span class="badge badge-transfer">Transferencia</span>`,
  };
  return map[type] || `<span class="badge">${type}</span>`;
}

// ── Role badge ──
function roleBadge(role) {
  const map = {
    ADMIN: `<span class="badge badge-admin">Admin</span>`,
    ALMACENISTA: `<span class="badge badge-almacenista">Almacenista</span>`,
    SUPERVISOR: `<span class="badge badge-supervisor">Supervisor</span>`,
    COORDINADOR: `<span class="badge badge-coordinator">Coordinador</span>`,
  };
  return map[role] || `<span class="badge">${role}</span>`;
}

// ── Initials ──
function initials(name) {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

// ── Loading row ──
function loadingRow(cols) {
  return `<tr><td colspan="${cols}"><div class="page-loader"><div class="spinner"></div></div></td></tr>`;
}

// ── Empty row ──
function emptyRow(cols, message = "Sin resultados") {
  return `<tr><td colspan="${cols}">
    <div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      <p>${message}</p>
    </div>
  </td></tr>`;
}

// ══════════════════════════════════════════════════════
// fetchAll — trae TODOS los registros superando el
// límite de Supabase (default 100-1000 según proyecto).
//
// ESTRATEGIA DUAL:
//  1. Obtiene COUNT exacto (head request) para saber total
//  2. Pagina en batches de 500 hasta completar
//
// queryFn(from, to) → query builder con .range(from, to)
// countFn()         → misma query sin .range() para COUNT
// ══════════════════════════════════════════════════════
async function fetchAll(queryFn, countFn = null, batchSize = 500) {
  let all = [];
  let from = 0;
  let total = null;

  // Paso 1: obtener total exacto si se provee countFn
  if (countFn) {
    try {
      const { count } = await countFn();
      if (count !== null && count !== undefined) total = count;
    } catch (e) { /* seguir con paginación ciega */ }
  }

  // Paso 2: paginar hasta traer todo
  while (true) {
    const to = from + batchSize - 1;
    const { data, error } = await queryFn(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    all = all.concat(data);

    // Si ya alcanzamos el total exacto, terminar
    if (total !== null && all.length >= total) break;

    // Si el lote fue menor que el batch, no hay más páginas
    if (data.length < batchSize) break;

    from += batchSize;
  }

  return all;
}


// ── Nav highlight ──
function setActiveNav(id) {
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

// ── Sidebar shared render ──
function renderSidebar(activeId) {
  const user = Auth.getUser();
  if (!user) return;

  const pathPrefix = window.location.pathname.includes('/pages/') ? "" : "pages/";
  const imgPrefix = window.location.pathname.includes('/pages/') ? "../" : "";

  // Apply desktop collapsed state if saved in localStorage (run early to avoid layout jump)
  if (window.innerWidth > 768) {
    const isCollapsed = localStorage.getItem("sidebar-collapsed") === "true";
    if (isCollapsed) {
      document.body.classList.add("sidebar-hidden");
    } else {
      document.body.classList.remove("sidebar-hidden");
    }
  }

  const isAdmin = user.role === "ADMIN";
  const isRafa = user.id === "4588f3b0-737c-4ce3-b1f1-b9dbe381c8b1";
  const isSupervisor = user.role === "SUPERVISOR";
  const isAlmacenista = user.role === "ALMACENISTA";
  const isCoordinador = user.role === "COORDINADOR";
  const hasEmpacadoraAccess = user.has_empacadora_access === true;

  // Asynchronous verification of packing plant access for Almacenista
  if (isAlmacenista && user.has_empacadora_access === undefined && typeof db !== "undefined" && db) {
    // Avoid double triggers
    user.has_empacadora_access = "checking";
    sessionStorage.setItem("hs_user", JSON.stringify(user));

    let whIds = [];
    if (user.allowed_warehouses && Array.isArray(user.allowed_warehouses)) {
      whIds = user.allowed_warehouses;
    } else if (user.warehouse_id) {
      whIds = [user.warehouse_id];
    }

    if (whIds.length > 0) {
      db.from("warehouses")
        .select("id, name")
        .in("id", whIds)
        .then(({ data, error }) => {
          if (!error && data) {
            const hasAccess = data.some(w => w.name && w.name.toLowerCase().includes("empacadora"));
            user.has_empacadora_access = hasAccess;
            sessionStorage.setItem("hs_user", JSON.stringify(user));
            // Re-render sidebar now that we know access
            renderSidebar(activeId);
          } else {
            user.has_empacadora_access = false;
            sessionStorage.setItem("hs_user", JSON.stringify(user));
          }
        })
        .catch(err => {
          console.error("Error checking empacadora access:", err);
          user.has_empacadora_access = false;
          sessionStorage.setItem("hs_user", JSON.stringify(user));
        });
    } else {
      user.has_empacadora_access = false;
      sessionStorage.setItem("hs_user", JSON.stringify(user));
    }
  }

  const showApartados = isAdmin || isCoordinador || (isAlmacenista && hasEmpacadoraAccess);

  const navItems = [
    ...(isAdmin ? [{ id: "nav-dashboard", href: `${pathPrefix}dashboard.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`, label: "Dashboard" }] : []),
    { id: "nav-inventory", href: `${pathPrefix}inventory.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`, label: "Inventario" },
    ...showApartados ? [{ id: "nav-apartados", href: `${pathPrefix}apartado.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`, label: "Apartados" }] : [],
    { id: "nav-movements", href: `${pathPrefix}movements.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`, label: "Movimientos" },
    { id: "nav-products", href: `${pathPrefix}products.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`, label: "Productos" },
    ...(isAdmin ? [{ id: "nav-warehouses", href: `${pathPrefix}warehouses.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`, label: "Almacenes" }] : []),
    ...(isRafa ? [{ id: "nav-suppliers", href: `${pathPrefix}suppliers.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`, label: "Proveedores" }] : []),
    ...(isRafa ? [{ id: "nav-projects", href: `${pathPrefix}projects.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, label: "Procesos" }] : []),
    { id: "nav-herramientas", href: `${pathPrefix}herramientas.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`, label: "Herramientas" },
    ...(isRafa ? [{ id: "nav-users", href: `${pathPrefix}users.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`, label: "Usuarios" }] : []),
    ...(isRafa ? [{ id: "nav-rentas", href: `${pathPrefix}rentas.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, label: "Rentas" }] : []),
    ...(isRafa ? [{ id: "nav-compras", href: `${pathPrefix}compras.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, label: "Compras" }] : []),
    ...(isRafa ? [{ id: "nav-ruta", href: `${pathPrefix}rutas.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`, label: "Rutas" }] : []),
    ...(isRafa ? [{ id: "nav-codigos", href: `${pathPrefix}codigos.html`, icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`, label: "Codigos" }] : [])
  ];

  const navHTML = navItems.map(item => `
    <a class="nav-item ${item.id === activeId ? "active" : ""}" href="${item.href}" id="${item.id}">
      ${item.icon} ${item.label}
    </a>
  `).join("");

  const sidebarEl = document.querySelector(".sidebar");
  if (!sidebarEl) return;

  sidebarEl.innerHTML = `
    <div class="sidebar-logo">
      <div class="mark">
        <img style="width: 40px; height: 40px;" src="${imgPrefix}img/LOGO OK.jpg" alt="Logo">
      </div>
      <div>
        <div class="brand-text">HEAD STORE</div>
        <div class="brand-sub">Inventarios</div>
      </div>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Principal</div>
      ${navHTML}
    </nav>
    <div class="sidebar-user">
      <div class="user-info">
        <div class="user-avatar">${initials(user.full_name)}</div>
        <div>
          <div class="user-name">${user.full_name}</div>
          <div class="user-role">${user.role}</div>
        </div>
      </div>
      <button class="btn-logout" onclick="Auth.logout()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        Cerrar sesión
      </button>
    </div>
  `;

  // Dynamically ensure there is a menu-toggle button with the logo in the topbar
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    let toggleBtn = topbar.querySelector("#menu-toggle");
    if (!toggleBtn) {
      toggleBtn = document.createElement("button");
      toggleBtn.id = "menu-toggle";
      topbar.prepend(toggleBtn);
    }
    toggleBtn.className = "menu-toggle btn-ghost";
    toggleBtn.style.cssText = "display: inline-flex; align-items: center; gap: 10px; border: none; background: transparent; padding: 4px 8px; border-radius: 6px; cursor: pointer; margin-right: 16px; transition: background 150ms;";
    toggleBtn.innerHTML = `
      <img style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;" src="${imgPrefix}img/LOGO OK.jpg" alt="Logo">
      <span class="brand-text" style="font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem; color: var(--black); letter-spacing: 0.5px;">HEAD STORE</span>
    `;
  }

  // Setup click event for the menu toggle button
  const menuToggle = document.getElementById("menu-toggle");
  if (menuToggle) {
    menuToggle.onclick = function (e) {
      e.preventDefault();
      if (window.innerWidth <= 768) {
        sidebarEl.classList.toggle("open");
      } else {
        document.body.classList.toggle("sidebar-hidden");
        const isCollapsed = document.body.classList.contains("sidebar-hidden");
        localStorage.setItem("sidebar-collapsed", isCollapsed ? "true" : "false");
      }
    };
  }

  // Close sidebar on mobile when clicking outside
  document.addEventListener("click", function (e) {
    if (window.innerWidth <= 768 && sidebarEl.classList.contains("open")) {
      const menuToggle = document.getElementById("menu-toggle");
      if (!sidebarEl.contains(e.target) && menuToggle && !menuToggle.contains(e.target)) {
        sidebarEl.classList.remove("open");
      }
    }
  });
}

// ══════════════════════════════════════════════════════
// diagFetchAll — diagnóstico en consola
// Llama desde la consola del navegador:
//   diagFetchAll("inventory")
//   diagFetchAll("inventory_movements")
// ══════════════════════════════════════════════════════
async function diagFetchAll(tableName) {
  console.group(`🔍 HEAD STORE — Diagnóstico fetchAll: ${tableName}`);
  try {
    // Contar total real
    const { count, error: cErr } = await db
      .from(tableName)
      .select("id", { count: "exact", head: true });
    console.log("Total en BD (count):", count, cErr ? `ERROR: ${cErr.message}` : "✓");

    // Primer batch de 500
    const { data: d1 } = await db.from(tableName).select("id").range(0, 499);
    console.log("Batch 0-499:", d1?.length, "filas");

    // Segundo batch si hay
    if (d1?.length === 500) {
      const { data: d2 } = await db.from(tableName).select("id").range(500, 999);
      console.log("Batch 500-999:", d2?.length, "filas");
    }
  } catch (e) {
    console.error("Error:", e);
  }
  console.groupEnd();
}

