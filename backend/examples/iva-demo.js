// examples/iva-demo.js — Demo ejecutable del motor de IVA discriminado.
// Correlo con:  node backend/examples/iva-demo.js   (desde la raíz del repo)
//          o:   node examples/iva-demo.js            (desde backend/)

const {
  calcularItems,
  calcularTotalesPorAlicuota,
  calcularTotalesGenerales,
} = require("../services/ivaService");

// 4 productos con alícuotas distintas + un caso exento.
// precioNeto = SIN IVA (es lo que pide la consigna).
const carrito = [
  { nombre: "Coca Cola 500ml",        cantidad: 3, precioNeto: 702.48, iva: 21     }, // gravado 21%
  { nombre: "Leche entera 1L",        cantidad: 2, precioNeto: 904.98, iva: 10.5   }, // gravado 10,5%
  { nombre: "Energizante importado",  cantidad: 1, precioNeto: 2204.72, iva: 27    }, // gravado 27%
  { nombre: "Libro de recetas",       cantidad: 1, precioNeto: 8500.00, iva: "exento" }, // exento
];

const fmt = n => "$" + n.toFixed(2);

console.log("\n══════════════ DETALLE POR LÍNEA ══════════════");
for (const l of calcularItems(carrito)) {
  console.log(
    `\n${l.nombre}  (${l.iva.label})\n` +
    `  cant ${l.cantidad}  ×  neto u. ${fmt(l.precioNeto)}  (c/IVA u. ${fmt(l.precioUnitarioConIva)})\n` +
    `  subtotal neto ${fmt(l.subtotalNeto)}  |  IVA ${fmt(l.subtotalIva)}  |  total ${fmt(l.subtotalTotal)}`
  );
}

console.log("\n══════════════ TOTALES POR ALÍCUOTA (AFIP) ══════════════");
for (const g of calcularTotalesPorAlicuota(carrito)) {
  console.log(
    `  ${g.label.padEnd(12)}  base ${fmt(g.baseImponible).padStart(12)}  ` +
    `IVA ${fmt(g.importeIva).padStart(11)}  →  ${fmt(g.subtotalConIva)}`
  );
}

console.log("\n══════════════ TOTALES GENERALES ══════════════");
const t = calcularTotalesGenerales(carrito);
console.log(`  Neto gravado : ${fmt(t.netoGravado)}`);
console.log(`  IVA          : ${fmt(t.iva)}`);
console.log(`  Exento       : ${fmt(t.exento)}`);
console.log(`  No gravado   : ${fmt(t.noGravado)}`);
console.log(`  ───────────────────────────`);
console.log(`  TOTAL        : ${fmt(t.total)}\n`);
