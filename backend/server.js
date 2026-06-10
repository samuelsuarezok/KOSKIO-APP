// server.js — KOSKIO APP SaaS v2.1.0

const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const { initMasterDb }     = require("./db/masterDb");
const { initTenantEngine } = require("./db/tenantDb");
const { verificarToken }   = require("./middleware/auth");
const { resolverTenant }   = require("./middleware/tenant");

const PORT = process.env.PORT || 3000;
const app  = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ── Rutas públicas ────────────────────────────────────────────────────────────
app.use("/api/auth",       require("./routes/auth"));
app.use("/api/superadmin", require("./routes/superadmin/index"));

// ── Rutas protegidas por tenant ───────────────────────────────────────────────
app.use("/api/productos", verificarToken, resolverTenant, require("./routes/productos"));
app.use("/api/ventas",    verificarToken, resolverTenant, require("./routes/ventas"));
app.use("/api/caja",      verificarToken, resolverTenant, require("./routes/caja"));
app.use("/api/config",    verificarToken, resolverTenant, require("./routes/config"));

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"))
);

app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(500).json({ success: false, mensaje: "Error interno del servidor." });
});

async function iniciar() {
  await initTenantEngine();
  await initMasterDb();
  app.listen(PORT, () => {
    console.log("╔════════════════════════════════════════╗");
    console.log("║       🏪 KOSKIO APP SaaS v2.1.0       ║");
    console.log("╠════════════════════════════════════════╣");
    console.log(`║  → http://localhost:${PORT}              ║`);
    console.log(`║  → http://localhost:${PORT}/superadmin   ║`);
    console.log("╚════════════════════════════════════════╝\n");
  });
}

iniciar().catch(err => { console.error("❌ Error fatal:", err); process.exit(1); });
module.exports = app;
