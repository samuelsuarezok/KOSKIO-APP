// services/ivaService.js — KOSKIO APP
// ─────────────────────────────────────────────────────────────────────────────
// Motor de cálculo de IVA discriminado (neto → IVA → total) según la lógica
// que valida AFIP en WSFEv1 (RG 4291 y concordantes).
//
// ⚠️ IMPORTANTE — CONDICIÓN FISCAL:
//   El IVA DISCRIMINADO (neto + IVA por separado) corresponde a un emisor
//   RESPONSABLE INSCRIPTO (Factura A, y reporte de IVA en Factura B).
//   Un MONOTRIBUTISTA (Factura C, tipo_cbte 11 — que es como está hoy
//   configurado facturacionService.js) NO discrimina IVA: factura el total.
//   Usá este módulo si emitís Factura A, o para control interno de costos.
//
// REGLA DE ORO DE PRECISIÓN AFIP:
//   El IVA NO se calcula por unidad y se suma. Se calcula sobre la BASE
//   IMPONIBLE TOTAL de cada alícuota (Σ netos de esa alícuota) y se redondea
//   UNA sola vez por alícuota. Sumar centavos línea por línea acumula error de
//   redondeo y AFIP rechaza el comprobante (tolerancia ±$0,01 por alícuota).
//   Por eso el IVA "por unidad" de cada línea es SÓLO informativo/visual; el
//   importe que vale es el de calcularTotalesPorAlicuota().
// ─────────────────────────────────────────────────────────────────────────────

// ══ CATÁLOGO DE ALÍCUOTAS ════════════════════════════════════════════════════
// `id` = código de IVA de AFIP (tabla del WSFEv1). `tipo` define a qué importe
// del comprobante suma cada caso:
//   gravado    → ImpNeto + ImpIVA
//   exento     → ImpOpEx     (operaciones exentas)
//   no_gravado → ImpTotConc  (importe neto no gravado)
// Exento, No Gravado y 0% son TRES cosas distintas para AFIP — no los mezcles.
const ALICUOTAS = {
  "21":         { id: 5, tasa: 21,   tipo: "gravado",    label: "IVA 21%"   },
  "10.5":       { id: 4, tasa: 10.5, tipo: "gravado",    label: "IVA 10,5%" },
  "27":         { id: 6, tasa: 27,   tipo: "gravado",    label: "IVA 27%"   },
  "5":          { id: 8, tasa: 5,    tipo: "gravado",    label: "IVA 5%"    },
  "2.5":        { id: 9, tasa: 2.5,  tipo: "gravado",    label: "IVA 2,5%"  },
  "0":          { id: 3, tasa: 0,    tipo: "gravado",    label: "IVA 0%"    },
  "exento":     { id: 2, tasa: 0,    tipo: "exento",     label: "Exento"    },
  "no_gravado": { id: 1, tasa: 0,    tipo: "no_gravado", label: "No Gravado"},
};

/**
 * Resuelve la categoría de IVA a partir de lo que venga en el item.
 * Acepta número (21, 10.5), string numérico ("21") o palabra ("exento").
 */
function resolverAlicuota(iva) {
  const clave = String(iva).trim().toLowerCase();
  const cat = ALICUOTAS[clave];
  if (!cat) {
    throw new Error(
      `Alícuota de IVA inválida: "${iva}". Válidas: ${Object.keys(ALICUOTAS).join(", ")}.`
    );
  }
  return cat;
}

// ══ REDONDEO AFIP (2 decimales, simétrico / mitad hacia arriba) ══════════════
// No usamos `Math.round(n * 100) / 100` directo porque el float rompe casos
// como 1.005 (queda 1.00 en vez de 1.01). El truco de notación exponencial
// evita el error de la multiplicación por 100.
function redondear2(num) {
  return Number(`${Math.round(Number(`${num}e+2`))}e-2`);
}

// ══ CÁLCULO POR LÍNEA ════════════════════════════════════════════════════════
/**
 * Calcula una línea de venta/factura con todos los importes discriminados.
 * @param {{nombre?:string, cantidad:number, precioNeto:number, iva:number|string}} item
 * @returns línea enriquecida con neto, IVA y total
 */
function calcularLinea(item) {
  const cantidad   = Number(item.cantidad);
  const precioNeto = Number(item.precioNeto);

  if (!Number.isFinite(cantidad) || cantidad <= 0)
    throw new Error(`Cantidad inválida en "${item.nombre ?? "?"}": ${item.cantidad}`);
  if (!Number.isFinite(precioNeto) || precioNeto < 0)
    throw new Error(`Precio neto inválido en "${item.nombre ?? "?"}": ${item.precioNeto}`);

  const cat  = resolverAlicuota(item.iva);
  const tasa = cat.tasa;

  // Por unidad (informativo / para mostrar en pantalla)
  const ivaUnitario          = redondear2(precioNeto * (tasa / 100));
  const precioUnitarioConIva = redondear2(precioNeto * (1 + tasa / 100));

  // Por línea (autoritativo a nivel línea)
  const subtotalNeto = redondear2(precioNeto * cantidad);
  // El IVA de la línea se calcula sobre el neto de la línea, no como
  // ivaUnitario * cantidad, para no arrastrar el redondeo del centavo.
  const subtotalIva   = cat.tipo === "gravado" ? redondear2(subtotalNeto * (tasa / 100)) : 0;
  const subtotalTotal = redondear2(subtotalNeto + subtotalIva);

  return {
    ...item,
    cantidad,
    precioNeto,
    iva: {
      tasa,
      tipo:  cat.tipo,
      afipId: cat.id,
      label: cat.label,
    },
    ivaUnitario,
    precioUnitarioConIva,
    subtotalNeto,
    subtotalIva,
    subtotalTotal,
  };
}

/**
 * Función principal: recibe un array de items y devuelve los mismos items con
 * todos los cálculos discriminados.
 */
function calcularItems(items) {
  if (!Array.isArray(items) || items.length === 0)
    throw new Error("Se esperaba un array de items con al menos un elemento.");
  return items.map(calcularLinea);
}

// ══ TOTALES POR ALÍCUOTA (lo que mira AFIP) ══════════════════════════════════
/**
 * Agrupa por alícuota y calcula la base imponible y el IVA de cada grupo.
 * El IVA se calcula como base × tasa y se redondea UNA vez por grupo (método
 * correcto para AFIP). Devuelve un array listo para el array `Iva` del WSFEv1.
 */
function calcularTotalesPorAlicuota(items) {
  const lineas = calcularItems(items);
  const grupos = new Map(); // clave: afipId

  for (const l of lineas) {
    const clave = l.iva.afipId;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        afipId:      l.iva.afipId,
        tasa:        l.iva.tasa,
        tipo:        l.iva.tipo,
        label:       l.iva.label,
        baseImponible: 0,
        importeIva:    0,
      });
    }
    grupos.get(clave).baseImponible += l.subtotalNeto;
  }

  // Cerrar cada grupo: redondear base y calcular IVA una sola vez.
  const resultado = [];
  for (const g of grupos.values()) {
    g.baseImponible = redondear2(g.baseImponible);
    g.importeIva    = g.tipo === "gravado" ? redondear2(g.baseImponible * (g.tasa / 100)) : 0;
    g.subtotalConIva = redondear2(g.baseImponible + g.importeIva);
    resultado.push(g);
  }
  // Orden estable por código AFIP para salida predecible.
  return resultado.sort((a, b) => a.afipId - b.afipId);
}

// ══ TOTALES GENERALES ════════════════════════════════════════════════════════
/**
 * Totales del comprobante, derivados del agrupamiento por alícuota para que
 * reconcilien con AFIP al centavo. Las claves Imp* mapean 1:1 con WSFEv1.
 */
function calcularTotalesGenerales(items) {
  const grupos = calcularTotalesPorAlicuota(items);

  let impNeto = 0;   // Σ bases gravadas
  let impIva  = 0;   // Σ IVA
  let impOpEx = 0;   // Σ exento
  let impTotConc = 0; // Σ no gravado

  for (const g of grupos) {
    if (g.tipo === "gravado")    { impNeto    += g.baseImponible; impIva += g.importeIva; }
    else if (g.tipo === "exento") { impOpEx    += g.baseImponible; }
    else                          { impTotConc += g.baseImponible; }
  }

  impNeto    = redondear2(impNeto);
  impIva     = redondear2(impIva);
  impOpEx    = redondear2(impOpEx);
  impTotConc = redondear2(impTotConc);
  const impTotal = redondear2(impNeto + impIva + impOpEx + impTotConc);

  return {
    netoGravado: impNeto,    // ImpNeto
    iva:         impIva,     // ImpIVA
    exento:      impOpEx,    // ImpOpEx
    noGravado:   impTotConc, // ImpTotConc
    total:       impTotal,   // ImpTotal
    porAlicuota: grupos,     // detalle para el array Iva del WSFEv1
  };
}

module.exports = {
  ALICUOTAS,
  redondear2,
  resolverAlicuota,
  calcularLinea,
  calcularItems,
  calcularTotalesPorAlicuota,
  calcularTotalesGenerales,
};
