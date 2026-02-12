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
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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
  pontos = Number(pontos);

  if(!userId || isNaN(pontos)){
    return res.status(400).json({message:"Dados inválidos"});
  }

  db.run(
    "UPDATE users SET pontos = pontos + ? WHERE id=?",
    [pontos,userId],
    function(err){
      if(err){
        console.log(err);
        return res.status(500).json({message:"Erro ao atualizar"});
      }

      if(this.changes===0){
        return res.status(404).json({message:"Usuário não encontrado"});
      }

      db.run(
        "INSERT INTO historico (user_id,tipo,pontos,motivo) VALUES (?,?,?,?)",
        [userId, pontos>0?"ganhou":"perdeu", pontos, motivo||""]
      );

      db.get(
        "SELECT pontos FROM users WHERE id=?",
        [userId],
        (err,row)=>{
          res.json({
            message:"Pontos atualizados ⭐",
            pontos: row?.pontos || 0
          });
        }
      );
    }
  );
});

//
// 📜 HISTÓRICO
//
app.get("/historico/:id", authRequired, (req,res)=>{
  const id = req.params.id;
  if (!req.user.is_admin && Number(id) !== req.user.id) {
    return res.status(403).json({ message: 'Acesso restrito' });
  }

  db.all(
    "SELECT * FROM historico WHERE user_id=? ORDER BY id DESC",
    [id],
    (err,rows)=>{
      if(err) return res.send([]);
      res.send(rows);
    }
  );
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

app.listen(PORT,'0.0.0.0',()=>{
  console.log("Servidor rodando porta",PORT);
});
