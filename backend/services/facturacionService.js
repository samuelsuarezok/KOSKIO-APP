// Mock ARCA/AFIP — reemplazar con certificados reales para producción
async function generarCAE(datosVenta) {
  console.log(`   → Obteniendo Ticket de Acceso (WSAA)...`);
  await _delay(500);
  console.log(`   ✓ Ticket obtenido.`);
  console.log(`   → Enviando a WSFE (FECAESolicitar)...`);
  await _delay(1500);
  const cae = _generarCodigoCAE();
  const fechaVto = _calcularVencimientoCAE();
  const nroComprobante = Math.floor(Math.random() * 900000) + 100000;
  console.log(`   ✓ CAE: ${cae} (Vto: ${fechaVto})`);
  return { success: true, cae, cae_fch_vto: fechaVto, nro_comprobante: nroComprobante, tipo_comprobante: 11, punto_venta: 1, _mock: true };
}
function _generarCodigoCAE() { return `${Date.now().toString().slice(-8)}${Math.floor(Math.random()*1000000).toString().padStart(6,"0")}`; }
function _calcularVencimientoCAE() { const d = new Date(); d.setDate(d.getDate()+10); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`; }
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
module.exports = { generarCAE };
