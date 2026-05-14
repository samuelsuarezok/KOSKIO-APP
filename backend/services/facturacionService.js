// services/facturacionService.js
// Servicio Mock de facturación electrónica ARCA/AFIP
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANTE: Este módulo simula la conexión con los Web Services de AFIP
// (wsfe, wsaa) mediante un mock. Para integrar con AFIP real, deberás:
//
//  1. Obtener un certificado digital emitido por AFIP para tu CUIT.
//  2. Reemplazar la función `obtenerTicketAcceso()` con la lógica real de WSAA
//     (autenticación) usando el paquete `afip.js` o `node-afip`.
//  3. Reemplazar `generarCAE()` con la llamada real a WSFE (Factura Electrónica).
//
// Por ahora, el mock respeta los mismos tiempos de respuesta y estructura
// de datos que devuelve AFIP en producción para facilitar la migración.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simula la obtención de un Ticket de Acceso (TA) del Web Service de Autenticación (WSAA).
 * En producción: deberás firmar el TRA con tu clave privada y enviarlo a AFIP.
 * @returns {Promise<object>} Ticket de acceso simulado
 */
async function obtenerTicketAcceso() {
  // Simular latencia de red con los servidores de AFIP (siempre son lentos)
  await _delay(500);

  const ahora = new Date();
  const vencimiento = new Date(ahora.getTime() + 12 * 60 * 60 * 1000); // +12 horas

  return {
    token: `MOCK_TOKEN_${Date.now()}`,
    sign: `MOCK_SIGN_${Math.random().toString(36).substr(2, 20).toUpperCase()}`,
    expiracion: vencimiento.toISOString(),
  };
}

/**
 * Simula la generación de CAE (Código de Autorización Electrónico) mediante WSFE.
 * En producción: usa el token/sign del TA para llamar a FECAESolicitar().
 *
 * @param {object} datosVenta - Datos de la venta para facturar
 * @param {number} datosVenta.total - Importe total de la venta
 * @param {number} datosVenta.venta_id - ID interno de la venta
 * @param {Array}  datosVenta.items - Detalle de productos vendidos
 * @returns {Promise<object>} Respuesta simulada de AFIP con CAE y vencimiento
 */
async function generarCAE(datosVenta) {
  console.log(`\n🔐 [AFIP MOCK] Iniciando proceso de facturación para venta #${datosVenta.venta_id}...`);

  // Paso 1: Obtener ticket de acceso (WSAA)
  console.log("   → Obteniendo Ticket de Acceso (WSAA)...");
  const ticketAcceso = await obtenerTicketAcceso();
  console.log("   ✓ Ticket de Acceso obtenido.");

  // Paso 2: Simular el tiempo de procesamiento del WSFE
  console.log("   → Enviando solicitud a WSFE (FECAESolicitar)...");
  await _delay(1500); // AFIP suele tardar entre 1-3 segundos

  // Paso 3: Generar datos simulados de respuesta
  const cae = _generarCodigoCAE();
  const fechaVto = _calcularVencimientoCAE();
  const nroComprobante = Math.floor(Math.random() * 900000) + 100000;

  const respuesta = {
    success: true,
    // Datos que devuelve AFIP en una respuesta real de FECAESolicitar
    resultado: "A",             // A = Aprobado
    cae: cae,
    cae_fch_vto: fechaVto,
    nro_comprobante: nroComprobante,
    tipo_comprobante: 11,       // 11 = Factura C (para consumidor final)
    punto_venta: 1,
    concepto: 1,                // 1 = Productos
    // Datos del vendedor (en producción vendrían de tu config)
    cuit_emisor: "20-12345678-9",
    // Datos de esta solicitud
    importe_total: datosVenta.total,
    importe_neto: (datosVenta.total / 1.21).toFixed(2), // Sin IVA 21%
    importe_iva: (datosVenta.total - datosVenta.total / 1.21).toFixed(2),
    // Metadata del mock
    _mock: true,
    _mensaje: "Respuesta simulada. Integrar certificados AFIP reales para producción.",
  };

  console.log(`   ✓ CAE generado: ${cae} (Vto: ${fechaVto})`);
  console.log(`   ✓ Comprobante Nro: ${nroComprobante}\n`);

  return respuesta;
}

// ─── Funciones auxiliares privadas ────────────────────────────────────────────

/**
 * Genera un número de CAE ficticio de 14 dígitos (formato real de AFIP).
 */
function _generarCodigoCAE() {
  // El CAE real de AFIP tiene exactamente 14 dígitos numéricos
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, "0");
  return `${timestamp}${random}`;
}

/**
 * Calcula la fecha de vencimiento del CAE (10 días desde hoy, formato YYYYMMDD).
 */
function _calcularVencimientoCAE() {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + 10);
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, "0");
  const dd = String(fecha.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * Promesa de delay para simular latencia de red.
 */
function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { generarCAE };
