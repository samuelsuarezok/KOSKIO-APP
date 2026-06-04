# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

KOSKIO APP — a point-of-sale (POS) system for an Argentine kiosco/almacén. Express + sql.js backend serving a vanilla-JS static frontend. No build step, no framework, no test suite. Spanish is the working language for code, comments, identifiers, and UI.

## Commands

There is no root `package.json`. Everything runs from `backend/`:

```bash
cd backend
npm install        # first time only
npm start          # node server.js → http://localhost:3000
npm test           # node --test → runs *.test.js (unit + endpoint integration)
```

The Express server also statically serves the `frontend/` folder, so opening `http://localhost:3000` loads the whole app. There is no separate frontend dev server and no linter. Tests use the built-in `node:test` runner (zero deps) — keep it that way; do not add Jest/Vitest/Puppeteer or a build step. The project is deliberately dependency-light.

**Testing approach:** Pure logic gets unit tests (`services/ivaService.test.js`). HTTP routes get integration tests (`test/endpoints.test.js`) that build their own Express app mirroring `server.js`'s `/api` wiring, listen on an ephemeral port, and hit it with `fetch`. Isolation: set `KOSKIO_DB_PATH` to a temp file *before* requiring `db/database` so the suite never touches the real `pos_data.db`. The frontend is intentionally not automated yet (single screen, low ROI).

Default seeded admin login (created on first run if no users exist): **usuario `admin` / contraseña `admin123`** (see `seedAdmin` in the DB module).

## Architecture

### Request flow
`frontend/js/app.js` (single global `state` object, no framework) → `fetch` to `/api/*` → `backend/server.js` mounts routers → routers call `getDb()` for data access.

- `server.js` wires routes. `/api/auth` is public; `/api/productos`, `/api/ventas`, `/api/caja`, `/api/backup` are all wrapped in `verificarToken`.
- `middleware/auth.js` exports `verificarToken` (JWT, 12h expiry, attaches `req.usuario = { id, nombre, usuario, rol }`) and `soloAdmin` (role gate, used **inside** caja/backup routers, applied after token check).
- Auth is JWT in `Authorization: Bearer <token>`. `JWT_SECRET` is resolved in `middleware/auth.js` (`resolverJwtSecret`): env var if set; in `NODE_ENV=production` with no `JWT_SECRET` the module **throws at load** (server refuses to boot insecure); in dev with none it generates a random **ephemeral** secret per boot (tokens die on restart). There is intentionally **no hardcoded fallback secret** — don't reintroduce one. Tests set `JWT_SECRET` for determinism.
- Password minimum length is `PASSWORD_MIN` (8) in `routes/auth.js`, enforced on user create and update. On boot, `database.js` warns if `admin` still uses the default `admin123` (it does not force a change — no UI flow for that yet).
- Roles: `admin` and `cajero`. Cajeros can sell and look up products; admin-only areas are caja (cierre de caja), inventory writes, user management, and backups. The frontend also hides admin nav items, but the real enforcement is `soloAdmin` server-side.

### Data layer — sql.js, NOT a real DB server
The database is **sql.js** (SQLite compiled to WASM), held entirely in memory and persisted by writing the whole file to disk. This is the single most important thing to understand:

- **Every `run()` call serializes the entire DB and writes it to `pos_data.db`** via `persistirEnDisco()` (`fs.writeFileSync(db.export())`). There is no connection pool. It works because this is a single-terminal kiosk app. Do not assume Postgres/better-sqlite3 semantics.
- Data access goes through `getDb()`, which returns `{ run, get, all, lastInsertRowid, transaction }`. Use these — `get` returns one row or `null`, `all` returns an array, `run` writes + persists.
- **Multi-write operations MUST use `transaction(fn)`** — it wraps the writes in `BEGIN/COMMIT`, persists to disk **once** at commit, and `ROLLBACK`s (touching disk not at all) if `fn` throws. The callback receives a `tx` whose `run` does NOT persist per-statement. `fn` must be **synchronous** (no `await` inside) so no other request interleaves mid-transaction. The venta route is the reference user: it generates the CAE *first* (the slow/fallible AFIP call, before any DB state), then writes venta + items + stock atomically, so a sale is born `'completada'` and a failed CAE or stock check leaves zero partial state. Do not go back to per-`run()` writes for the venta flow.
- **`db.export()` resets sql.js `last_insert_rowid()` to 0.** Since `run()` exports after every write, `last_insert_rowid()` is useless if read afterwards. The fix in place: `run()` captures the id into a cached `_lastInsertId` *before* calling `persistirEnDisco()`, and `lastInsertRowid()` returns that cache. Do not "simplify" `lastInsertRowid()` back to `SELECT last_insert_rowid()` — it will silently return 0 and every `UPDATE ... WHERE id=?` after an insert will match nothing.
- `DB_PATH` is overridable via the `KOSKIO_DB_PATH` env var (default = `backend/pos_data.db`). Use it to point tests at a throwaway DB. Note `backupService.js` still hardcodes the real path, so it backs up the production DB even during tests.
- Tables: `productos`, `ventas`, `venta_items`, `usuarios`, `cierres_caja`. Schema is created with `CREATE TABLE IF NOT EXISTS` on every boot, so changing a `CREATE TABLE` body does **not** alter an existing `pos_data.db` — you must add an `ALTER TABLE ... ` migration guarded by `try { } catch(_) {}` (see the `facturada` migration as the pattern).

### Database module
`backend/db/database.js` is the single DB module — `server.js` and all routers import it (`require("../db/database")` / `"./db/database"`). (A duplicate `backend/database.js` used to exist and drift; it was removed. If you see references to it, they are stale.)

### Facturación (AFIP electronic invoicing)
`services/facturacionService.js` generates a CAE (invoice authorization code). It has a `MODO_FACTURACION` flag: `"MOCK"` (default — simulated CAE with delays, no certs) or `"REAL"` (WSAA/WSFE SOAP integration against AFIP, currently a documented stub that throws — needs certs in `backend/certs/` and CMS signing). A sale only requests a CAE when the cashier passes `generar_factura: true`; otherwise `generarCAE` returns `null` and the sale is recorded unfactured.

### Backups
`services/backupService.js` copies `pos_data.db` into `backend/backups/` on server start and then daily at midnight, keeping the last 30. Admins can also trigger a manual backup via `POST /api/backup`.

## Conventions

- API responses follow `{ success: boolean, mensaje?, data?, ... }`. Errors return the same shape with `success: false`. Keep this contract.
- All user-facing strings and log messages are in Rioplatense Spanish ("Iniciá sesión", "No tenés permisos"). Match this tone.
- Usernames are stored and matched lowercased/trimmed.
- Timestamps use SQLite `datetime('now','localtime')`, not UTC — the app assumes a single local timezone (AR).
- Frontend is one file (`app.js`, ~900 lines) of plain functions mutating a shared `state` object; views are toggled with `switchView`. No modules, no bundler.

## Gotchas

- `pos_data.db` is `.gitignore`d but an instance is already committed (`backend/pos_data.db`) — it carries seed data and the live schema. Be careful: schema changes via `CREATE TABLE IF NOT EXISTS` won't apply to it.
- `node_modules/` is committed to git in this repo despite being gitignored, so `git ls-files` is noisy.
- The version strings in file headers (`v1.3.0`, `v1.2.0`, etc.) are not kept in sync across files; don't rely on them.
