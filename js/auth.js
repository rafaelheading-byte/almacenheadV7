// =========================================================
// HEAD STORE — Auth
// =========================================================

const Auth = {
  currentUser: null,

  async login(email, password) {
    if (!email || !password) {
      throw new Error("Completa todos los campos.");
    }

    // Validación de credenciales en el servidor (RPC verify_login).
    // El password_hash NUNCA sale de la base de datos: la comparación
    // se hace dentro de Postgres con crypt(), no en el cliente.
    const { data, error } = await db.rpc("verify_login", {
      p_email: email.trim().toLowerCase(),
      p_password: password,
    });

    if (error) {
      console.error("[Auth] verify_login error:", error);
      throw new Error("Error de autenticación. Intenta de nuevo.");
    }

    if (!data || data.length === 0) {
      throw new Error("Credenciales incorrectas");
    }

    const user = data[0];

    // Consultar almacenes desde la tabla relacional user_warehouses
    try {
      const { data: uwRows, error: uwError } = await db
        .from("user_warehouses")
        .select("warehouse_id")
        .eq("user_id", user.id);

      if (!uwError && uwRows && uwRows.length > 0) {
        user.allowed_warehouses = uwRows.map((r) => r.warehouse_id);
        if (!user.warehouse_id && user.allowed_warehouses.length > 0) {
          user.warehouse_id = user.allowed_warehouses[0];
        }
      }
    } catch (e) {
      console.warn("[Auth] user_warehouses fallback:", e);
    }

    this.currentUser = user;
    sessionStorage.setItem("hs_user", JSON.stringify(user));
    return user;
  },

  // Permite a un usuario ADMIN cambiar/crear la contraseña de otro usuario.
  // El hash se genera del lado del servidor (pgcrypto), nunca en el cliente.
  async setPassword(targetUserId, newPassword) {
    const admin = this.getUser();
    if (!admin || admin.role !== "ADMIN") {
      throw new Error("No autorizado.");
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error("La contraseña debe tener al menos 8 caracteres.");
    }

    const { data, error } = await db.rpc("set_user_password", {
      p_admin_id: admin.id,
      p_target_user_id: targetUserId,
      p_new_password: newPassword,
    });

    if (error) {
      console.error("[Auth] set_user_password error:", error);
      throw new Error(error.message || "No se pudo cambiar la contraseña.");
    }

    return data;
  },

  logout() {
    this.currentUser = null;
    sessionStorage.removeItem("hs_user");
    sessionStorage.removeItem("hs_warehouses");
    const redirectPath = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
    window.location.href = redirectPath;
  },

  getUser() {
    if (this.currentUser) return this.currentUser;
    const stored = sessionStorage.getItem("hs_user");
    if (stored) {
      this.currentUser = JSON.parse(stored);
      // Si allowed_warehouses no es un arreglo (nunca se asignó), inicializar como vacío
      if (this.currentUser && !Array.isArray(this.currentUser.allowed_warehouses)) {
        this.currentUser.allowed_warehouses = null;
      }
      return this.currentUser;
    }
    return null;
  },

  requireAuth() {
    const user = this.getUser();
    if (!user) {
      const redirectPath = window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
      window.location.href = redirectPath;
      return null;
    }
    return user;
  },

  hasRole(...roles) {
    const user = this.getUser();
    return user && roles.includes(user.role);
  },

  isAdmin() {
    return this.hasRole("ADMIN");
  },

  isSupervisor() {
    return this.hasRole("SUPERVISOR");
  },

  isAlmacenista() {
    return this.hasRole("ALMACENISTA");
  },

  isCoordinador() {
    return this.hasRole("COORDINADOR");
  },

  // SUPERVISOR ahora es de solo lectura en inventario.
  // Solo ADMIN puede registrar entradas, salidas, ajustes y carga masiva.
  // COORDINADOR también puede realizar ajustes y carga masiva.
  canEdit() {
    return this.isAdmin() || this.isCoordinador()
  },

  // Devuelve true si el usuario puede operar en un warehouse_id dado.
  // ADMIN y COORDINADOR acceden a todos.
  // SUPERVISOR solo accede a los almacenes en allowed_warehouses.
  // STOREKEEPER solo accede al warehouse_id asignado en su perfil.
  canAccessWarehouse(warehouseId) {
    const user = this.getUser();
    if (!user) return false;
    if (user.role === "ADMIN" || user.role === "COORDINADOR") return true;
    if (user.role === "SUPERVISOR") {
      const allowed = user.allowed_warehouses;
      // Con almacenes específicos: verificar si está en la lista
      if (allowed && Array.isArray(allowed) && allowed.length > 0) return allowed.includes(warehouseId);
      // Sin almacenes específicos: acceso a todos
      return true;
    }
    // STOREKEEPER: comparar con su warehouse_id asignado
    if (user.allowed_warehouses && Array.isArray(user.allowed_warehouses) && user.allowed_warehouses.length > 0) {
      return user.allowed_warehouses.includes(warehouseId);
    }
    return user.warehouse_id === warehouseId;
  },

  // Retorna la lista de warehouse IDs permitidos para este usuario.
  // Para ADMIN y COORDINADOR retorna null (= sin restricción, usar todos los almacenes).
  // Para SUPERVISOR retorna su array allowed_warehouses, o [] si no tiene almacenes asignados.
  // Para STOREKEEPER retorna array con su warehouse_id, o [] si no tiene.
  getAllowedWarehouseIds() {
    const user = this.getUser();
    if (!user) return [];
    if (user.role === "ADMIN" || user.role === "COORDINADOR") return null;
    if (user.role === "SUPERVISOR") {
      const allowed = user.allowed_warehouses;
      // Con almacenes específicos: devolver solo esos
      if (allowed && Array.isArray(allowed) && allowed.length > 0) return allowed;
      // Sin almacenes específicos: acceso total (igual que ADMIN)
      return null;
    }
    // STOREKEEPER
    if (user.allowed_warehouses && Array.isArray(user.allowed_warehouses) && user.allowed_warehouses.length > 0) {
      return user.allowed_warehouses;
    }
    return user.warehouse_id ? [user.warehouse_id] : [];
  },
};