// services/facturacionService.js — KOSKIO APP
// ─────────────────────────────────────────────────────────────────────────────
// Soporta dos modos:
//   modo MOCK    → respuesta simulada, sin certificados (desarrollo / ventas sin factura)
//   modo REAL    → conexión real con WSAA + WSFE de AFIP (requiere certificados)
//
// Para activar el modo REAL:
//   1. Copiá tu private.key y certificate.crt en backend/certs/
//   2. Cambiá MODO_FACTURACION a "REAL" acá abajo
//   3. Completá AFIP_CONFIG con tu CUIT y punto de venta
// ─────────────────────────────────────────────────────────────────────────────

const fs   = require("fs");
const path = require("path");

// ══ CONFIGURACIÓN ════════════════════════════════════════════════════════════
const MODO_FACTURACION = "MOCK"; // "MOCK" | "REAL"

const AFIP_CONFIG = {
  cuit:          "20000000000",   // ← Tu CUIT sin guiones
  punto_venta:   1,               // ← Tu punto de venta en AFIP
  tipo_cbte:     11,              // 11 = Factura C (Monotributista)
  cert_path:     path.join(__dirname, "..", "certs", "certificate.crt"),
  key_path:      path.join(__dirname, "..", "certs", "private.key"),
  // Homologación (testing AFIP) vs Producción
  homologacion:  true,            // ← Cambiar a false cuando estés en producción real
};
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Genera un CAE para una venta.
 * Devuelve null si se eligió no facturar (generar_factura = false).
 *
 * @param {object} datosVenta
 * @param {number}  datosVenta.total
 * @param {number}  datosVenta.venta_id
 * @param {boolean} datosVenta.generar_factura
 * @param {Array}   datosVenta.items
 */
async function generarCAE(datosVenta) {
  // Si el cajero eligió no facturar, retornar null directamente
  if (!datosVenta.generar_factura) {
    console.log(`📄 Venta #${datosVenta.venta_id} registrada SIN factura electrónica.`);
    return null;
  }

  if (MODO_FACTURACION === "REAL") {
    return await _generarCAEReal(datosVenta);
  } else {
    return await _generarCAEMock(datosVenta);
  }
}

// ─── MODO MOCK ────────────────────────────────────────────────────────────────
async function _generarCAEMock(datosVenta) {
  console.log(`\n🔐 [AFIP MOCK] Facturando venta #${datosVenta.venta_id}...`);
  console.log("   → Obteniendo Ticket de Acceso (WSAA)...");
  await _delay(500);
  console.log("   ✓ Ticket obtenido.");
  console.log("   → Enviando a WSFE (FECAESolicitar)...");
  await _delay(1500);

  const cae           = _generarCodigoCAE();
  const cae_fch_vto   = _calcularVencimientoCAE();
  const nro_comprobante = Math.floor(Math.random() * 900000) + 100000;

  console.log(`   ✓ CAE: ${cae} (Vto: ${cae_fch_vto})\n`);

  return {
    success:        true,
    cae,
    cae_fch_vto,
    nro_comprobante,
    tipo_comprobante: AFIP_CONFIG.tipo_cbte,
    punto_venta:      AFIP_CONFIG.punto_venta,
    _mock:            true,
  };
}

// ─── MODO REAL ────────────────────────────────────────────────────────────────
// Cuando tengas los certificados, este bloque se activa automáticamente.
// Requiere instalar: npm install soap --ignore-scripts
async function _generarCAEReal(datosVenta) {
  try {
    // Verificar que existan los certificados
    if (!fs.existsSync(AFIP_CONFIG.cert_path) || !fs.existsSync(AFIP_CONFIG.key_path)) {
      throw new Error(
        "Certificados AFIP no encontrados. " +
        "Copiá certificate.crt y private.key en la carpeta backend/certs/"
      );
    }

    const soap = require("soap");

    // URLs de AFIP (homologación vs producción)
    const WSAA_WSDL = AFIP_CONFIG.homologacion
      ? "https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL"
      : "https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL";

    const WSFE_WSDL = AFIP_CONFIG.homologacion
      ? "https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL"
      : "https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL";

    // ── Paso 1: WSAA — Obtener Ticket de Acceso ───────────────────────────────
    console.log("\n🔐 [AFIP REAL] Autenticando con WSAA...");
    const cert    = fs.readFileSync(AFIP_CONFIG.cert_path, "utf8");
    const key     = fs.readFileSync(AFIP_CONFIG.key_path,  "utf8");
    const { sign } = require("crypto");

    // Armar el TRA (Ticket de Requerimiento de Acceso)
    const ahora      = new Date();
    const expira     = new Date(ahora.getTime() + 12 * 3600 * 1000);
    const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${ahora.toISOString().slice(0,19)}-03:00</generationTime>
    <expirationTime>${expira.toISOString().slice(0,19)}-03:00</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`;

    // Firmar el TRA con la clave privada (PKCS#7)
    // Nota: en producción real usar librería forge o node-forge para CMS signing
    // Por ahora dejamos el placeholder documentado
    // const cmsFirmado = await _firmarTRA(tra, cert, key);

    // TODO: completar firma CMS cuando se integren los certificados reales
    // const wsaaClient = await soap.createClientAsync(WSAA_WSDL);
    // const [loginResult] = await wsaaClient.loginCmsAsync({ in0: cmsFirmado });
    // const { token, sign: signWsaa } = _parsearTicketAcceso(loginResult.loginCmsReturn);

    // ── Paso 2: WSFE — Solicitar CAE ─────────────────────────────────────────
    console.log("   → Solicitando CAE a WSFE...");

    // TODO: completar cuando estén los certificados
    // const wsfeClient = await soap.createClientAsync(WSFE_WSDL);
    // const ultimoCbte = await _obtenerUltimoComprobante(wsfeClient, token, signWsaa);
    // const resultado  = await _solicitarCAE(wsfeClient, token, signWsaa, datosVenta, ultimoCbte + 1);

    throw new Error(
      "Integración AFIP real pendiente de certificados. " +
      "Cambiá MODO_FACTURACION a 'MOCK' para continuar en modo simulado."
    );

  } catch (err) {
    console.error("❌ Error AFIP real:", err.message);
    throw err;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _generarCodigoCAE() {
  return `${Date.now().toString().slice(-8)}${Math.floor(Math.random()*1000000).toString().padStart(6,"0")}`;
}
function _calcularVencimientoCAE() {
  const d = new Date(); d.setDate(d.getDate() + 10);
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generarCAE, AFIP_CONFIG, MODO_FACTURACION };
