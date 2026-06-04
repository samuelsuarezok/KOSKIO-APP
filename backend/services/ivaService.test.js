// services/ivaService.test.js — Tests del motor de IVA discriminado.
// Runner nativo, sin dependencias:  node --test   (o  npm test)

const { test } = require("node:test");
const assert   = require("node:assert/strict");

const {
  redondear2,
  resolverAlicuota,
  calcularLinea,
  calcularItems,
  calcularTotalesPorAlicuota,
  calcularTotalesGenerales,
} = require("./ivaService");

// ══ REDONDEO ═════════════════════════════════════════════════════════════════
// El caso de oro: Math.round(1.005*100)/100 da 1.00 (mal). El nuestro NO.
test("redondear2: redondea mitad hacia arriba sin error de float", () => {
  assert.equal(redondear2(1.005), 1.01);
  assert.equal(redondear2(2.675), 2.68);
  assert.equal(redondear2(0.1 + 0.2), 0.3); // 0.30000000000000004
  assert.equal(redondear2(190.0458), 190.05);
  assert.equal(redondear2(100), 100);
  assert.equal(redondear2(0), 0);
});

// ══ RESOLUCIÓN DE ALÍCUOTA ═══════════════════════════════════════════════════
test("resolverAlicuota: acepta número, string numérico y palabra", () => {
  assert.equal(resolverAlicuota(21).id, 5);
  assert.equal(resolverAlicuota("21").id, 5);
  assert.equal(resolverAlicuota(10.5).tasa, 10.5);
  assert.equal(resolverAlicuota("exento").tipo, "exento");
  assert.equal(resolverAlicuota("no_gravado").tipo, "no_gravado");
});

test("resolverAlicuota: distingue 0% de exento y de no gravado (clave AFIP)", () => {
  // Las tres tienen IVA $0 pero NO son lo mismo para AFIP.
  assert.equal(resolverAlicuota("0").tipo, "gravado");      // ImpNeto + ImpIVA(0)
  assert.equal(resolverAlicuota("exento").tipo, "exento");  // ImpOpEx
  assert.equal(resolverAlicuota("no_gravado").tipo, "no_gravado"); // ImpTotConc
});

test("resolverAlicuota: alícuota inválida lanza error", () => {
  assert.throws(() => resolverAlicuota(18), /Alícuota de IVA inválida/);
  assert.throws(() => resolverAlicuota("cualquiera"), /Alícuota de IVA inválida/);
});

// ══ LÍNEA ════════════════════════════════════════════════════════════════════
test("calcularLinea: discrimina neto, IVA y total correctamente (21%)", () => {
  const l = calcularLinea({ nombre: "Coca", cantidad: 3, precioNeto: 702.48, iva: 21 });
  assert.equal(l.precioUnitarioConIva, 850.00);
  assert.equal(l.subtotalNeto, 2107.44);
  assert.equal(l.subtotalIva, 442.56);
  assert.equal(l.subtotalTotal, 2550.00);
  assert.equal(l.iva.afipId, 5);
});

test("calcularLinea: exento no genera IVA", () => {
  const l = calcularLinea({ nombre: "Libro", cantidad: 1, precioNeto: 8500, iva: "exento" });
  assert.equal(l.subtotalIva, 0);
  assert.equal(l.subtotalTotal, 8500);
  assert.equal(l.iva.tipo, "exento");
});

test("calcularLinea: el IVA de la línea sale del neto de la línea, no del unitario", () => {
  // 2 × neto 904.98 @10,5%. Por unidad daría 1000.00 (×2 = 2000.00),
  // pero el cálculo correcto sobre el neto de línea da 2000.01.
  const l = calcularLinea({ nombre: "Leche", cantidad: 2, precioNeto: 904.98, iva: 10.5 });
  assert.equal(l.precioUnitarioConIva, 1000.00);
  assert.equal(l.subtotalIva, 190.05);
  assert.equal(l.subtotalTotal, 2000.01);
});

test("calcularLinea: rechaza cantidad y precio inválidos", () => {
  assert.throws(() => calcularLinea({ cantidad: 0,  precioNeto: 100, iva: 21 }), /Cantidad inválida/);
  assert.throws(() => calcularLinea({ cantidad: -1, precioNeto: 100, iva: 21 }), /Cantidad inválida/);
  assert.throws(() => calcularLinea({ cantidad: 1,  precioNeto: -5,  iva: 21 }), /Precio neto inválido/);
});

// ══ ITEMS (función principal) ════════════════════════════════════════════════
test("calcularItems: mapea todas las líneas y exige array no vacío", () => {
  const items = calcularItems([{ cantidad: 1, precioNeto: 100, iva: 21 }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].subtotalIva, 21);
  assert.throws(() => calcularItems([]),       /al menos un elemento/);
  assert.throws(() => calcularItems("nope"),   /array de items/);
});

// ══ TOTALES POR ALÍCUOTA (lo que valida AFIP) ════════════════════════════════
test("calcularTotalesPorAlicuota: IVA = base × tasa redondeado UNA vez por grupo", () => {
  // Dos líneas de la misma alícuota deben sumar la base y recién ahí sacar IVA.
  const grupos = calcularTotalesPorAlicuota([
    { cantidad: 1, precioNeto: 100.33, iva: 21 },
    { cantidad: 1, precioNeto: 200.33, iva: 21 },
  ]);
  assert.equal(grupos.length, 1);
  const g = grupos[0];
  assert.equal(g.baseImponible, 300.66);          // 100.33 + 200.33
  assert.equal(g.importeIva, redondear2(300.66 * 0.21)); // 63.14
  assert.equal(g.subtotalConIva, 363.80);
});

test("calcularTotalesPorAlicuota: agrupa por alícuota y ordena por código AFIP", () => {
  const grupos = calcularTotalesPorAlicuota([
    { cantidad: 1, precioNeto: 100, iva: 21 },
    { cantidad: 1, precioNeto: 100, iva: 10.5 },
    { cantidad: 1, precioNeto: 100, iva: 21 },
  ]);
  assert.equal(grupos.length, 2); // 21% y 10,5%, NO tres
  assert.deepEqual(grupos.map(g => g.afipId), [4, 5]); // ordenado por id AFIP
  assert.equal(grupos.find(g => g.tasa === 21).baseImponible, 200);
});

// ══ TOTALES GENERALES (la identidad contable) ════════════════════════════════
test("calcularTotalesGenerales: separa neto, exento y no gravado en sus importes", () => {
  const t = calcularTotalesGenerales([
    { cantidad: 1, precioNeto: 1000, iva: 21 },
    { cantidad: 1, precioNeto: 500,  iva: "exento" },
    { cantidad: 1, precioNeto: 300,  iva: "no_gravado" },
  ]);
  assert.equal(t.netoGravado, 1000);
  assert.equal(t.iva, 210);
  assert.equal(t.exento, 500);
  assert.equal(t.noGravado, 300);
  assert.equal(t.total, 2010); // 1000 + 210 + 500 + 300
});

test("calcularTotalesGenerales: SIEMPRE vale neto+iva+exento+noGravado === total", () => {
  const carrito = [
    { cantidad: 3, precioNeto: 702.48,  iva: 21 },
    { cantidad: 2, precioNeto: 904.98,  iva: 10.5 },
    { cantidad: 1, precioNeto: 2204.72, iva: 27 },
    { cantidad: 1, precioNeto: 8500.00, iva: "exento" },
    { cantidad: 5, precioNeto: 333.33,  iva: "no_gravado" },
  ];
  const t = calcularTotalesGenerales(carrito);
  const reconstruido = redondear2(t.netoGravado + t.iva + t.exento + t.noGravado);
  assert.equal(reconstruido, t.total);
});
