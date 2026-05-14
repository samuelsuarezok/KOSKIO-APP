// app.js - Lógica completa del frontend POS Argentina
// ─────────────────────────────────────────────────────────────────────────────

const API = "http://localhost:3000/api";

// ─── Estado global de la aplicación ──────────────────────────────────────────
const state = {
  carrito: [],       // Array de { producto_id, codigo_barras, nombre, precio_unit, cantidad, subtotal }
  total: 0,
  vistaActual: "pos",
};

// ─── INICIALIZACIÓN ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  iniciarReloj();
  registrarAtajos();
  cargarInventario();
  document.getElementById("barcode-input").focus();
});

// ─── RELOJ ────────────────────────────────────────────────────────────────────
function iniciarReloj() {
  const el = document.getElementById("clock");
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString("es-AR");
  };
  tick();
  setInterval(tick, 1000);
}

// ─── NAVEGACIÓN ENTRE VISTAS ──────────────────────────────────────────────────
function switchView(vista) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

  document.getElementById(`view-${vista}`).classList.add("active");
  document.querySelector(`[data-view="${vista}"]`).classList.add("active");
  state.vistaActual = vista;

  if (vista === "pos") {
    setTimeout(() => document.getElementById("barcode-input").focus(), 50);
  }
  if (vista === "inventario") {
    cargarInventario();
  }
}

// ─── ATAJOS DE TECLADO GLOBALES ───────────────────────────────────────────────
function registrarAtajos() {
  document.addEventListener("keydown", (e) => {
    // F2: abrir cobro
    if (e.key === "F2") {
      e.preventDefault();
      if (state.carrito.length > 0) abrirModalCobro();
    }
    // ESC: vaciar carrito (solo si no hay modal abierto)
    if (e.key === "Escape") {
      const modalAbierto = document.querySelector(".modal-overlay.open");
      if (!modalAbierto && state.vistaActual === "pos") limpiarCarrito();
    }
    // F5: ir a inventario
    if (e.key === "F5") {
      e.preventDefault();
      switchView(state.vistaActual === "pos" ? "inventario" : "pos");
    }
  });

  // Enter en el input de código de barras
  document.getElementById("barcode-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const codigo = e.target.value.trim();
      if (codigo) buscarYAgregarProducto(codigo);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MÓDULO POS - CARRITO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Busca un producto por código de barras y lo agrega al carrito.
 */
async function buscarYAgregarProducto(codigo) {
  const input = document.getElementById("barcode-input");
  const feedback = document.getElementById("scan-feedback");

  feedback.textContent = "Buscando...";
  feedback.className = "scan-feedback";
  input.value = "";

  try {
    const res = await fetch(`${API}/productos/barcode/${encodeURIComponent(codigo)}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      feedback.textContent = `✕ Código "${codigo}" no encontrado en el sistema.`;
      feedback.className = "scan-feedback error";
      return;
    }

    const producto = data.data;

    if (producto.stock <= 0) {
      feedback.textContent = `⚠ "${producto.nombre}" sin stock disponible.`;
      feedback.className = "scan-feedback warning";
      return;
    }

    agregarAlCarrito(producto);
    feedback.textContent = `✓ ${producto.nombre} agregado al carrito.`;
    feedback.className = "scan-feedback success";

  } catch (err) {
    feedback.textContent = "✕ Error de conexión con el servidor.";
    feedback.className = "scan-feedback error";
    console.error(err);
  } finally {
    input.focus();
    // Limpiar feedback después de 3 segundos
    setTimeout(() => {
      if (feedback.className !== "scan-feedback") {
        feedback.textContent = "";
        feedback.className = "scan-feedback";
      }
    }, 3000);
  }
}

/**
 * Agrega un producto al carrito o incrementa su cantidad si ya existe.
 */
function agregarAlCarrito(producto) {
  const idx = state.carrito.findIndex(i => i.producto_id === producto.id);

  if (idx >= 0) {
    // Ya existe: incrementar cantidad
    state.carrito[idx].cantidad++;
    state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit;
  } else {
    // Nuevo ítem
    state.carrito.push({
      producto_id: producto.id,
      codigo_barras: producto.codigo_barras,
      nombre: producto.nombre,
      precio_unit: producto.precio,
      cantidad: 1,
      subtotal: producto.precio,
    });
  }

  recalcularTotal();
  renderizarCarrito();
}

/**
 * Cambia la cantidad de un ítem en el carrito.
 */
function cambiarCantidad(productoId, delta) {
  const idx = state.carrito.findIndex(i => i.producto_id === productoId);
  if (idx < 0) return;

  state.carrito[idx].cantidad += delta;

  if (state.carrito[idx].cantidad <= 0) {
    state.carrito.splice(idx, 1);
  } else {
    state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit;
  }

  recalcularTotal();
  renderizarCarrito();
}

/**
 * Elimina un ítem del carrito por su producto_id.
 */
function eliminarDelCarrito(productoId) {
  state.carrito = state.carrito.filter(i => i.producto_id !== productoId);
  recalcularTotal();
  renderizarCarrito();
}

/**
 * Vacía completamente el carrito.
 */
function limpiarCarrito() {
  state.carrito = [];
  state.total = 0;
  renderizarCarrito();
}

/**
 * Recalcula el total del carrito.
 */
function recalcularTotal() {
  state.total = state.carrito.reduce((acc, item) => acc + item.subtotal, 0);
}

/**
 * Renderiza el carrito en la tabla HTML.
 */
function renderizarCarrito() {
  const tbody = document.getElementById("cart-body");
  const empty = document.getElementById("cart-empty");
  const countEl = document.getElementById("cart-count");
  const btnCobrar = document.getElementById("btn-cobrar");

  const totalItems = state.carrito.reduce((acc, i) => acc + i.cantidad, 0);
  countEl.textContent = `${totalItems} ítem${totalItems !== 1 ? "s" : ""}`;

  if (state.carrito.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "flex";
    btnCobrar.disabled = true;
  } else {
    empty.style.display = "none";
    btnCobrar.disabled = false;

    tbody.innerHTML = state.carrito.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="td-nombre">${escapeHtml(item.nombre)}</td>
        <td class="td-precio">${formatPeso(item.precio_unit)}</td>
        <td>
          <div class="qty-controls">
            <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id}, -1)">−</button>
            <span class="qty-value">${item.cantidad}</span>
            <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id}, 1)">+</button>
          </div>
        </td>
        <td class="td-subtotal">${formatPeso(item.subtotal)}</td>
        <td>
          <button class="btn-remove-item" onclick="eliminarDelCarrito(${item.producto_id})" title="Eliminar">✕</button>
        </td>
      </tr>
    `).join("");
  }

  // Actualizar displays de total
  document.getElementById("display-subtotal").textContent = formatPeso(state.total);
  document.getElementById("display-total").textContent = formatPeso(state.total);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MÓDULO COBRO
// ═══════════════════════════════════════════════════════════════════════════════

function abrirModalCobro() {
  if (state.carrito.length === 0) return;

  document.getElementById("modal-total").textContent = formatPeso(state.total);
  document.getElementById("input-efectivo").value = "";
  document.getElementById("modal-vuelto").textContent = "—";
  document.getElementById("modal-vuelto").className = "vuelto-amount neutral";
  document.getElementById("btn-confirmar").disabled = true;
  document.getElementById("cobro-error").classList.add("hidden");

  document.getElementById("modal-cobro").classList.add("open");
  setTimeout(() => document.getElementById("input-efectivo").focus(), 100);
}

function cerrarModalCobro(e) {
  if (e && e.target !== document.getElementById("modal-cobro")) return;
  document.getElementById("modal-cobro").classList.remove("open");
  document.getElementById("barcode-input").focus();
}

function calcularVuelto() {
  const efectivo = parseFloat(document.getElementById("input-efectivo").value) || 0;
  const vueltoEl = document.getElementById("modal-vuelto");
  const btnConfirmar = document.getElementById("btn-confirmar");
  const errorEl = document.getElementById("cobro-error");

  if (efectivo <= 0) {
    vueltoEl.textContent = "—";
    vueltoEl.className = "vuelto-amount neutral";
    btnConfirmar.disabled = true;
    return;
  }

  const vuelto = efectivo - state.total;

  if (vuelto < 0) {
    vueltoEl.textContent = `Faltan ${formatPeso(Math.abs(vuelto))}`;
    vueltoEl.className = "vuelto-amount insuf";
    errorEl.textContent = "El efectivo ingresado es menor al total.";
    errorEl.classList.remove("hidden");
    btnConfirmar.disabled = true;
  } else {
    vueltoEl.textContent = formatPeso(vuelto);
    vueltoEl.className = "vuelto-amount ok";
    errorEl.classList.add("hidden");
    btnConfirmar.disabled = false;
  }
}

/**
 * Establece un monto rápido de billete en el input de efectivo.
 * Si el monto es menor al total, suma el siguiente billete automáticamente.
 */
function setBillete(monto) {
  const input = document.getElementById("input-efectivo");
  // Si el billete elegido es menor al total, completar con ese billete de todas formas
  // (el usuario puede combinar). Si es mayor o igual, reemplazar.
  const actual = parseFloat(input.value) || 0;
  input.value = actual > 0 && actual < state.total ? actual + monto : monto;
  calcularVuelto();
  input.focus();
}

function handleCobroKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    const btn = document.getElementById("btn-confirmar");
    if (!btn.disabled) procesarVenta();
  }
}

/**
 * Envía la venta al backend.
 */
async function procesarVenta() {
  const efectivo = parseFloat(document.getElementById("input-efectivo").value) || 0;
  const vuelto = efectivo - state.total;
  const btnConfirmar = document.getElementById("btn-confirmar");
  const btnText = document.getElementById("btn-confirmar-text");

  // UI: estado de carga
  btnConfirmar.disabled = true;
  btnText.innerHTML = `<span class="spinner"></span> Procesando...`;

  const payload = {
    items: state.carrito.map(i => ({
      producto_id: i.producto_id,
      cantidad: i.cantidad,
      precio_unit: i.precio_unit,
      subtotal: i.subtotal,
    })),
    total: state.total,
    efectivo,
    vuelto,
  };

  try {
    const res = await fetch(`${API}/ventas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.mensaje || "Error desconocido al procesar la venta.");
    }

    // Éxito: cerrar modal de cobro y mostrar comprobante
    document.getElementById("modal-cobro").classList.remove("open");
    mostrarComprobante(data.data, efectivo, vuelto);
    limpiarCarrito();

  } catch (err) {
    const errorEl = document.getElementById("cobro-error");
    errorEl.textContent = `Error: ${err.message}`;
    errorEl.classList.remove("hidden");
    btnConfirmar.disabled = false;
    btnText.textContent = "Confirmar Venta";
    console.error(err);
  }
}

// ─── Comprobante ──────────────────────────────────────────────────────────────
function mostrarComprobante(venta, efectivo, vuelto) {
  const body = document.getElementById("comprobante-body");
  const fecha = new Date().toLocaleString("es-AR");

  body.innerHTML = `
    <div class="comprobante-header">
      <div>Factura Electrónica Tipo C</div>
      <div>Pto. Venta: ${String(venta.punto_venta).padStart(4, "0")} | Comp. Nro: ${String(venta.nro_comprobante).padStart(8, "0")}</div>
      <div class="comp-cae">CAE: ${venta.cae}</div>
      <div>Vto. CAE: ${formatFechaCAE(venta.cae_vto)}</div>
    </div>
    <div class="comprobante-row"><span>Fecha</span><span class="val">${fecha}</span></div>
    <div class="comprobante-row"><span>Venta ID</span><span class="val">#${venta.venta_id}</span></div>
    <div class="comprobante-row"><span>Efectivo</span><span class="val">${formatPeso(efectivo)}</span></div>
    <div class="comprobante-row"><span>Vuelto</span><span class="val">${formatPeso(vuelto)}</span></div>
    <div class="comprobante-total"><span>TOTAL</span><span class="val">${formatPeso(venta.total)}</span></div>
  `;

  document.getElementById("modal-comprobante").classList.add("open");
}

function cerrarModalComprobante(e) {
  if (e && e.target !== document.getElementById("modal-comprobante")) return;
  document.getElementById("modal-comprobante").classList.remove("open");
  document.getElementById("barcode-input").focus();
}

// Al presionar Enter en el modal de comprobante, cerrarlo
document.addEventListener("keydown", (e) => {
  const modalComp = document.getElementById("modal-comprobante");
  if (e.key === "Enter" && modalComp.classList.contains("open")) {
    cerrarModalComprobante();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  MÓDULO INVENTARIO (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════

let todosLosProductos = [];

async function cargarInventario() {
  const tbody = document.getElementById("inv-body");
  tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Cargando...</td></tr>`;

  try {
    const res = await fetch(`${API}/productos`);
    const data = await res.json();
    todosLosProductos = data.data || [];
    renderizarInventario(todosLosProductos);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-row" style="color:var(--danger)">Error al cargar productos.</td></tr>`;
  }
}

function buscarProductos() {
  const q = document.getElementById("inv-search").value.toLowerCase();
  const filtrados = todosLosProductos.filter(p =>
    p.nombre.toLowerCase().includes(q) || p.codigo_barras.includes(q)
  );
  renderizarInventario(filtrados);
}

function renderizarInventario(productos) {
  const tbody = document.getElementById("inv-body");

  if (productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="loading-row">No se encontraron productos.</td></tr>`;
    return;
  }

  tbody.innerHTML = productos.map(p => {
    const stockClass = p.stock === 0 ? "stock-cero" : p.stock <= 5 ? "stock-bajo" : "stock-ok";
    const fecha = p.actualizado_en ? p.actualizado_en.split(" ")[0] : "—";
    return `
      <tr>
        <td class="td-id">${p.id}</td>
        <td class="td-codigo">${escapeHtml(p.codigo_barras)}</td>
        <td class="td-nombre">${escapeHtml(p.nombre)}</td>
        <td class="td-precio">${formatPeso(p.precio)}</td>
        <td class="td-stock ${stockClass}">${p.stock}</td>
        <td class="td-fecha">${fecha}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" onclick="abrirModalProducto(${p.id})">Editar</button>
            <button class="btn-delete" onclick="eliminarProducto(${p.id}, '${escapeHtml(p.nombre)}')">✕</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ─── Modal Producto ───────────────────────────────────────────────────────────
function abrirModalProducto(id = null) {
  const modal = document.getElementById("modal-producto");
  const titulo = document.getElementById("modal-producto-title");
  const btnText = document.getElementById("prod-btn-text");
  const errorEl = document.getElementById("prod-error");

  errorEl.classList.add("hidden");
  document.getElementById("prod-id").value = "";
  document.getElementById("prod-codigo").value = "";
  document.getElementById("prod-nombre").value = "";
  document.getElementById("prod-precio").value = "";
  document.getElementById("prod-stock").value = "";

  if (id) {
    const prod = todosLosProductos.find(p => p.id === id);
    if (!prod) return;

    titulo.textContent = "Editar Producto";
    btnText.textContent = "Guardar Cambios";
    document.getElementById("prod-id").value = prod.id;
    document.getElementById("prod-codigo").value = prod.codigo_barras;
    document.getElementById("prod-nombre").value = prod.nombre;
    document.getElementById("prod-precio").value = prod.precio;
    document.getElementById("prod-stock").value = prod.stock;
  } else {
    titulo.textContent = "Nuevo Producto";
    btnText.textContent = "Guardar Producto";
  }

  modal.classList.add("open");
  setTimeout(() => document.getElementById("prod-codigo").focus(), 100);
}

function cerrarModalProducto(e) {
  if (e && e.target !== document.getElementById("modal-producto")) return;
  document.getElementById("modal-producto").classList.remove("open");
}

async function guardarProducto() {
  const id = document.getElementById("prod-id").value;
  const codigo_barras = document.getElementById("prod-codigo").value.trim();
  const nombre = document.getElementById("prod-nombre").value.trim();
  const precio = parseFloat(document.getElementById("prod-precio").value);
  const stock = parseInt(document.getElementById("prod-stock").value) || 0;
  const errorEl = document.getElementById("prod-error");

  // Validación
  if (!codigo_barras || !nombre || isNaN(precio)) {
    errorEl.textContent = "Completá los campos obligatorios: código, nombre y precio.";
    errorEl.classList.remove("hidden");
    return;
  }

  const payload = { codigo_barras, nombre, precio, stock };
  const url = id ? `${API}/productos/${id}` : `${API}/productos`;
  const method = id ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      errorEl.textContent = data.mensaje || "Error al guardar.";
      errorEl.classList.remove("hidden");
      return;
    }

    cerrarModalProducto();
    mostrarToast(id ? "Producto actualizado." : "Producto creado.", "success");
    cargarInventario();

  } catch (err) {
    errorEl.textContent = "Error de conexión.";
    errorEl.classList.remove("hidden");
  }
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;

  try {
    const res = await fetch(`${API}/productos/${id}`, { method: "DELETE" });
    const data = await res.json();

    if (!res.ok || !data.success) throw new Error(data.mensaje);

    mostrarToast(`"${nombre}" eliminado.`, "success");
    cargarInventario();
  } catch (err) {
    mostrarToast(`Error: ${err.message}`, "error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Formatea un número como peso argentino: $1.234,50
 */
function formatPeso(valor) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 2,
  }).format(valor);
}

/**
 * Formatea una fecha en formato YYYYMMDD a DD/MM/YYYY.
 */
function formatFechaCAE(str) {
  if (!str || str.length !== 8) return str;
  return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
}

/**
 * Escapa HTML para prevenir XSS.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Muestra una notificación toast temporal.
 */
function mostrarToast(mensaje, tipo = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  const iconos = { success: "✓", error: "✕", warning: "⚠" };
  toast.innerHTML = `<span>${iconos[tipo] || "•"}</span> ${escapeHtml(mensaje)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "toastOut 0.25s ease forwards";
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}
