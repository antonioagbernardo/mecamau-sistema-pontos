require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require("./database/db");
const multer = require("multer");

const app = express();

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(cookieParser());
app.set('trust proxy', 1);

// Static for uploads & logos (configurable uploads path)
const fs = require("fs");
const path = require("path");

function ensureUploadsDir() {
  const preferred = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch (e) {
    console.warn("Falha ao criar UPLOADS_DIR (", preferred, "):", e?.message);
    const fallback = path.join(process.cwd(), 'uploads');
    try {
      fs.mkdirSync(fallback, { recursive: true });
      console.warn("Usando pasta de uploads local:", fallback);
      return fallback;
    } catch (e2) {
      console.error("Falha ao criar pasta de uploads local:", e2?.message);
      // último recurso: ainda retornamos fallback; multer tentará e poderá falhar caso sem permissão
      return fallback;
    }
  }
}

const UPLOADS_DIR = ensureUploadsDir();
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/logos", express.static("logos"));

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

//
// 📸 UPLOAD FOTO
//
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  }
});
const upload = multer({ storage });

// Auth helpers
function signToken(user) {
  return jwt.sign({ id: user.id, is_admin: !!user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ message: 'Não autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Sessão inválida' });
  }
}

function adminRequired(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ message: 'Acesso restrito' });
  next();
}

//
// ROOT
//
app.get("/", (req, res) => { res.sendFile(path.join(process.cwd(), 'public', 'index.html')); });
app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

// Guard pages BEFORE static
const sendFile = (p) => (req,res)=> res.sendFile(path.join(process.cwd(), 'public', p));
app.get(["/admin","/admin.html"], authRequired, adminRequired, sendFile('admin.html'));
app.get(["/dashboard","/dashboard.html"], authRequired, sendFile('dashboard.html'));
app.get(["/regras","/regras.html"], authRequired, sendFile('regras.html'));
// Public index stays public
app.use(express.static("public"));

//
// 👑 CRIAR ADMIN 1x
//
app.get("/criar-admin", (req, res) => {
  if (process.env.ALLOW_BOOTSTRAP_ADMIN !== '1') {
    return res.status(404).send("Not found");
  }
  const senhaHash = bcrypt.hashSync("adminMestre", 10);
  db.run(
    "INSERT INTO users (nome, login, senha, is_admin) VALUES (?,?,?,1)",
    ["Administrador","admin",senhaHash],
    function(err){
      if(err){ console.log(err); return res.send("Admin já existe"); }
      res.send("Admin criado 👑");
    }
  );
});

//
// 👑 CRIAR NOVO ADMIN
//
app.post("/criar-admin2", authRequired, adminRequired, (req,res)=>{
  const {login,senha} = req.body;
  const hash = bcrypt.hashSync(String(senha||''), 10);
  db.run(
    "INSERT INTO users (nome,login,senha,is_admin) VALUES (?,?,?,1)",
    ["Admin",login,hash],
    function(err){
      if(err){ console.log(err); return res.status(400).send("Erro ao criar admin"); }
      res.send("Admin criado 👑");
    }
  );
});

//
// 🔐 LOGIN
//
app.post("/login", (req, res) => {
  const { login, senha } = req.body;
  if(!login || !senha) return res.status(400).json({message:"Dados inválidos"});
  db.get("SELECT * FROM users WHERE login=?", [login], (err, user) => {
    if (err) return res.status(500).json({ message: "Erro servidor" });
    if (!user) return res.status(401).json({ message: "Login ou senha inválidos" });
    const passOk = bcrypt.compareSync(String(senha), String(user.senha)) || String(user.senha) === String(senha);
    if (!passOk) return res.status(401).json({ message: "Login ou senha inválidos" });
    const token = signToken(user);
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7*24*60*60*1000 });
    res.json({ message: "Login ok", user: { id: user.id, nome: user.nome, is_admin: !!user.is_admin } });
  });
});

app.post('/logout', (req,res)=>{
  res.clearCookie('token');
  res.json({message:'Logout ok'});
});

app.get('/me', authRequired, (req,res)=>{
  db.get("SELECT id,nome,login,is_admin,pontos,foto FROM users WHERE id=?", [req.user.id], (err,row)=>{
    if (err || !row) return res.status(404).json({});
    res.json(row);
  });
});

//
// 👤 CRIAR FUNCIONÁRIO
//
app.post("/criar-funcionario", authRequired, adminRequired, upload.single("foto"), (req,res)=>{
  const {nome,login,senha} = req.body;
  const foto = req.file ? req.file.filename : null;
  const hash = bcrypt.hashSync(String(senha||''), 10);

  db.run(
    "INSERT INTO users (nome,login,senha,foto) VALUES (?,?,?,?)",
    [nome,login,hash,foto],
    function(err){
      if(err){
        console.log(err);
        return res.status(400).send("Erro ao criar funcionário");
      }
      res.send("Funcionário criado 🚀");
    }
  );
});

//
// ⭐ PONTOS
//
app.post("/pontos", authRequired, adminRequired, (req,res)=>{
  let {userId,pontos,motivo} = req.body;
  userId = Number(userId);
  const delta = Number(pontos);
  const motivoTrim = String(motivo||'').trim();

  if(!userId || isNaN(delta)){
    return res.status(400).json({message:"Dados inválidos"});
  }
  if(!motivoTrim){
    return res.status(400).json({message:"Motivo é obrigatório"});
  }

  // Buscar pontos atuais para calcular delta aplicado e limitar a 0..100 e impedir ajuste em admins
  db.get("SELECT pontos, is_admin FROM users WHERE id=\?", [userId], (selErr, row) => {
    if (selErr) return res.status(500).json({message:"Erro ao buscar usuário"});
    if (!row) return res.status(404).json({message:"Usuário não encontrado"});
    if (Number(row.is_admin) === 1) return res.status(400).json({message:"Apenas funcionários podem receber pontos"});

    const atual = Number(row.pontos||0);
    const novo = Math.max(0, Math.min(atual + delta, 100));
    const aplicado = novo - atual; // pode ser menor que delta quando atingiu teto

    db.run("UPDATE users SET pontos=? WHERE id=?", [novo, userId], function(updErr){
      if (updErr) return res.status(500).json({message:"Erro ao atualizar"});

      db.run(
        "INSERT INTO historico (user_id,tipo,pontos,motivo,editor_id) VALUES (?,?,?,?,?)",
        [userId, aplicado>=0?"ganhou":"perdeu", aplicado, motivoTrim, req.user.id]
      );

      res.json({ message:"Pontos atualizados ⭐", pontos: novo });
    });
  });
});

//
// 📜 HISTÓRICO
//
app.get("/historico/:id", authRequired, (req,res)=>{
  const id = req.params.id;
  if (!req.user.is_admin && Number(id) !== req.user.id) {
    return res.status(403).json({ message: 'Acesso restrito' });
  }

  const sql = req.user.is_admin
    ? `SELECT h.*, u.nome AS editor_nome FROM historico h LEFT JOIN users u ON u.id=h.editor_id WHERE h.user_id=? ORDER BY h.id DESC`
    : `SELECT * FROM historico WHERE user_id=? ORDER BY id DESC`;
  db.all(sql, [id], (err, rows) => {
    if (err) return res.send([]);
    res.send(rows);
  });
});

//
// 🏆 RANKING
//
app.get("/ranking",(req,res)=>{
  db.all(
    "SELECT nome,pontos FROM users WHERE is_admin=0 ORDER BY pontos DESC",
    [],
    (err,rows)=>{
      if(err) return res.send([]);
      res.send(rows);
    }
  );
});

//
// 👤 USER INFO
//
app.get("/user/:id", authRequired, (req,res)=>{
  const id = req.params.id;
  if (!req.user.is_admin && Number(id) !== req.user.id) {
    return res.status(403).json({});
  }

  db.get(
    "SELECT id,nome,pontos,foto FROM users WHERE id=?",
    [id],
    (err,row)=>{
      if(err || !row) return res.send({});
      res.send(row);
    }
  );
});

//
// 📋 LISTAR USERS
//
app.get("/usuarios", authRequired, adminRequired, (req,res)=>{
  db.all(
    "SELECT id,nome,pontos,foto,is_admin FROM users ORDER BY nome",
    [],
    (err,rows)=>{
      if(err) return res.send([]);
      res.send(rows);
    }
  );
});

//
// ✏️ ATUALIZAR USUÁRIO (admin ou próprio usuário)
// Aceita multipart/form-data para permitir atualização de foto.
// Campos aceitos: nome, login, senha, is_admin (0/1), foto (arquivo)
// Apenas campos enviados serão atualizados.
//
app.put("/usuarios/:id", authRequired, upload.single("foto"), (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "ID inválido" });
  if (!req.user.is_admin && req.user.id !== id) return res.status(403).json({ message: 'Acesso restrito' });

  const { nome, login, senha } = req.body;
  // is_admin pode vir como string "0" | "1"; só atualiza se foi enviado
  const is_admin = req.user.is_admin && (typeof req.body.is_admin !== "undefined") ? Number(req.body.is_admin ? 1 : 0) : undefined;
  const novaFoto = req.file ? req.file.filename : undefined;

  // Primeiro buscar dados atuais (para remoção de foto antiga, se necessário)
  db.get("SELECT foto FROM users WHERE id=?", [id], (selErr, current) => {
    if (selErr) {
      console.error(selErr);
      return res.status(500).json({ message: "Erro ao buscar usuário" });
    }
    if (!current) return res.status(404).json({ message: "Usuário não encontrado" });

    const sets = [];
    const params = [];
    if (typeof nome !== "undefined" && nome !== null && nome !== "") { sets.push("nome=?"); params.push(nome); }
    if (typeof login !== "undefined" && login !== null && login !== "") { sets.push("login=?"); params.push(login); }
    if (typeof senha !== "undefined" && senha !== null && senha !== "") { 
      const hash = bcrypt.hashSync(String(senha), 10);
      sets.push("senha=?"); params.push(hash); 
    }
    if (typeof is_admin !== "undefined" && (is_admin === 0 || is_admin === 1)) { sets.push("is_admin=?"); params.push(is_admin); }
    if (typeof novaFoto !== "undefined") { sets.push("foto=?"); params.push(novaFoto); }

    if (sets.length === 0) {
      return res.status(400).json({ message: "Nada para atualizar" });
    }

    const sql = `UPDATE users SET ${sets.join(",")} WHERE id=?`;
    params.push(id);

    db.run(sql, params, function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Erro ao atualizar usuário" });
      }

      // Apagar foto antiga se foi enviada uma nova
      if (typeof novaFoto !== "undefined" && current.foto && current.foto !== novaFoto) {
        const oldPath = path.join(UPLOADS_DIR, current.foto);
        fs.unlink(oldPath, (unlinkErr) => {
          if (unlinkErr && unlinkErr.code !== "ENOENT") {
            console.error("Falha ao remover foto antiga:", unlinkErr);
          }
        });
      }

      res.json({ message: "Usuário atualizado" });
    });
  });
});

//
// 🗑️ REMOVER USUÁRIO (admin)
// Remove também histórico associado e foto do disco
//
app.delete("/usuarios/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "ID inválido" });

  db.get("SELECT foto FROM users WHERE id=?", [id], (selErr, row) => {
    if (selErr) {
      console.error(selErr);
      return res.status(500).json({ message: "Erro ao buscar usuário" });
    }
    if (!row) return res.status(404).json({ message: "Usuário não encontrado" });

    // Remover histórico primeiro
    db.run("DELETE FROM historico WHERE user_id=?", [id], function (histErr) {
      if (histErr) {
        console.error(histErr);
        return res.status(500).json({ message: "Erro ao remover histórico" });
      }

      // Remover usuário
      db.run("DELETE FROM users WHERE id=?", [id], function (delErr) {
        if (delErr) {
          console.error(delErr);
          return res.status(500).json({ message: "Erro ao remover usuário" });
        }

        // Remover foto do disco
        if (row.foto) {
          const filePath = path.join(UPLOADS_DIR, row.foto);
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr && unlinkErr.code !== "ENOENT") {
              console.error("Falha ao remover foto:", unlinkErr);
            }
          });
        }

        res.json({ message: "Usuário removido" });
      });
    });
  });
});

// 🔁 Operações em massa
app.post('/pontos/reset_all', authRequired, adminRequired, (req,res)=>{
  let { valor, motivo } = req.body;
  const motivoTrim = String(motivo||'').trim();
  let alvo = Number(valor);
  if (isNaN(alvo)) return res.status(400).json({message:'Valor inválido'});
  if (!motivoTrim) return res.status(400).json({message:'Motivo é obrigatório'});
  alvo = Math.max(0, Math.min(alvo, 100));

  db.all("SELECT id FROM users WHERE is_admin=0", [], (err, users)=>{
    if (err) return res.status(500).json({message:'Erro ao buscar usuários'});
    const ids = users.map(u=>u.id);
    const placeholders = ids.map(_=>'?').join(',');
    const runUpdate = (cb)=> db.run(`UPDATE users SET pontos=? WHERE is_admin=0`, [alvo], cb);
    runUpdate((updErr)=>{
      if (updErr) return res.status(500).json({message:'Erro ao aplicar reset'});
      const stmt = db.prepare("INSERT INTO historico (user_id,tipo,pontos,motivo,editor_id) VALUES (?,?,?,?,?)");
      ids.forEach(id=>{
        stmt.run([id, 'ciclo', alvo, `Novo ciclo: reset para ${alvo}. ${motivoTrim}`.trim(), req.user.id]);
      });
      stmt.finalize(()=> res.json({message:`Pontos de todos definidos em ${alvo}` }));
    });
  });
});

app.post('/pontos/bulk_add', authRequired, adminRequired, (req,res)=>{
  let { delta, motivo } = req.body;
  const motivoTrim = String(motivo||'').trim();
  const d = Number(delta);
  if (isNaN(d)) return res.status(400).json({message:'Delta inválido'});
  if (!motivoTrim) return res.status(400).json({message:'Motivo é obrigatório'});

  db.all("SELECT id, pontos FROM users WHERE is_admin=0", [], (err, users)=>{
    if (err) return res.status(500).json({message:'Erro ao buscar usuários'});
    const stmtUpd = db.prepare("UPDATE users SET pontos=? WHERE id=?");
    const stmtHist = db.prepare("INSERT INTO historico (user_id,tipo,pontos,motivo,editor_id) VALUES (?,?,?,?,?)");
    users.forEach(u=>{
      const novo = Math.max(0, Math.min((u.pontos||0) + d, 100));
      const aplicado = novo - (u.pontos||0);
      stmtUpd.run([novo, u.id]);
      stmtHist.run([u.id, aplicado>=0?'ganhou':'perdeu', aplicado, motivoTrim, req.user.id]);
    });
    stmtUpd.finalize(()=>{
      stmtHist.finalize(()=> res.json({message:`Pontos atualizados para ${users.length} usuários`}));
    });
  });
});

// 📘 Regras (lido por todos, editado por admin)
function getSetting(key, cb){
  db.get("SELECT value FROM settings WHERE key=?", [key], (err,row)=>{
    if (err) return cb(err);
    cb(null, row?.value || "");
  });
}
function setSetting(key, value, cb){
  db.run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value], cb);
}

app.get('/regras-data', authRequired, (req,res)=>{
  // Preferir texto único 'regras_texto'; manter compat com chaves antigas, combinando se necessário
  getSetting('regras_texto', (e0, texto)=>{
    if (!e0 && (texto||'').trim()) return res.json({ texto });
    // Fallback às chaves antigas
    getSetting('regras', (e1, regras)=>{
      getSetting('premio', (e2, premio)=>{
        const combinado = [premio && ("Objetivo: "+premio), regras].filter(Boolean).join("\n\n");
        return res.json({ texto: combinado });
      });
    });
  });
});

app.put('/regras-data', authRequired, adminRequired, (req,res)=>{
  const { texto, regras, premio } = req.body || {};
  const finalTexto = typeof texto !== 'undefined' ? String(texto||'') : [premio && ("Objetivo: "+premio), regras].filter(Boolean).join("\n\n");
  setSetting('regras_texto', finalTexto, (e)=>{
    if (e) return res.status(500).json({message:'Erro ao salvar regras'});
    res.json({message:'Regras atualizadas'});
  });
});

app.listen(PORT,'0.0.0.0',()=>{
  console.log("Servidor rodando porta",PORT);
});
