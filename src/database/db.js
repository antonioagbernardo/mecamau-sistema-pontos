const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const defaultDbPath = path.join(process.cwd(), 'employees.db');
const preferredPath = process.env.DB_FILE || defaultDbPath;

function resolveDbPath(preferred, fallback){
  const dir = path.dirname(preferred);
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Test writability of directory
    fs.accessSync(dir, fs.constants.W_OK);
    return preferred;
  } catch (e) {
    console.warn("DB_FILE indisponível (", preferred, "):", e?.message, "→ usando", fallback);
    try {
      fs.mkdirSync(path.dirname(fallback), { recursive: true });
    } catch(_){}
    return fallback;
  }
}

function migrations(db){
  // Use serialize to ensure statements run in order and apply lightweight migrations
  db.serialize(() => {
  //
  // 👤 TABELA USUÁRIOS
  //
  db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    login TEXT UNIQUE,
    senha TEXT,
    pontos INTEGER DEFAULT 0
  )
  `);

  // Ensure required columns exist (safe to run against existing DB)
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err) {
      console.error("Erro ao verificar colunas da tabela users:", err);
      return;
    }
    const cols = rows.map((r) => r.name);
    const toAdd = [];
    if (!cols.includes("foto")) toAdd.push({ name: "foto", def: "TEXT" });
    if (!cols.includes("is_admin")) toAdd.push({ name: "is_admin", def: "INTEGER DEFAULT 0" });
    if (!cols.includes("pontos")) toAdd.push({ name: "pontos", def: "INTEGER DEFAULT 0" });

    toAdd.forEach((c) => {
      db.run(`ALTER TABLE users ADD COLUMN ${c.name} ${c.def}`, (alterErr) => {
        if (alterErr) {
          // If the column already exists (race condition) or another error occurs, log it
          console.error(`Falha ao adicionar coluna ${c.name}:`, alterErr);
        } else {
          console.log(`Coluna adicionada: ${c.name}`);
        }
      });
    });
  });

  //
  // 📊 HISTÓRICO DE PONTOS
  //
  db.run(`
  CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    tipo TEXT,
    pontos INTEGER,
    motivo TEXT,
    data DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
  `);

  // ⚙️ CONFIGURAÇÕES (key/value) — usado para Regras e Prêmio
  db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )
  `);
  });
}

const resolvedPath = resolveDbPath(preferredPath, defaultDbPath);
const db = new sqlite3.Database(resolvedPath, (err) => {
  if (err) {
    console.error("Erro ao abrir banco:", err?.message);
  } else {
    console.log("Banco conectado 🚀 (", resolvedPath, ")");
    migrations(db);
  }
});

module.exports = db;
