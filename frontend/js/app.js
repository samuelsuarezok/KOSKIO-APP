// app.js — KOSKIO APP v1.3.0 — con impresión de ticket

const API = "http://localhost:3000/api";

// Configuración del negocio (el admin puede cambiar esto)
const CONFIG_NEGOCIO = {
  nombre:      localStorage.getItem("cfg_negocio")   || "KOSKIO APP",
  direccion:   localStorage.getItem("cfg_direccion")  || "— Kiosco / Almacén —",
  cuit:        localStorage.getItem("cfg_cuit")       || "",
  footer_extra:localStorage.getItem("cfg_footer")     || "",
};

const state = {
  carrito: [],
  total: 0,
  vistaActual: "pos",
  usuario: null,
  token: null,
  ventasPagina: 1,
};

// ═══ AUTENTICACIÓN ════════════════════════════════════════════════════════════

async function verificarSesion() {
  const token = localStorage.getItem("pos_token");
  const usr   = localStorage.getItem("pos_usuario");
  if (!token || !usr) { window.location.href = "/login.html"; return false; }
  try {
    const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error();
    state.token   = token;
    state.usuario = JSON.parse(usr);
    return true;
  } catch (_) { cerrarSesion(); return false; }
}

function cerrarSesion() {
  localStorage.removeItem("pos_token");
  localStorage.removeItem("pos_usuario");
  window.location.href = "/login.html";
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}`, ...opts.headers },
  });
  if (res.status === 401) {
    mostrarToast("Sesión expirada. Iniciá sesión nuevamente.", "error");
    setTimeout(cerrarSesion, 1500);
    throw new Error("Sesión expirada");
  }
  return res;
}

// ═══ INICIALIZACIÓN ═══════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await verificarSesion())) return;

  document.getElementById("header-nombre").textContent = state.usuario.nombre;
  document.getElementById("header-rol").textContent    = state.usuario.rol.toUpperCase();

  const esAdmin = state.usuario.rol === "admin";
  // Caja e inventario: visibles para todos
  // Usuarios y backup: solo admin
  document.getElementById("nav-caja").style.display      = "flex";
  document.getElementById("nav-inventario").style.display = "flex";
  document.getElementById("nav-usuarios").style.display  = esAdmin ? "flex" : "none";

  const hoy = new Date().toISOString().split("T")[0];
  document.getElementById("filtro-desde").value = hoy;
  document.getElementById("filtro-hasta").value = hoy;
  document.getElementById("caja-fecha").value   = hoy;

  iniciarReloj();
  registrarAtajos();
  document.getElementById("barcode-input").focus();
});

function iniciarReloj() {
  const el = document.getElementById("clock");
  const tick = () => { el.textContent = new Date().toLocaleTimeString("es-AR"); };
  tick(); setInterval(tick, 1000);
}

// ═══ NAVEGACIÓN ═══════════════════════════════════════════════════════════════

function switchView(vista) {
  const soloAdmin = ["usuarios"];
  if (soloAdmin.includes(vista) && state.usuario.rol !== "admin") {
    mostrarToast("No tenés permisos para esa sección.", "error"); return;
  }
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`view-${vista}`).classList.add("active");
  document.querySelector(`[data-view="${vista}"]`).classList.add("active");
  state.vistaActual = vista;

  if (vista === "pos")        setTimeout(() => document.getElementById("barcode-input").focus(), 50);
  if (vista === "ventas")     cargarVentas();
  if (vista === "caja")       { cargarCaja(); cargarBackups(); }
  if (vista === "inventario") {
    cargarInventario();
    // Mostrar/ocultar botón nuevo producto según rol
    const btnNuevo = document.getElementById("btn-nuevo-producto");
    if (btnNuevo) btnNuevo.style.display = state.usuario.rol === "admin" ? "" : "none";
  }
  if (vista === "usuarios")   cargarUsuarios();
}

function registrarAtajos() {
  document.addEventListener("keydown", e => {
    if (e.key === "F2") { e.preventDefault(); if (state.carrito.length > 0) abrirModalCobro(); }
    if (e.key === "F5") { e.preventDefault(); switchView("ventas"); }
    if (e.key === "Escape" && !document.querySelector(".modal-overlay.open") && state.vistaActual === "pos")
      limpiarCarrito();
  });
  document.getElementById("barcode-input").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); const c = e.target.value.trim(); if (c) buscarYAgregarProducto(c); }
  });
}

// ═══ CARRITO ══════════════════════════════════════════════════════════════════

async function buscarYAgregarProducto(codigo) {
  const input    = document.getElementById("barcode-input");
  const feedback = document.getElementById("scan-feedback");
  feedback.textContent = "Buscando..."; feedback.className = "scan-feedback"; input.value = "";
  try {
    const res  = await apiFetch(`${API}/productos/barcode/${encodeURIComponent(codigo)}`);
    const data = await res.json();
    if (!res.ok || !data.success) { feedback.textContent = `✕ "${codigo}" no encontrado.`; feedback.className = "scan-feedback error"; return; }
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

function agregarAlCarrito(p) {
  const idx = state.carrito.findIndex(i => i.producto_id === p.id);
  if (idx >= 0) { state.carrito[idx].cantidad++; state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit; }
  else state.carrito.push({ producto_id: p.id, nombre: p.nombre, precio_unit: p.precio, cantidad: 1, subtotal: p.precio });
  recalcularTotal(); renderizarCarrito();
}

function cambiarCantidad(id, delta) {
  const idx = state.carrito.findIndex(i => i.producto_id === id);
  if (idx < 0) return;
  state.carrito[idx].cantidad += delta;
  if (state.carrito[idx].cantidad <= 0) state.carrito.splice(idx, 1);
  else state.carrito[idx].subtotal = state.carrito[idx].cantidad * state.carrito[idx].precio_unit;
  recalcularTotal(); renderizarCarrito();
}

function eliminarDelCarrito(id) { state.carrito = state.carrito.filter(i => i.producto_id !== id); recalcularTotal(); renderizarCarrito(); }
function limpiarCarrito()       { state.carrito = []; state.total = 0; renderizarCarrito(); }
function recalcularTotal()      { state.total = state.carrito.reduce((a, i) => a + i.subtotal, 0); }

function renderizarCarrito() {
  const tbody      = document.getElementById("cart-body");
  const empty      = document.getElementById("cart-empty");
  const btnCobrar  = document.getElementById("btn-cobrar");
  const totalItems = state.carrito.reduce((a, i) => a + i.cantidad, 0);
  document.getElementById("cart-count").textContent = `${totalItems} ítem${totalItems !== 1 ? "s" : ""}`;

  if (!state.carrito.length) { tbody.innerHTML = ""; empty.style.display = "flex"; btnCobrar.disabled = true; }
  else {
    empty.style.display = "none"; btnCobrar.disabled = false;
    tbody.innerHTML = state.carrito.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="td-nombre">${escapeHtml(item.nombre)}</td>
        <td class="td-precio">${formatPeso(item.precio_unit)}</td>
        <td><div class="qty-controls">
          <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id},-1)">−</button>
          <span class="qty-value">${item.cantidad}</span>
          <button class="qty-btn" onclick="cambiarCantidad(${item.producto_id},1)">+</button>
        </div></td>
        <td class="td-subtotal">${formatPeso(item.subtotal)}</td>
        <td><button class="btn-remove-item" onclick="eliminarDelCarrito(${item.producto_id})">✕</button></td>
      </tr>`).join("");
  }
  document.getElementById("display-subtotal").textContent = formatPeso(state.total);
  document.getElementById("display-total").textContent    = formatPeso(state.total);
}

// ═══ COBRO ════════════════════════════════════════════════════════════════════

function abrirModalCobro() {
  if (!state.carrito.length) return;
  document.getElementById("modal-total").textContent = formatPeso(state.total);
  document.getElementById("input-efectivo").value    = "";
  document.getElementById("modal-vuelto").textContent= "—";
  document.getElementById("modal-vuelto").className  = "vuelto-amount neutral";
  document.getElementById("btn-confirmar").disabled  = true;
  document.getElementById("cobro-error").classList.add("hidden");
  // Volver siempre al paso 1
  document.getElementById("cobro-paso-1").classList.remove("hidden");
  document.getElementById("cobro-paso-2").classList.add("hidden");
  document.getElementById("btn-confirmar-text").textContent = "Continuar";
  document.getElementById("btn-confirmar").onclick = irAPasoFactura;
  document.getElementById("modal-cobro").classList.add("open");
  setTimeout(() => document.getElementById("input-efectivo").focus(), 100);
}

function irAPasoFactura() {
  // Pasar al paso 2: elegir si facturar
  document.getElementById("cobro-paso-1").classList.add("hidden");
  document.getElementById("cobro-paso-2").classList.remove("hidden");
  // Ocultar el footer con el botón Continuar
  document.getElementById("cobro-footer").style.display = "none";
}

function cerrarModalCobro(e) {
  if (e && e.target !== document.getElementById("modal-cobro")) return;
  document.getElementById("modal-cobro").classList.remove("open");
  // Restaurar footer por si se cerró en paso 2
  document.getElementById("cobro-footer").style.display = "";
  document.getElementById("barcode-input").focus();
}

function calcularVuelto() {
  const efectivo = parseFloat(document.getElementById("input-efectivo").value) || 0;
  const vueltoEl = document.getElementById("modal-vuelto");
  const errorEl  = document.getElementById("cobro-error");
  const btn      = document.getElementById("btn-confirmar");
  if (efectivo <= 0) { vueltoEl.textContent = "—"; vueltoEl.className = "vuelto-amount neutral"; btn.disabled = true; return; }
  const vuelto = efectivo - state.total;
  if (vuelto < 0) {
    vueltoEl.textContent = `Faltan ${formatPeso(Math.abs(vuelto))}`; vueltoEl.className = "vuelto-amount insuf";
    errorEl.textContent = "El efectivo es menor al total."; errorEl.classList.remove("hidden"); btn.disabled = true;
  } else {
    vueltoEl.textContent = formatPeso(vuelto); vueltoEl.className = "vuelto-amount ok";
    errorEl.classList.add("hidden"); btn.disabled = false;
  }
}

function setBillete(monto) {
  const input  = document.getElementById("input-efectivo");
  const actual = parseFloat(input.value) || 0;
  input.value  = actual > 0 && actual < state.total ? actual + monto : monto;
  calcularVuelto(); input.focus();
}

function handleCobroKey(e) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (!document.getElementById("btn-confirmar").disabled) irAPasoFactura();
  }
}

async function procesarVenta(generar_factura) {
  const efectivo = parseFloat(document.getElementById("input-efectivo").value) || 0;
  const vuelto   = efectivo - state.total;

  // Deshabilitar ambos botones del paso 2 mientras procesa
  document.querySelectorAll(".factura-opcion").forEach(b => {
    b.disabled = true;
    b.style.opacity = "0.5";
    b.style.cursor  = "not-allowed";
  });

  // Mostrar spinner en el botón elegido
  const btnElegido = generar_factura
    ? document.querySelector(".factura-si")
    : document.querySelector(".factura-no");
  const textoOriginal = btnElegido.querySelector(".factura-opcion-titulo").textContent;
  btnElegido.querySelector(".factura-opcion-titulo").innerHTML = `<span class="spinner"></span> Procesando...`;

  try {
    const res = await apiFetch(`${API}/ventas`, {
      method: "POST",
      body: JSON.stringify({
        items: state.carrito.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad, precio_unit: i.precio_unit, subtotal: i.subtotal })),
        total: state.total, efectivo, vuelto,
        generar_factura,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje || "Error desconocido.");

    const itemsVendidos = [...state.carrito];

    // Restaurar footer y cerrar modal
    document.getElementById("cobro-footer").style.display = "";
    document.getElementById("modal-cobro").classList.remove("open");
    mostrarComprobante(data.data, efectivo, vuelto, itemsVendidos);
    limpiarCarrito();

  } catch (err) {
    // Restaurar botones si hay error
    document.querySelectorAll(".factura-opcion").forEach(b => {
      b.disabled = false; b.style.opacity = ""; b.style.cursor = "";
    });
    btnElegido.querySelector(".factura-opcion-titulo").textContent = textoOriginal;

    if (err.message !== "Sesión expirada") {
      // Volver al paso 1 para mostrar el error
      document.getElementById("cobro-paso-2").classList.add("hidden");
      document.getElementById("cobro-paso-1").classList.remove("hidden");
      document.getElementById("cobro-footer").style.display = "";
      const el = document.getElementById("cobro-error");
      el.textContent = `Error: ${err.message}`; el.classList.remove("hidden");
    }
  }
}

// ═══ IMPRESIÓN DE TICKET ══════════════════════════════════════════════════════

/**
 * Construye la URL para ticket.html con todos los datos como query params.
 */
function buildTicketURL(venta, efectivo, vuelto, items, autoprint = false) {
  const p = new URLSearchParams();
  p.set("negocio",     CONFIG_NEGOCIO.nombre);
  p.set("direccion",   CONFIG_NEGOCIO.direccion);
  p.set("cuit",        CONFIG_NEGOCIO.cuit);
  p.set("footer_extra",CONFIG_NEGOCIO.footer_extra);
  p.set("venta_id",    venta.venta_id);
  p.set("pto_venta",   String(venta.punto_venta || 1).padStart(4, "0"));
  p.set("comprobante", String(venta.nro_comprobante || 0).padStart(8, "0"));
  p.set("fecha",       new Date().toLocaleString("es-AR"));
  p.set("cajero",      state.usuario.nombre);
  p.set("total",       venta.total);
  p.set("efectivo",    efectivo);
  p.set("vuelto",      vuelto);
  p.set("cae",         venta.cae || "");
  p.set("cae_vto",     venta.cae_vto || "");
  p.set("items",       encodeURIComponent(JSON.stringify(items.map(i => ({
    nombre:     i.nombre,
    cantidad:   i.cantidad,
    precio_unit:i.precio_unit,
    subtotal:   i.subtotal,
  })))));
  if (autoprint) p.set("autoprint", "1");
  return `/ticket.html?${p.toString()}`;
}

/**
 * Abre el ticket en una nueva pestaña (opcionalmente con autoprint).
 */
function imprimirTicket(venta, efectivo, vuelto, items, autoprint = false) {
  const url = buildTicketURL(venta, efectivo, vuelto, items, autoprint);
  window.open(url, "_blank", "width=420,height=700,menubar=no,toolbar=no,location=no");
}

// ═══ COMPROBANTE (modal post-venta) ═══════════════════════════════════════════

// Guardamos la última venta para poder reimprimir
let ultimaVenta = null;

function mostrarComprobante(venta, efectivo, vuelto, items) {
  ultimaVenta = { venta, efectivo, vuelto, items };

  document.getElementById("comprobante-body").innerHTML = `
    <div class="comprobante-header">
      ${venta.cae
        ? `<div>Factura Electrónica Tipo C</div>
           <div>Pto. Venta: ${String(venta.punto_venta||1).padStart(4,"0")} | Comp. Nro: ${String(venta.nro_comprobante||0).padStart(8,"0")}</div>
           <div class="comp-cae">CAE: ${venta.cae}</div>
           <div>Vto. CAE: ${formatFechaCAE(venta.cae_vto)}</div>`
        : `<div style="font-size:1rem;font-weight:700">Comprobante Interno</div>
           <div style="font-size:0.78rem;color:#888;margin-top:4px">Venta sin factura electrónica</div>`
      }
    </div>
    <div class="comprobante-row"><span>Fecha</span><span class="val">${new Date().toLocaleString("es-AR")}</span></div>
    <div class="comprobante-row"><span>Cajero</span><span class="val">${escapeHtml(state.usuario.nombre)}</span></div>
    <div class="comprobante-row"><span>Venta ID</span><span class="val">#${venta.venta_id}</span></div>
    <div class="comprobante-row"><span>Factura</span><span class="val" style="color:${venta.facturada?"var(--accent)":"var(--text-muted)"}">${venta.facturada?"✅ Con CAE":"— Sin factura"}</span></div>
    <div class="comprobante-row"><span>Efectivo</span><span class="val">${formatPeso(efectivo)}</span></div>
    <div class="comprobante-row"><span>Vuelto</span><span class="val">${formatPeso(vuelto)}</span></div>
    <div class="comprobante-total"><span>TOTAL</span><span class="val">${formatPeso(venta.total)}</span></div>
    <div class="comprobante-print-btns">
      <button class="btn-ticket" onclick="imprimirTicket(ultimaVenta.venta, ultimaVenta.efectivo, ultimaVenta.vuelto, ultimaVenta.items, false)">
        🖨 Ver e Imprimir Ticket
      </button>
      <button class="btn-ticket btn-ticket-auto" onclick="imprimirTicket(ultimaVenta.venta, ultimaVenta.efectivo, ultimaVenta.vuelto, ultimaVenta.items, true)">
        ⚡ Imprimir Directo
      </button>
    </div>`;
  document.getElementById("modal-comprobante").classList.add("open");
}

function cerrarModalComprobante(e) {
  if (e && e.target !== document.getElementById("modal-comprobante")) return;
  document.getElementById("modal-comprobante").classList.remove("open");
  document.getElementById("barcode-input").focus();
}
document.addEventListener("keydown", e => {
  const m = document.getElementById("modal-comprobante");
  if (e.key === "Enter" && m && m.classList.contains("open")) cerrarModalComprobante();
});

// ═══ HISTORIAL DE VENTAS ══════════════════════════════════════════════════════

async function cargarVentas(pagina = 1) {
  state.ventasPagina = pagina;
  document.getElementById("ventas-body").innerHTML = `<tr><td colspan="9" class="loading-row">Cargando ventas...</td></tr>`;
  const desde = document.getElementById("filtro-desde").value;
  const hasta = document.getElementById("filtro-hasta").value;
  let url = `${API}/ventas?pagina=${pagina}&limite=20`;
  if (desde) url += `&desde=${desde}`;
  if (hasta) url += `&hasta=${hasta}`;
  try {
    const res  = await apiFetch(url);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    renderizarVentas(data.data, data.paginacion, data.resumen);
  } catch (err) {
    if (err.message !== "Sesión expirada")
      document.getElementById("ventas-body").innerHTML = `<tr><td colspan="9" class="loading-row" style="color:var(--danger)">Error al cargar ventas.</td></tr>`;
  }
}

function limpiarFiltrosVentas() {
  document.getElementById("filtro-desde").value = "";
  document.getElementById("filtro-hasta").value = "";
  cargarVentas(1);
}

function renderizarVentas(ventas, paginacion, resumen) {
  const cant  = resumen ? resumen.cantidad_ventas : 0;
  const monto = resumen ? resumen.monto_total || 0 : 0;
  document.getElementById("resumen-cantidad").textContent = cant;
  document.getElementById("resumen-monto").textContent    = formatPeso(monto);
  document.getElementById("resumen-promedio").textContent = formatPeso(cant > 0 ? monto / cant : 0);

  const tbody = document.getElementById("ventas-body");
  if (!ventas.length) { tbody.innerHTML = `<tr><td colspan="9" class="loading-row">No hay ventas en el período.</td></tr>`; document.getElementById("paginacion").innerHTML = ""; return; }
  tbody.innerHTML = ventas.map(v => `
    <tr>
      <td class="td-id">#${v.id}</td>
      <td class="td-fecha">${v.creado_en || "—"}</td>
      <td class="td-nombre">${escapeHtml(v.cajero_nombre || "—")}</td>
      <td class="td-monto">${formatPeso(v.total)}</td>
      <td class="td-precio">${formatPeso(v.efectivo)}</td>
      <td class="td-vuelto">${formatPeso(v.vuelto)}</td>
      <td class="td-cae" title="${v.cae||''}">${v.cae ? v.cae.slice(0,6)+"..." : "—"}</td>
      <td>
        <span class="estado-venta ${v.estado==="completada"?"estado-completada":"estado-procesando"}">${v.estado}</span>
        <span class="badge-facturada ${v.facturada?"badge-con-factura":"badge-sin-factura"}">${v.facturada?"facturada":"sin factura"}</span>
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-ver-detalle" onclick="verDetalleVenta(${v.id})">Detalle</button>
          <button class="btn-ver-detalle" onclick="reimprimirTicket(${v.id})" title="Reimprimir ticket">🖨</button>
        </div>
      </td>
    </tr>`).join("");
  renderizarPaginacion(paginacion);
}

function renderizarPaginacion(p) {
  const c = document.getElementById("paginacion");
  if (!p || p.paginas <= 1) { c.innerHTML = ""; return; }
  let html = `<button class="pag-btn" onclick="cargarVentas(${p.pagina-1})" ${p.pagina<=1?"disabled":""}>← Anterior</button>`;
  const ini = Math.max(1, p.pagina-2), fin = Math.min(p.paginas, p.pagina+2);
  if (ini > 1) html += `<button class="pag-btn" onclick="cargarVentas(1)">1</button><span class="pag-info">...</span>`;
  for (let i = ini; i <= fin; i++) html += `<button class="pag-btn ${i===p.pagina?"active":""}" onclick="cargarVentas(${i})">${i}</button>`;
  if (fin < p.paginas) html += `<span class="pag-info">...</span><button class="pag-btn" onclick="cargarVentas(${p.paginas})">${p.paginas}</button>`;
  html += `<button class="pag-btn" onclick="cargarVentas(${p.pagina+1})" ${p.pagina>=p.paginas?"disabled":""}>Siguiente →</button>`;
  html += `<span class="pag-info">${p.total} ventas en total</span>`;
  c.innerHTML = html;
}

async function verDetalleVenta(id) {
  const modal = document.getElementById("modal-detalle-venta");
  const body  = document.getElementById("detalle-venta-body");
  document.getElementById("detalle-venta-title").textContent = `Venta #${id}`;
  body.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:24px">Cargando...</p>`;
  modal.classList.add("open");
  try {
    const res  = await apiFetch(`${API}/ventas/${id}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    const v = data.data;
    body.innerHTML = `
      <div class="detalle-meta">
        <div class="detalle-meta-item"><span class="detalle-meta-label">Fecha y hora</span><span class="detalle-meta-valor">${v.creado_en||"—"}</span></div>
        <div class="detalle-meta-item"><span class="detalle-meta-label">Cajero</span><span class="detalle-meta-valor">${escapeHtml(v.cajero_nombre||"—")}</span></div>
        <div class="detalle-meta-item"><span class="detalle-meta-label">CAE</span><span class="detalle-meta-valor">${v.cae||"—"}</span></div>
        <div class="detalle-meta-item"><span class="detalle-meta-label">Vto. CAE</span><span class="detalle-meta-valor">${formatFechaCAE(v.cae_vto)||"—"}</span></div>
        <div class="detalle-meta-item"><span class="detalle-meta-label">Efectivo</span><span class="detalle-meta-valor">${formatPeso(v.efectivo)}</span></div>
        <div class="detalle-meta-item"><span class="detalle-meta-label">Vuelto</span><span class="detalle-meta-valor">${formatPeso(v.vuelto)}</span></div>
      </div>
      <div class="detalle-items-title">Productos vendidos</div>
      <table class="detalle-items-table">
        <thead><tr><th>Código</th><th>Producto</th><th style="text-align:center">Cant.</th><th>Precio Unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${(v.items||[]).map(item=>`
          <tr>
            <td class="td-codigo">${escapeHtml(item.codigo_barras||"")}</td>
            <td class="td-nombre">${escapeHtml(item.producto_nombre||item.nombre||"")}</td>
            <td style="font-family:var(--font-mono);text-align:center">${item.cantidad}</td>
            <td class="td-precio">${formatPeso(item.precio_unit)}</td>
            <td class="td-subtotal">${formatPeso(item.subtotal)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <div class="detalle-total-row"><span>TOTAL</span><span>${formatPeso(v.total)}</span></div>
      <div style="margin-top:14px">
        <button class="btn-ticket" style="width:100%" onclick="reimprimirTicket(${v.id})">🖨 Reimprimir Ticket</button>
      </div>`;
  } catch (err) {
    if (err.message !== "Sesión expirada")
      body.innerHTML = `<p style="text-align:center;color:var(--danger);padding:24px">Error al cargar el detalle.</p>`;
  }
}

/**
 * Reimprime el ticket de una venta ya guardada en la BD.
 * Trae el detalle completo desde el backend.
 */
async function reimprimirTicket(ventaId) {
  try {
    const res  = await apiFetch(`${API}/ventas/${ventaId}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    const v = data.data;

    const ventaFake = {
      venta_id:        v.id,
      punto_venta:     1,
      nro_comprobante: ventaId,
      total:           v.total,
      cae:             v.cae     || "",
      cae_vto:         v.cae_vto || "",
    };
    const itemsFake = (v.items || []).map(i => ({
      nombre:      i.producto_nombre || i.nombre || "",
      cantidad:    i.cantidad,
      precio_unit: i.precio_unit,
      subtotal:    i.subtotal,
    }));

    // Para reimprimir usamos la fecha original de la venta
    const p = new URLSearchParams();
    p.set("negocio",     CONFIG_NEGOCIO.nombre);
    p.set("direccion",   CONFIG_NEGOCIO.direccion);
    p.set("cuit",        CONFIG_NEGOCIO.cuit);
    p.set("footer_extra",CONFIG_NEGOCIO.footer_extra);
    p.set("venta_id",    v.id);
    p.set("pto_venta",   "0001");
    p.set("comprobante", String(v.id).padStart(8, "0"));
    p.set("fecha",       v.creado_en || new Date().toLocaleString("es-AR"));
    p.set("cajero",      v.cajero_nombre || "—");
    p.set("total",       v.total);
    p.set("efectivo",    v.efectivo);
    p.set("vuelto",      v.vuelto);
    p.set("cae",         v.cae || "");
    p.set("cae_vto",     v.cae_vto || "");
    p.set("items",       encodeURIComponent(JSON.stringify(itemsFake)));

    window.open(`/ticket.html?${p.toString()}`, "_blank", "width=420,height=700,menubar=no,toolbar=no,location=no");

  } catch (err) {
    if (err.message !== "Sesión expirada") mostrarToast("Error al cargar ticket.", "error");
  }
}

function cerrarModalDetalleVenta(e) {
  if (e && e.target !== document.getElementById("modal-detalle-venta")) return;
  document.getElementById("modal-detalle-venta").classList.remove("open");
}

// ═══ CIERRE DE CAJA ═══════════════════════════════════════════════════════════

async function cargarCaja() {
  const fecha = document.getElementById("caja-fecha").value || new Date().toISOString().split("T")[0];
  ["kpi-total","kpi-cantidad","kpi-efectivo","kpi-vuelto"].forEach(id => document.getElementById(id).textContent = "...");
  try {
    const res  = await apiFetch(`${API}/caja/resumen?fecha=${fecha}`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    const { totales, porCajero, topProductos, porHora, cierreExistente } = data.data;
    const esAdmin = data.esAdmin;

    // Mostrar u ocultar secciones según rol
    const panelCajeros   = document.getElementById("panel-cajeros");
    const historialEl    = document.querySelector(".historial-cierres");
    const backupPanelEl  = document.querySelector(".backup-panel");
    if (panelCajeros)  panelCajeros.style.display  = esAdmin ? "" : "none";
    if (historialEl)   historialEl.style.display    = esAdmin ? "" : "none";
    if (backupPanelEl) backupPanelEl.style.display  = esAdmin ? "" : "none";

    // Título del panel KPI según rol
    const kpiTotalLabel = document.querySelector(".kpi-card.kpi-primary .kpi-label");
    if (kpiTotalLabel) kpiTotalLabel.textContent = esAdmin ? "Monto Total Vendido" : "Mis Ventas del Día";

    const cant  = totales.cantidad_ventas || 0;
    const monto = totales.monto_total     || 0;
    document.getElementById("kpi-total").textContent      = formatPeso(monto);
    document.getElementById("kpi-total-sub").textContent  = `${cant} transacciones`;
    document.getElementById("kpi-cantidad").textContent   = cant;
    document.getElementById("kpi-ticket-prom").textContent= `Ticket promedio: ${formatPeso(cant > 0 ? monto / cant : 0)}`;
    document.getElementById("kpi-efectivo").textContent   = formatPeso(totales.total_efectivo || 0);
    document.getElementById("kpi-vuelto").textContent     = formatPeso(totales.total_vuelto   || 0);

    const cajEl = document.getElementById("cajeros-content");
    if (!porCajero.length) { cajEl.innerHTML = `<p class="empty-state">Sin ventas en esta fecha.</p>`; }
    else {
      const maxMonto = Math.max(...porCajero.map(c => c.monto));
      cajEl.innerHTML = porCajero.map(c => `
        <div class="cajero-row">
          <span class="cajero-nombre">${escapeHtml(c.cajero)}</span>
          <span class="cajero-cantidad">${c.cantidad} ventas</span>
          <div class="cajero-bar-wrap"><div class="cajero-bar" style="width:${maxMonto>0?(c.monto/maxMonto*100):0}%"></div></div>
          <span class="cajero-monto">${formatPeso(c.monto)}</span>
        </div>`).join("");
    }

    const topEl = document.getElementById("top-productos-content");
    if (!topProductos.length) { topEl.innerHTML = `<p class="empty-state">Sin ventas en esta fecha.</p>`; }
    else {
      topEl.innerHTML = topProductos.map((p, i) => `
        <div class="producto-row">
          <span class="producto-pos">${i+1}</span>
          <span class="producto-nombre" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</span>
          <span class="producto-unidades">${p.unidades} u.</span>
          <span class="producto-total">${formatPeso(p.total_vendido)}</span>
        </div>`).join("");
    }

    renderizarGraficoHoras(porHora);

    document.getElementById("cierre-info-sub").textContent =
      `Fecha: ${fecha} | Estado: ${cierreExistente ? "✅ cerrada" : "⏳ pendiente"}`;

    const accionEl = document.getElementById("cierre-accion");
    if (cierreExistente) {
      accionEl.innerHTML = `<div class="cierre-ya-realizado">✅ Caja cerrada a las ${cierreExistente.creado_en ? cierreExistente.creado_en.split(" ")[1] : "—"}</div>`;
      document.getElementById("cierre-notas").value    = cierreExistente.notas || "";
      document.getElementById("cierre-notas").disabled = true;
    } else {
      accionEl.innerHTML = `<button class="btn-cerrar-caja" onclick="cerrarCaja()" id="btn-cerrar-caja">🔒 Registrar Cierre</button>`;
      document.getElementById("cierre-notas").disabled = false;
    }

    cargarHistorialCierres();
  } catch (err) {
    if (err.message !== "Sesión expirada") mostrarToast("Error al cargar datos de caja.", "error");
  }
}

function renderizarGraficoHoras(porHora) {
  const container = document.getElementById("grafico-horas-content");
  const mapaHoras = {};
  porHora.forEach(h => { mapaHoras[h.hora] = h; });
  const maxMonto = porHora.length > 0 ? Math.max(...porHora.map(h => h.monto)) : 0;
  if (maxMonto === 0) { container.innerHTML = `<p class="empty-state" style="width:100%">Sin actividad registrada.</p>`; return; }
  let html = "";
  for (let h = 6; h <= 23; h++) {
    const datos = mapaHoras[h], monto = datos ? datos.monto : 0, cantidad = datos ? datos.cantidad : 0;
    const pct = maxMonto > 0 ? Math.round((monto / maxMonto) * 100) : 0;
    html += `<div class="barra-hora">
      <div class="barra-fill ${cantidad>0?"barra-activa":""}" style="height:${Math.max(pct,0)}%">
        ${cantidad>0?`<div class="barra-tooltip">${formatPeso(monto)}<br>${cantidad} venta${cantidad!==1?"s":""}</div>`:""}
      </div>
      <span class="barra-label">${String(h).padStart(2,"0")}</span>
    </div>`;
  }
  container.innerHTML = html;
}

async function cerrarCaja() {
  const fecha = document.getElementById("caja-fecha").value || new Date().toISOString().split("T")[0];
  const notas = document.getElementById("cierre-notas").value.trim();
  const btn   = document.getElementById("btn-cerrar-caja");
  const hoy   = new Date().toISOString().split("T")[0];
  if (fecha !== hoy && !confirm(`¿Registrar cierre para ${fecha} (no es hoy)?`)) return;
  else if (fecha === hoy && !confirm(`¿Confirmar el cierre de caja del día de hoy (${fecha})?`)) return;
  btn.disabled = true; btn.textContent = "Registrando...";
  try {
    const res  = await apiFetch(`${API}/caja/cerrar?fecha=${fecha}`, { method: "POST", body: JSON.stringify({ notas }) });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    mostrarToast(`Cierre registrado. Total: ${formatPeso(data.data.monto_total)}`, "success");
    cargarCaja();
  } catch (err) {
    if (err.message !== "Sesión expirada") mostrarToast(`Error: ${err.message}`, "error");
    btn.disabled = false; btn.textContent = "🔒 Registrar Cierre";
  }
}

async function cargarHistorialCierres() {
  const tbody = document.getElementById("historial-cierres-body");
  try {
    const res  = await apiFetch(`${API}/caja/historial?limite=15`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);
    if (!data.data.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No hay cierres registrados aún.</td></tr>`; return; }
    tbody.innerHTML = data.data.map(c => `
      <tr>
        <td class="historial-fecha">${c.fecha}</td>
        <td style="font-family:var(--font-mono);text-align:center">${c.cantidad_ventas}</td>
        <td class="historial-monto">${formatPeso(c.monto_total)}</td>
        <td style="font-family:var(--font-mono)">${formatPeso(c.total_efectivo)}</td>
        <td style="font-family:var(--font-mono);color:var(--text-muted)">${formatPeso(c.total_vuelto)}</td>
        <td>${escapeHtml(c.admin_nombre||"—")}</td>
        <td class="td-fecha">${c.creado_en?c.creado_en.split(" ")[1]||c.creado_en:"—"}</td>
        <td style="color:var(--text-muted);font-size:0.8rem">${escapeHtml(c.notas||"—")}</td>
      </tr>`).join("");
  } catch (err) {
    if (err.message !== "Sesión expirada")
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:var(--danger)">Error al cargar historial.</td></tr>`;
  }
}

// ═══ INVENTARIO ═══════════════════════════════════════════════════════════════

let todosLosProductos = [];

async function cargarInventario() {
  const tbody = document.getElementById("inv-body");
  tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Cargando...</td></tr>`;
  try {
    const res = await apiFetch(`${API}/productos`); const data = await res.json();
    todosLosProductos = data.data || []; renderizarInventario(todosLosProductos);
  } catch (err) { if (err.message !== "Sesión expirada") tbody.innerHTML = `<tr><td colspan="7" class="loading-row" style="color:var(--danger)">Error.</td></tr>`; }
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
    const esAdmin = state.usuario.rol === "admin";
    return `<tr>
      <td class="td-id">${p.id}</td><td class="td-codigo">${escapeHtml(p.codigo_barras)}</td>
      <td class="td-nombre">${escapeHtml(p.nombre)}</td><td class="td-precio">${formatPeso(p.precio)}</td>
      <td class="td-stock ${sc}">${p.stock}</td>
      <td class="td-fecha">${p.actualizado_en?p.actualizado_en.split(" ")[0]:"—"}</td>
      <td>${esAdmin ? `<div class="action-btns">
        <button class="btn-edit" onclick="abrirModalProducto(${p.id})">Editar</button>
        <button class="btn-delete" onclick="eliminarProducto(${p.id},'${escapeHtml(p.nombre)}')">✕</button>
      </div>` : `<span class="readonly-badge">Solo lectura</span>`}</td></tr>`;
  }).join("");
}

function abrirModalProducto(id = null) {
  document.getElementById("modal-producto-title").textContent = id ? "Editar Producto" : "Nuevo Producto";
  document.getElementById("prod-btn-text").textContent = id ? "Guardar Cambios" : "Guardar Producto";
  document.getElementById("prod-error").classList.add("hidden");
  ["prod-id","prod-codigo","prod-nombre","prod-precio","prod-stock"].forEach(i => document.getElementById(i).value = "");
  if (id) { const p = todosLosProductos.find(p => p.id === id); if (!p) return;
    document.getElementById("prod-id").value = p.id; document.getElementById("prod-codigo").value = p.codigo_barras;
    document.getElementById("prod-nombre").value = p.nombre; document.getElementById("prod-precio").value = p.precio;
    document.getElementById("prod-stock").value = p.stock; }
  document.getElementById("modal-producto").classList.add("open");
  setTimeout(() => document.getElementById("prod-codigo").focus(), 100);
}

function cerrarModalProducto(e) { if (e && e.target !== document.getElementById("modal-producto")) return; document.getElementById("modal-producto").classList.remove("open"); }

async function guardarProducto() {
  const id = document.getElementById("prod-id").value;
  const codigo_barras = document.getElementById("prod-codigo").value.trim();
  const nombre = document.getElementById("prod-nombre").value.trim();
  const precio = parseFloat(document.getElementById("prod-precio").value);
  const stock  = parseInt(document.getElementById("prod-stock").value) || 0;
  const errorEl = document.getElementById("prod-error");
  if (!codigo_barras || !nombre || isNaN(precio)) { errorEl.textContent = "Completá los campos obligatorios."; errorEl.classList.remove("hidden"); return; }
  try {
    const res = await apiFetch(id ? `${API}/productos/${id}` : `${API}/productos`, { method: id?"PUT":"POST", body: JSON.stringify({codigo_barras,nombre,precio,stock}) });
    const data = await res.json();
    if (!res.ok||!data.success) { errorEl.textContent=data.mensaje||"Error."; errorEl.classList.remove("hidden"); return; }
    cerrarModalProducto(); mostrarToast(id?"Producto actualizado.":"Producto creado.","success"); cargarInventario();
  } catch (err) { if (err.message!=="Sesión expirada") { errorEl.textContent="Error de conexión."; errorEl.classList.remove("hidden"); } }
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  try {
    const res = await apiFetch(`${API}/productos/${id}`,{method:"DELETE"}); const data=await res.json();
    if (!res.ok||!data.success) throw new Error(data.mensaje);
    mostrarToast(`"${nombre}" eliminado.`,"success"); cargarInventario();
  } catch (err) { if (err.message!=="Sesión expirada") mostrarToast(`Error: ${err.message}`,"error"); }
}

// ═══ USUARIOS ═════════════════════════════════════════════════════════════════

let todosLosUsuarios = [];

async function cargarUsuarios() {
  const tbody = document.getElementById("usr-body"); if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="loading-row">Cargando...</td></tr>`;
  try { const res=await apiFetch(`${API}/auth/usuarios`); const data=await res.json(); todosLosUsuarios=data.data||[]; renderizarUsuarios(todosLosUsuarios); }
  catch (err) { if (err.message!=="Sesión expirada") tbody.innerHTML=`<tr><td colspan="7" class="loading-row" style="color:var(--danger)">Error.</td></tr>`; }
}

function renderizarUsuarios(usuarios) {
  const tbody = document.getElementById("usr-body"); if (!tbody) return;
  if (!usuarios.length) { tbody.innerHTML=`<tr><td colspan="7" class="loading-row">No hay usuarios.</td></tr>`; return; }
  tbody.innerHTML = usuarios.map(u=>`<tr>
    <td class="td-id">${u.id}</td><td class="td-nombre">${escapeHtml(u.nombre)}</td>
    <td class="td-codigo">${escapeHtml(u.usuario)}</td>
    <td><span class="rol-badge rol-${u.rol}">${u.rol.toUpperCase()}</span></td>
    <td><span class="estado-badge ${u.activo?"activo":"inactivo"}">${u.activo?"Activo":"Inactivo"}</span></td>
    <td class="td-fecha">${u.ultimo_acceso?u.ultimo_acceso.split(" ")[0]:"—"}</td>
    <td><div class="action-btns">
      <button class="btn-edit" onclick="abrirModalUsuario(${u.id})">Editar</button>
      ${u.id!==state.usuario.id?`<button class="btn-delete" onclick="eliminarUsuario(${u.id},'${escapeHtml(u.nombre)}')">✕</button>`:`<span style="color:var(--text-muted);font-size:0.75rem;padding:0 8px">Tú</span>`}
    </div></td></tr>`).join("");
}

function abrirModalUsuario(id=null) {
  document.getElementById("modal-usuario-title").textContent=id?"Editar Usuario":"Nuevo Usuario";
  document.getElementById("usr-btn-text").textContent=id?"Guardar Cambios":"Crear Usuario";
  document.getElementById("usr-error").classList.add("hidden");
  ["usr-id","usr-nombre","usr-usuario","usr-password"].forEach(i=>document.getElementById(i).value="");
  document.getElementById("usr-rol").value="cajero"; document.getElementById("usr-activo").checked=true;
  document.getElementById("usr-password-label").textContent=id?"Nueva contraseña (vacío = no cambiar)":"Contraseña *";
  if (id) { const u=todosLosUsuarios.find(u=>u.id===id); if (!u) return;
    document.getElementById("usr-id").value=u.id; document.getElementById("usr-nombre").value=u.nombre;
    document.getElementById("usr-usuario").value=u.usuario; document.getElementById("usr-rol").value=u.rol;
    document.getElementById("usr-activo").checked=u.activo===1; }
  document.getElementById("modal-usuario").classList.add("open");
  setTimeout(()=>document.getElementById("usr-nombre").focus(),100);
}

function cerrarModalUsuario(e) { if (e&&e.target!==document.getElementById("modal-usuario")) return; document.getElementById("modal-usuario").classList.remove("open"); }

async function guardarUsuario() {
  const id=document.getElementById("usr-id").value, nombre=document.getElementById("usr-nombre").value.trim();
  const usuario=document.getElementById("usr-usuario").value.trim(), password=document.getElementById("usr-password").value;
  const rol=document.getElementById("usr-rol").value, activo=document.getElementById("usr-activo").checked;
  const errorEl=document.getElementById("usr-error");
  if (!nombre||!usuario) { errorEl.textContent="Nombre y usuario son requeridos."; errorEl.classList.remove("hidden"); return; }
  if (!id&&!password) { errorEl.textContent="La contraseña es requerida."; errorEl.classList.remove("hidden"); return; }
  const payload={nombre,usuario,rol,activo}; if (password) payload.password=password;
  try {
    const res=await apiFetch(id?`${API}/auth/usuarios/${id}`:`${API}/auth/usuarios`,{method:id?"PUT":"POST",body:JSON.stringify(payload)});
    const data=await res.json();
    if (!res.ok||!data.success) { errorEl.textContent=data.mensaje||"Error."; errorEl.classList.remove("hidden"); return; }
    cerrarModalUsuario(); mostrarToast(id?"Usuario actualizado.":"Usuario creado.","success"); cargarUsuarios();
  } catch (err) { if (err.message!=="Sesión expirada") { errorEl.textContent="Error de conexión."; errorEl.classList.remove("hidden"); } }
}

async function eliminarUsuario(id,nombre) {
  if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return;
  try {
    const res=await apiFetch(`${API}/auth/usuarios/${id}`,{method:"DELETE"}); const data=await res.json();
    if (!res.ok||!data.success) throw new Error(data.mensaje);
    mostrarToast(`Usuario "${nombre}" eliminado.`,"success"); cargarUsuarios();
  } catch (err) { if (err.message!=="Sesión expirada") mostrarToast(`Error: ${err.message}`,"error"); }
}


// ═══ BACKUP ═══════════════════════════════════════════════════════════════════

async function cargarBackups() {
  const tbody = document.getElementById("backup-lista-body");
  if (!tbody) return;
  try {
    const res  = await apiFetch(`${API}/backup`);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);

    // Mostrar el último backup en el panel superior
    const subEl = document.getElementById("backup-ultimo");
    if (data.data.length > 0) {
      const ultimo = data.data[0];
      subEl.textContent = `Último backup: ${ultimo.archivo} — ${ultimo.fecha} (${ultimo.tamano_kb} KB)`;
      subEl.classList.add("backup-reciente");
    } else {
      subEl.textContent = "No hay backups registrados todavía.";
    }

    // Tabla de historial
    if (!data.data.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No hay backups todavía. Se crean automáticamente cada día.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.data.map((b, i) => `
      <tr>
        <td class="backup-nombre">${b.nombre}</td>
        <td class="backup-tamano">${b.tamano_kb} KB</td>
        <td class="backup-fecha ${i === 0 ? "backup-reciente" : ""}">${b.fecha}</td>
      </tr>`).join("");
  } catch (err) {
    if (err.message !== "Sesión expirada") {
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="empty-state" style="color:var(--danger)">Error al cargar backups.</td></tr>`;
    }
  }
}

async function hacerBackupManual() {
  const btn     = document.getElementById("btn-backup-manual");
  const subEl   = document.getElementById("backup-ultimo");
  btn.disabled  = true;
  btn.textContent = "⏳ Generando...";

  try {
    const res  = await apiFetch(`${API}/backup`, { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.mensaje);

    btn.textContent = "✅ Backup listo";
    btn.classList.add("backup-ok");
    mostrarToast(`Backup generado: ${data.data.archivo} (${data.data.tamano_kb} KB)`, "success");

    // Recargar lista
    await cargarBackups();

    setTimeout(() => {
      btn.disabled    = false;
      btn.textContent = "💾 Hacer Backup Ahora";
      btn.classList.remove("backup-ok");
    }, 3000);

  } catch (err) {
    if (err.message !== "Sesión expirada") mostrarToast(`Error: ${err.message}`, "error");
    btn.disabled    = false;
    btn.textContent = "💾 Hacer Backup Ahora";
  }
}

// ═══ UTILIDADES ═══════════════════════════════════════════════════════════════

function formatPeso(v) { return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:2}).format(v||0); }
function formatFechaCAE(s) { if (!s||s.length!==8) return s||"—"; return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`; }
function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function mostrarToast(mensaje, tipo="success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.innerHTML = `<span>${{success:"✓",error:"✕",warning:"⚠"}[tipo]||"•"}</span> ${escapeHtml(mensaje)}`;
  container.appendChild(toast);
  setTimeout(()=>{ toast.style.animation="toastOut 0.25s ease forwards"; setTimeout(()=>toast.remove(),250); },3500);
}
