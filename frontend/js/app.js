// app.js - Lógica completa del frontend POS Argentina con autenticación JWT

const API = "http://localhost:3000/api";

const state = {
  carrito: [],
  total: 0,
  vistaActual: "pos",
  usuario: null,
  token: null,
};

// ═══ AUTENTICACIÓN ════════════════════════════════════════════════════════════

async function verificarSesion() {
  const token = localStorage.getItem("pos_token");
  const usuarioGuardado = localStorage.getItem("pos_usuario");
  if (!token || !usuarioGuardado) { window.location.href = "/login.html"; return false; }
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { "Authorization": `Bearer ${token}` } });
    if (!res.ok) throw new Error("Token inválido");
    state.token = token;
    state.usuario = JSON.parse(usuarioGuardado);
    return true;
  } catch (_) { cerrarSesion(); return false; }
}

function cerrarSesion() {
  localStorage.removeItem("pos_token");
  localStorage.removeItem("pos_usuario");
  window.location.href = "/login.html";
}

async function apiFetch(url, opciones = {}) {
  const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${state.token}`, ...opciones.headers };
  const res = await fetch(url, { ...opciones, headers });
  if (res.status === 401) {
    mostrarToast("Sesión expirada. Iniciá sesión nuevamente.", "error");
    setTimeout(cerrarSesion, 1500);
    throw new Error("Sesión expirada");
  }
  return res;
}

// ═══ INICIALIZACIÓN ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  const sesionOk = await verificarSesion();
  if (!sesionOk) return;

  document.getElementById("header-nombre").textContent = state.usuario.nombre;
  document.getElementById("header-rol").textContent = state.usuario.rol.toUpperCase();

  if (state.usuario.rol === "admin") {
    document.getElementById("nav-usuarios").style.display = "flex";
    document.getElementById("nav-inventario").style.display = "flex";
  } else {
    document.getElementById("nav-usuarios").style.display = "none";
    document.getElementById("nav-inventario").style.display = "none";
  }

  iniciarReloj();
  registrarAtajos();
  document.getElementById("barcode-input").focus();
});

function iniciarReloj() {
  const el = document.getElementById("clock");
  const tick = () => { el.textContent = new Date().toLocaleTimeString("es-AR"); };
  tick(); setInterval(tick, 1000);
}

function switchView(vista) {
  if (vista !== "pos" && state.usuario.rol === "cajero") {
    mostrarToast("No tenés permisos para esa sección.", "error"); return;
  }
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`view-${vista}`).classList.add("active");
  document.querySelector(`[data-view="${vista}"]`).classList.add("active");
  state.vistaActual = vista;
  if (vista === "pos") setTimeout(() => document.getElementById("barcode-input").focus(), 50);
  if (vista === "inventario") cargarInventario();
  if (vista === "usuarios") cargarUsuarios();
}

function registrarAtajos() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2") { e.preventDefault(); if (state.carrito.length > 0) abrirModalCobro(); }
    if (e.key === "Escape") {
      const m = document.querySelector(".modal-overlay.open");
      if (!m && state.vistaActual === "pos") limpiarCarrito();
    }
    if (e.key === "F5") { e.preventDefault(); switchView(state.vistaActual === "pos" ? "inventario" : "pos"); }
  });
  document.getElementById("barcode-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); const c = e.target.value.trim(); if (c) buscarYAgregarProducto(c); }
  });
}

// ═══ CARRITO ══════════════════════════════════════════════════════════════════

async function buscarYAgregarProducto(codigo) {
  const input = document.getElementById("barcode-input");
  const feedback = document.getElementById("scan-feedback");
  feedback.textContent = "Buscando..."; feedback.className = "scan-feedback"; input.value = "";
  try {
    const res = await apiFetch(`${API}/productos/barcode/${encodeURIComponent(codigo)}`);
    const data = await res.json();
    if (!res.ok || !data.success) { feedback.textContent = `✕ Código "${codigo}" no encontrado.`; feedback.className = "scan-feedback error"; return; }
    const p = data.data;
    if (p.stock <= 0) { feedback.textContent = `⚠ "${p.nombre}" sin stock.`; feedback.className = "scan-feedback warning"; return; }
    agregarAlCarrito(p);
    feedback.textContent = `✓ ${p.nombre} agregado.`; feedback.className = "scan-feedback success";
  } catch (err) {
    if (err.message !== "Sesión expirada") { feedback.textContent = "✕ Error de conexión."; feedback.className = "scan-feedback error"; }
  } finally {
    input.focus();
    setTimeout(() => { feedback.textContent = ""; feedback.className = "scan-feedback"; }, 3000);
  }
}

function agregarAlCarrito(producto) {
  const idx = state.carrito.findIndex(i => i.producto_id === producto.id);
  if (idx >= 0) { state.carrito[idx].cantidad++; state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit; }
  else state.carrito.push({ producto_id: producto.id, codigo_barras: producto.codigo_barras, nombre: producto.nombre, precio_unit: producto.precio, cantidad: 1, subtotal: producto.precio });
  recalcularTotal(); renderizarCarrito();
}

function cambiarCantidad(productoId, delta) {
  const idx = state.carrito.findIndex(i => i.producto_id === productoId);
  if (idx < 0) return;
  state.carrito[idx].cantidad += delta;
  if (state.carrito[idx].cantidad <= 0) state.carrito.splice(idx, 1);
  else state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit;
  recalcularTotal(); renderizarCarrito();
}

function eliminarDelCarrito(productoId) { state.carrito = state.carrito.filter(i => i.producto_id !== productoId); recalcularTotal(); renderizarCarrito(); }
function limpiarCarrito() { state.carrito = []; state.total = 0; renderizarCarrito(); }
function recalcularTotal() { state.total = state.carrito.reduce((acc, i) => acc + i.subtotal, 0); }

function renderizarCarrito() {
  const tbody = document.getElementById("cart-body");
  const empty = document.getElementById("cart-empty");
  const totalItems = state.carrito.reduce((acc, i) => acc + i.cantidad, 0);
  document.getElementById("cart-count").textContent = `${totalItems} ítem${totalItems !== 1 ? "s" : ""}`;
  const btnCobrar = document.getElementById("btn-cobrar");
  if (state.carrito.length === 0) { tbody.innerHTML = ""; empty.style.display = "flex"; btnCobrar.disabled = true; }
  else {
    empty.style.display = "none"; btnCobrar.disabled = false;
    tbody.innerHTML = state.carrito.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="td-nombre">${escapeHtml(item.nombre)}</td>
        <td class="td-precio">${formatPeso(item.precio_unit)}</td>
        <td><div class="qty-controls">
          <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id}, -1)">−</button>
          <span class="qty-value">${item.cantidad}</span>
          <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id}, 1)">+</button>
        </div></td>
        <td class="td-subtotal">${formatPeso(item.subtotal)}</td>
        <td><button class="btn-remove-item" onclick="eliminarDelCarrito(${item.producto_id})">✕</button></td>
      </tr>`).join("");
  }
  document.getElementById("display-subtotal").textContent = formatPeso(state.total);
  document.getElementById("display-total").textContent = formatPeso(state.total);
}

// ═══ COBRO ════════════════════════════════════════════════════════════════════

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
  const errorEl = document.getElementById("cobro-error");
  const btn = document.getElementById("btn-confirmar");
  if (efectivo <= 0) { vueltoEl.textContent = "—"; vueltoEl.className = "vuelto-amount neutral"; btn.disabled = true; return; }
  const vuelto = efectivo - state.total;
  if (vuelto < 0) { vueltoEl.textContent = `Faltan ${formatPeso(Math.abs(vuelto))}`; vueltoEl.className = "vuelto-amount insuf"; errorEl.textContent = "El efectivo es menor al total."; errorEl.classList.remove("hidden"); btn.disabled = true; }
  else { vueltoEl.textContent = formatPeso(vuelto); vueltoEl.className = "vuelto-amount ok"; errorEl.classList.add("hidden"); btn.disabled = false; }
}

function setBillete(monto) {
  const input = document.getElementById("input-efectivo");
  const actual = parseFloat(input.value) || 0;
  input.value = actual > 0 && actual < state.total ? actual + monto : monto;
  calcularVuelto(); input.focus();
}

function handleCobroKey(e) { if (e.key === "Enter") { e.preventDefault(); if (!document.getElementById("btn-confirmar").disabled) procesarVenta(); } }

async function procesarVenta() {
  const efectivo = parseFloat(document.getElementById("input-efectivo").value) || 0;
  const vuelto = efectivo - state.total;
  const btn = document.getElementById("btn-confirmar");
  const btnText = document.getElementById("btn-confirmar-text");
  btn.disabled = true; btnText.innerHTML = `<span class="spinner"></span> Procesando...`;
  try {
    const res = await apiFetch(`${API}/ventas`, { method: "POST", body: JSON.stringify({ items: state.carrito.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad, precio_unit: i.precio_unit, subtotal: i.subtotal })), total: state.total, efectivo, vuelto }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje || "Error desconocido.");
    document.getElementById("modal-cobro").classList.remove("open");
    mostrarComprobante(data.data, efectivo, vuelto);
    limpiarCarrito();
  } catch (err) {
    if (err.message !== "Sesión expirada") { const el = document.getElementById("cobro-error"); el.textContent = `Error: ${err.message}`; el.classList.remove("hidden"); }
    btn.disabled = false; btnText.textContent = "Confirmar Venta";
  }
}

function mostrarComprobante(venta, efectivo, vuelto) {
  document.getElementById("comprobante-body").innerHTML = `
    <div class="comprobante-header">
      <div>Factura Electrónica Tipo C</div>
      <div>Pto. Venta: ${String(venta.punto_venta).padStart(4,"0")} | Comp. Nro: ${String(venta.nro_comprobante).padStart(8,"0")}</div>
      <div class="comp-cae">CAE: ${venta.cae}</div>
      <div>Vto. CAE: ${formatFechaCAE(venta.cae_vto)}</div>
    </div>
    <div class="comprobante-row"><span>Fecha</span><span class="val">${new Date().toLocaleString("es-AR")}</span></div>
    <div class="comprobante-row"><span>Cajero</span><span class="val">${escapeHtml(state.usuario.nombre)}</span></div>
    <div class="comprobante-row"><span>Venta ID</span><span class="val">#${venta.venta_id}</span></div>
    <div class="comprobante-row"><span>Efectivo</span><span class="val">${formatPeso(efectivo)}</span></div>
    <div class="comprobante-row"><span>Vuelto</span><span class="val">${formatPeso(vuelto)}</span></div>
    <div class="comprobante-total"><span>TOTAL</span><span class="val">${formatPeso(venta.total)}</span></div>`;
  document.getElementById("modal-comprobante").classList.add("open");
}

function cerrarModalComprobante(e) {
  if (e && e.target !== document.getElementById("modal-comprobante")) return;
  document.getElementById("modal-comprobante").classList.remove("open");
  document.getElementById("barcode-input").focus();
}
document.addEventListener("keydown", (e) => { const m = document.getElementById("modal-comprobante"); if (e.key === "Enter" && m && m.classList.contains("open")) cerrarModalComprobante(); });

// ═══ INVENTARIO ═══════════════════════════════════════════════════════════════

let todosLosProductos = [];

async function cargarInventario() {
  const tbody = document.getElementById("inv-body");
  tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Cargando...</td></tr>`;
  try { const res = await apiFetch(`${API}/productos`); const data = await res.json(); todosLosProductos = data.data || []; renderizarInventario(todosLosProductos); }
  catch (err) { if (err.message !== "Sesión expirada") tbody.innerHTML = `<tr><td colspan="7" class="loading-row" style="color:var(--danger)">Error al cargar productos.</td></tr>`; }
}

function buscarProductos() {
  const q = document.getElementById("inv-search").value.toLowerCase();
  renderizarInventario(todosLosProductos.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo_barras.includes(q)));
}

function renderizarInventario(productos) {
  const tbody = document.getElementById("inv-body");
  if (!productos.length) { tbody.innerHTML = `<tr><td colspan="7" class="loading-row">No se encontraron productos.</td></tr>`; return; }
  tbody.innerHTML = productos.map(p => {
    const sc = p.stock === 0 ? "stock-cero" : p.stock <= 5 ? "stock-bajo" : "stock-ok";
    return `<tr>
      <td class="td-id">${p.id}</td><td class="td-codigo">${escapeHtml(p.codigo_barras)}</td>
      <td class="td-nombre">${escapeHtml(p.nombre)}</td><td class="td-precio">${formatPeso(p.precio)}</td>
      <td class="td-stock ${sc}">${p.stock}</td>
      <td class="td-fecha">${p.actualizado_en ? p.actualizado_en.split(" ")[0] : "—"}</td>
      <td><div class="action-btns"><button class="btn-edit" onclick="abrirModalProducto(${p.id})">Editar</button><button class="btn-delete" onclick="eliminarProducto(${p.id}, '${escapeHtml(p.nombre)}')">✕</button></div></td>
    </tr>`; }).join("");
}

function abrirModalProducto(id = null) {
  const modal = document.getElementById("modal-producto");
  document.getElementById("modal-producto-title").textContent = id ? "Editar Producto" : "Nuevo Producto";
  document.getElementById("prod-btn-text").textContent = id ? "Guardar Cambios" : "Guardar Producto";
  document.getElementById("prod-error").classList.add("hidden");
  ["prod-id","prod-codigo","prod-nombre","prod-precio","prod-stock"].forEach(id => document.getElementById(id).value = "");
  if (id) { const p = todosLosProductos.find(p => p.id === id); if (!p) return; document.getElementById("prod-id").value = p.id; document.getElementById("prod-codigo").value = p.codigo_barras; document.getElementById("prod-nombre").value = p.nombre; document.getElementById("prod-precio").value = p.precio; document.getElementById("prod-stock").value = p.stock; }
  modal.classList.add("open"); setTimeout(() => document.getElementById("prod-codigo").focus(), 100);
}

function cerrarModalProducto(e) { if (e && e.target !== document.getElementById("modal-producto")) return; document.getElementById("modal-producto").classList.remove("open"); }

async function guardarProducto() {
  const id = document.getElementById("prod-id").value;
  const codigo_barras = document.getElementById("prod-codigo").value.trim();
  const nombre = document.getElementById("prod-nombre").value.trim();
  const precio = parseFloat(document.getElementById("prod-precio").value);
  const stock = parseInt(document.getElementById("prod-stock").value) || 0;
  const errorEl = document.getElementById("prod-error");
  if (!codigo_barras || !nombre || isNaN(precio)) { errorEl.textContent = "Completá los campos obligatorios."; errorEl.classList.remove("hidden"); return; }
  try {
    const res = await apiFetch(id ? `${API}/productos/${id}` : `${API}/productos`, { method: id ? "PUT" : "POST", body: JSON.stringify({ codigo_barras, nombre, precio, stock }) });
    const data = await res.json();
    if (!res.ok || !data.success) { errorEl.textContent = data.mensaje || "Error al guardar."; errorEl.classList.remove("hidden"); return; }
    cerrarModalProducto(); mostrarToast(id ? "Producto actualizado." : "Producto creado.", "success"); cargarInventario();
  } catch (err) { if (err.message !== "Sesión expirada") { errorEl.textContent = "Error de conexión."; errorEl.classList.remove("hidden"); } }
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  try { const res = await apiFetch(`${API}/productos/${id}`, { method: "DELETE" }); const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.mensaje); mostrarToast(`"${nombre}" eliminado.`, "success"); cargarInventario(); }
  catch (err) { if (err.message !== "Sesión expirada") mostrarToast(`Error: ${err.message}`, "error"); }
}

// ═══ USUARIOS (solo admin) ════════════════════════════════════════════════════

let todosLosUsuarios = [];

async function cargarUsuarios() {
  const tbody = document.getElementById("usr-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Cargando...</td></tr>`;
  try { const res = await apiFetch(`${API}/auth/usuarios`); const data = await res.json(); todosLosUsuarios = data.data || []; renderizarUsuarios(todosLosUsuarios); }
  catch (err) { if (err.message !== "Sesión expirada") tbody.innerHTML = `<tr><td colspan="7" class="loading-row" style="color:var(--danger)">Error al cargar usuarios.</td></tr>`; }
}

function renderizarUsuarios(usuarios) {
  const tbody = document.getElementById("usr-body");
  if (!tbody || !usuarios.length) { if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="loading-row">No hay usuarios.</td></tr>`; return; }
  tbody.innerHTML = usuarios.map(u => `<tr>
    <td class="td-id">${u.id}</td>
    <td class="td-nombre">${escapeHtml(u.nombre)}</td>
    <td class="td-codigo">${escapeHtml(u.usuario)}</td>
    <td><span class="rol-badge rol-${u.rol}">${u.rol.toUpperCase()}</span></td>
    <td><span class="estado-badge ${u.activo ? 'activo' : 'inactivo'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
    <td class="td-fecha">${u.ultimo_acceso ? u.ultimo_acceso.split(" ")[0] : "—"}</td>
    <td><div class="action-btns">
      <button class="btn-edit" onclick="abrirModalUsuario(${u.id})">Editar</button>
      ${u.id !== state.usuario.id ? `<button class="btn-delete" onclick="eliminarUsuario(${u.id}, '${escapeHtml(u.nombre)}')">✕</button>` : `<span style="color:var(--text-muted);font-size:0.75rem;padding:0 8px">Tú</span>`}
    </div></td>
  </tr>`).join("");
}

function abrirModalUsuario(id = null) {
  const modal = document.getElementById("modal-usuario");
  document.getElementById("modal-usuario-title").textContent = id ? "Editar Usuario" : "Nuevo Usuario";
  document.getElementById("usr-btn-text").textContent = id ? "Guardar Cambios" : "Crear Usuario";
  document.getElementById("usr-error").classList.add("hidden");
  ["usr-id","usr-nombre","usr-usuario","usr-password"].forEach(i => document.getElementById(i).value = "");
  document.getElementById("usr-rol").value = "cajero";
  document.getElementById("usr-activo").checked = true;
  document.getElementById("usr-password-label").textContent = id ? "Nueva contraseña (vacío = no cambiar)" : "Contraseña *";
  if (id) { const u = todosLosUsuarios.find(u => u.id === id); if (!u) return; document.getElementById("usr-id").value = u.id; document.getElementById("usr-nombre").value = u.nombre; document.getElementById("usr-usuario").value = u.usuario; document.getElementById("usr-rol").value = u.rol; document.getElementById("usr-activo").checked = u.activo === 1; }
  modal.classList.add("open"); setTimeout(() => document.getElementById("usr-nombre").focus(), 100);
}

function cerrarModalUsuario(e) { if (e && e.target !== document.getElementById("modal-usuario")) return; document.getElementById("modal-usuario").classList.remove("open"); }

async function guardarUsuario() {
  const id = document.getElementById("usr-id").value;
  const nombre = document.getElementById("usr-nombre").value.trim();
  const usuario = document.getElementById("usr-usuario").value.trim();
  const password = document.getElementById("usr-password").value;
  const rol = document.getElementById("usr-rol").value;
  const activo = document.getElementById("usr-activo").checked;
  const errorEl = document.getElementById("usr-error");
  if (!nombre || !usuario) { errorEl.textContent = "Nombre y usuario son requeridos."; errorEl.classList.remove("hidden"); return; }
  if (!id && !password) { errorEl.textContent = "La contraseña es requerida para nuevos usuarios."; errorEl.classList.remove("hidden"); return; }
  const payload = { nombre, usuario, rol, activo };
  if (password) payload.password = password;
  try {
    const res = await apiFetch(id ? `${API}/auth/usuarios/${id}` : `${API}/auth/usuarios`, { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) { errorEl.textContent = data.mensaje || "Error al guardar."; errorEl.classList.remove("hidden"); return; }
    cerrarModalUsuario(); mostrarToast(id ? "Usuario actualizado." : "Usuario creado.", "success"); cargarUsuarios();
  } catch (err) { if (err.message !== "Sesión expirada") { errorEl.textContent = "Error de conexión."; errorEl.classList.remove("hidden"); } }
}

async function eliminarUsuario(id, nombre) {
  if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return;
  try { const res = await apiFetch(`${API}/auth/usuarios/${id}`, { method: "DELETE" }); const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.mensaje); mostrarToast(`Usuario "${nombre}" eliminado.`, "success"); cargarUsuarios(); }
  catch (err) { if (err.message !== "Sesión expirada") mostrarToast(`Error: ${err.message}`, "error"); }
}

// ═══ UTILIDADES ═══════════════════════════════════════════════════════════════

function formatPeso(v) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 }).format(v); }
function formatFechaCAE(s) { if (!s || s.length !== 8) return s; return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`; }
function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function mostrarToast(mensaje, tipo = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `<span>${{success:"✓",error:"✕",warning:"⚠"}[tipo]||"•"}</span> ${escapeHtml(mensaje)}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = "toastOut 0.25s ease forwards"; setTimeout(() => toast.remove(), 250); }, 3000);
}
