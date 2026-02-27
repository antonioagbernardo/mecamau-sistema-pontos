'use strict';

// Garantia extra no client (servidor já protege rota)
async function ensureAdmin(){
  try {
    const res = await fetch('/me');
    if (!res.ok) { window.location.href='/'; return; }
    const me = await res.json();
    if (!me.is_admin) { window.location.href='/dashboard'; return; }
  } catch (e) {
    if (typeof showStatus === 'function') showStatus('Falha ao verificar sessão.');
  }
}
ensureAdmin();

let ALL_USERS = [];
let FILTERED = [];
const OPEN_EDIT = new Set();
const OPEN_HIST = new Set();

function aplicarFiltro(){
  const q = (document.getElementById('search')?.value || '').toLowerCase();
  FILTERED = !q ? ALL_USERS : ALL_USERS.filter(u => (u.nome||'').toLowerCase().includes(q));
  renderLista(FILTERED);
}

function renderLista(users){
  let html = '';
  const funcionarios = users.filter(u=>!u.is_admin);
  const admins = users.filter(u=>!!u.is_admin);

  // Funcionários
  funcionarios.forEach(u => {
    const pct = Math.max(0, Math.min(u.pontos || 0, 100));
    const color = (u.pontos||0) < 40 ? '#ef4444' : ((u.pontos||0) < 80 ? '#f59e0b' : '#10b981');
    html += `
    <div class="border p-4 rounded mb-3 bg-gray-50 min-w-0 break-words">
      <div class="flex flex-col sm:flex-row items-center gap-4">
        <img src="${u.foto?'/uploads/'+u.foto:'https://i.imgur.com/6VBx3io.png'}"
            class="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover flex-shrink-0"/>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <b class="truncate sm:whitespace-normal sm:overflow-visible">${u.nome}</b>
            ${u.is_admin ? '<span class="text-purple-600 text-xs bg-purple-100 px-2 py-0.5 rounded">ADMIN</span>' : ''}
          </div>
          <div class="text-sm text-gray-500">Pontos: <span id="pts_${u.id}">${u.pontos||0}</span></div>
          <div class="w-full bg-gray-200 rounded-full h-4 mt-1 overflow-hidden relative">
            <div id="bar_${u.id}" class="h-4 rounded-full transition-all duration-700 ease-out progress-animated" style="width:${pct}%; background-color:${color}"></div>
            <span id="bar_text_${u.id}" class="absolute inset-0 flex items-center justify-center text-[10px]">${u.pontos||0} pts</span>
          </div>
        </div>

        <div class="hidden sm:flex items-center gap-1 flex-shrink-0 self-center">
          <button onclick="toggleEdit(${u.id})" class="bg-blue-600 text-white px-3 py-1 rounded">Editar</button>
          <button onclick="removerUsuario(${u.id})" class="bg-gray-700 text-white px-3 py-1 rounded">Remover</button>
        </div>
      </div>

      ${u.is_admin ? '' : `
      <div class="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <input id="motivo_${u.id}" placeholder="Motivo (obrigatório)" class="border p-2 rounded w-full"/>
        <input id="valor_${u.id}" type="number" class="border p-2 rounded w-full" placeholder="ex: 15 ou -5"/>
        <button onclick="aplicarPontos(${u.id})" class="bg-green-600 text-white px-3 py-2 rounded w-full">Aplicar pontos</button>
      </div>
      `}

      <div class="sm:hidden flex gap-2 mt-3 flex-wrap">
        <button onclick="toggleEdit(${u.id})" class="flex-1 bg-blue-600 text-white px-3 py-2 rounded">Editar</button>
        <button onclick="removerUsuario(${u.id})" class="flex-1 bg-gray-700 text-white px-3 py-2 rounded">Remover</button>
      </div>

      <div class="mt-3">
        <button onclick="toggleHistorico(${u.id})" class="text-sm text-blue-700 hover:underline">Ver histórico</button>
        <div id="hist_${u.id}" class="${OPEN_HIST.has(u.id)?'':'hidden'} mt-2 text-sm"></div>
      </div>

      <div id="edit_${u.id}" class="mt-4 ${OPEN_EDIT.has(u.id)?'':'hidden'} border-t pt-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input id="ed_nome_${u.id}" class="border p-2 rounded" placeholder="Nome" value="${u.nome}"/>
          <input id="ed_login_${u.id}" class="border p-2 rounded" placeholder="Login"/>
          <input id="ed_senha_${u.id}" class="border p-2 rounded" placeholder="Nova senha (opcional)"/>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" id="ed_admin_${u.id}" ${u.is_admin? 'checked' : ''} /> É admin
          </label>
          <input type="file" id="ed_foto_${u.id}" class="border p-2 rounded"/>
        </div>
        <div class="flex gap-2 mt-3">
          <button onclick="salvarEdicao(${u.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">Salvar</button>
          <button onclick="removerUsuario(${u.id})" class="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded">Remover</button>
        </div>
      </div>
    </div>`;
  });
  document.getElementById('lista').innerHTML = `<h3 class="text-lg font-semibold mb-2">Funcionários (${funcionarios.length})</h3>` + (html || '<div class="text-gray-500">Nenhum funcionário encontrado</div>');

  // Administradores (apenas nomes, sem atribuição de pontos)
  let adminsHtml = '';
  admins.forEach(u=>{
    adminsHtml += `
      <div class="border p-4 rounded mb-3 bg-gray-50 min-w-0 break-words">
        <div class="flex items-center gap-3">
          <img src="${u.foto?'/uploads/'+u.foto:'https://i.imgur.com/6VBx3io.png'}" class="w-10 h-10 rounded-full object-cover"/>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <b class="truncate">${u.nome}</b>
              <span class="text-purple-600 text-xs bg-purple-100 px-2 py-0.5 rounded">ADMIN</span>
            </div>
          </div>
          <div class="hidden sm:flex items-center gap-1 flex-shrink-0 self-center">
            <button onclick="toggleEdit(${u.id})" class="bg-blue-600 text-white px-3 py-1 rounded">Editar</button>
            <button onclick="removerUsuario(${u.id})" class="bg-gray-700 text-white px-3 py-1 rounded">Remover</button>
          </div>
        </div>
        <div class="sm:hidden flex gap-2 mt-3 flex-wrap">
          <button onclick="toggleEdit(${u.id})" class="flex-1 bg-blue-600 text-white px-3 py-2 rounded">Editar</button>
          <button onclick="removerUsuario(${u.id})" class="flex-1 bg-gray-700 text-white px-3 py-2 rounded">Remover</button>
        </div>
        <div id="edit_${u.id}" class="mt-4 ${OPEN_EDIT.has(u.id)?'':'hidden'} border-t pt-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input id="ed_nome_${u.id}" class="border p-2 rounded" placeholder="Nome" value="${u.nome}"/>
            <input id="ed_login_${u.id}" class="border p-2 rounded" placeholder="Login"/>
            <input id="ed_senha_${u.id}" class="border p-2 rounded" placeholder="Nova senha (opcional)"/>
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" id="ed_admin_${u.id}" ${u.is_admin? 'checked' : ''} /> É admin
            </label>
            <input type="file" id="ed_foto_${u.id}" class="border p-2 rounded"/>
          </div>
          <div class="flex gap-2 mt-3">
            <button onclick="salvarEdicao(${u.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">Salvar</button>
            <button onclick="removerUsuario(${u.id})" class="bg-gray-700 hover:bg-gray-800 text-white px-4 py-2 rounded">Remover</button>
          </div>
        </div>
      </div>`
  });
  document.getElementById('adminsLista').innerHTML = `<h3 class="text-lg font-semibold mb-2">Administradores (${admins.length})</h3>` + (adminsHtml || '<div class="text-gray-500">Nenhum administrador</div>');
}

async function carregarUsuarios(manual=false){
  try {
    const res = await fetch('/usuarios');
    if (!res.ok) throw new Error('HTTP '+res.status);
    ALL_USERS = await res.json();
    if (typeof hideStatus === 'function') hideStatus();
    aplicarFiltro();
  } catch (e) {
    if (manual) console.error(e);
    if (typeof showStatus === 'function') showStatus('Falha ao carregar lista de usuários.');
  }
}

async function aplicarPontos(id){
  try {
    const motivo = document.getElementById('motivo_'+id).value;
    const valor = Number(document.getElementById('valor_'+id).value);
    const res = await fetch('/pontos',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userId:id,pontos:valor,motivo}) });
    const data = await res.json().catch(()=>({}));
    if(data.pontos !== undefined){
      document.getElementById('pts_'+id).innerText = data.pontos;
      const pct = Math.max(0, Math.min(data.pontos, 100));
      const bar = document.getElementById('bar_'+id);
      const barText = document.getElementById('bar_text_'+id);
      const color = data.pontos < 40 ? '#ef4444' : (data.pontos < 80 ? '#f59e0b' : '#10b981');
      if (bar) { bar.style.backgroundColor = color; requestAnimationFrame(()=>{ bar.style.width = pct + '%'; }); }
      if (barText) { const current = Number(barText.textContent.replace(/[^0-9]/g,'')) || 0; animateNumber(current, data.pontos, 600, (val)=>{ barText.textContent = Math.round(val) + ' pts'; }); }
    }
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = data.message || '';
  } catch (_) {
    if (typeof showStatus === 'function') showStatus('Falha ao atualizar pontos.');
  }
}

async function criarUser(){
  try {
    const form = new FormData();
    form.append('nome', document.getElementById('nome').value);
    form.append('login', document.getElementById('login').value);
    form.append('senha', document.getElementById('senha').value);
    const foto = document.getElementById('foto').files[0];
    if(foto) form.append('foto', foto);
    const res = await fetch('/criar-funcionario',{ method:'POST', body:form });
    const txt = await res.text();
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = txt;
    carregarUsuarios(true);
  } catch (_) {
    if (typeof showStatus === 'function') showStatus('Falha ao criar funcionário.');
  }
}

function toggleEdit(id){
  const el = document.getElementById('edit_'+id);
  if(!el) return;
  const willOpen = el.classList.contains('hidden');
  el.classList.toggle('hidden');
  if (willOpen) OPEN_EDIT.add(id); else OPEN_EDIT.delete(id);
}

async function salvarEdicao(id){
  try {
    const form = new FormData();
    const nome = document.getElementById('ed_nome_'+id)?.value;
    const login = document.getElementById('ed_login_'+id)?.value;
    const senha = document.getElementById('ed_senha_'+id)?.value;
    const isAdmin = document.getElementById('ed_admin_'+id)?.checked;
    const foto = document.getElementById('ed_foto_'+id)?.files?.[0];
    if (nome) form.append('nome', nome);
    if (login) form.append('login', login);
    if (senha) form.append('senha', senha);
    if (typeof isAdmin !== 'undefined') form.append('is_admin', isAdmin ? 1 : 0);
    if (foto) form.append('foto', foto);
    const res = await fetch(`/usuarios/${id}`, { method: 'PUT', body: form });
    const data = await res.json().catch(()=>({message:'Erro'}));
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = data.message || 'Atualizado';
    carregarUsuarios(true);
  } catch (_) {
    if (typeof showStatus === 'function') showStatus('Falha ao salvar edição.');
  }
}

// utilitário numérico (mesmo do dashboard)
function animateNumber(from, to, duration, onUpdate) {
  const start = performance.now();
  const diff = to - from;
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    onUpdate(from + diff * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function removerUsuario(id){
  if(!confirm('Remover este usuário? Esta ação não pode ser desfeita.')) return;
  try {
    const res = await fetch(`/usuarios/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(()=>({message:'Erro'}));
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = data.message || 'Removido';
    carregarUsuarios(true);
  } catch (_) {
    if (typeof showStatus === 'function') showStatus('Falha ao remover usuário.');
  }
}

async function criarAdmin(){
  try {
    const nome = document.getElementById('adminNome').value;
    const login = document.getElementById('adminLogin').value;
    const senha = document.getElementById('adminSenha').value;
    const res = await fetch('/criar-admin2',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({login,senha,nome}) });
    const txt = await res.text();
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = txt;
    carregarUsuarios(true);
  } catch (_) {
    if (typeof showStatus === 'function') showStatus('Falha ao criar admin.');
  }
}

// Histórico
async function renderHistoricoFor(id){
  const el = document.getElementById('hist_'+id);
  if (!el) return;
  try {
    const res = await fetch('/historico/'+id);
    const data = await res.json();
    let html = '';
    data.forEach(h=>{
      if (h.tipo === 'ciclo') {
        html += `<div class="flex items-center gap-2 my-2"><hr class="flex-1"><span class="text-xs text-gray-500 whitespace-nowrap">Novo ciclo</span><hr class="flex-1"></div>`;
      } else {
        const cor = h.pontos > 0 ? 'text-green-600' : 'text-red-500';
        const dt = h.data ? new Date(h.data).toLocaleString() : '';
        const editor = h.editor_nome ? `<span class="text-xs text-gray-400"> · por ${h.editor_nome}</span>` : '';
        html += `<div class="border-b pb-1">
          <div class="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
            <span class="text-gray-500">${dt}</span>
            <span class="${cor} font-bold">${h.pontos>0?'+':''}${h.pontos}</span>
            <span class="text-gray-600">${h.motivo || '-'}${editor}</span>
          </div>
        </div>`;
      }
    });
    el.innerHTML = html || '<div class="text-gray-500">Sem histórico</div>';
  } catch (_) {
    el.innerHTML = '<div class="text-red-600">Falha ao carregar histórico</div>';
  }
}

async function toggleHistorico(id){
  const el = document.getElementById('hist_'+id);
  if (!el) return;
  const willOpen = el.classList.contains('hidden');
  el.classList.toggle('hidden');
  if (willOpen) { OPEN_HIST.add(id); renderHistoricoFor(id); } else { OPEN_HIST.delete(id); }
}

// Inicialização
carregarUsuarios();
setInterval(()=>{
  carregarUsuarios(true).then(()=>{
    OPEN_HIST.forEach(id => renderHistoricoFor(id));
  });
}, 5000);

// Expor funções ao escopo global para os onClicks inline
window.aplicarFiltro = aplicarFiltro;
window.aplicarPontos = aplicarPontos;
window.criarUser = criarUser;
window.toggleEdit = toggleEdit;
window.salvarEdicao = salvarEdicao;
window.removerUsuario = removerUsuario;
window.criarAdmin = criarAdmin;
window.toggleHistorico = toggleHistorico;
window.resetAll = async function(){
  const valor = Number(document.getElementById('resetValor').value);
  const motivo = document.getElementById('resetMotivo').value;
  try {
    const res = await fetch('/pontos/reset_all', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({valor, motivo})});
    const data = await res.json().catch(()=>({}));
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = data.message || '';
    carregarUsuarios(true);
  } catch(_){ if (typeof showStatus === 'function') showStatus('Falha ao aplicar novo ciclo.'); }
};
window.bulkAdd = async function(){
  const delta = Number(document.getElementById('bulkDelta').value);
  const motivo = document.getElementById('bulkMotivo').value;
  try {
    const res = await fetch('/pontos/bulk_add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({delta, motivo})});
    const data = await res.json().catch(()=>({}));
    const msg = document.getElementById('msg');
    msg.className = res.ok ? 'mt-3 text-green-600 text-center text-sm' : 'mt-3 text-red-600 text-center text-sm';
    msg.innerText = data.message || '';
    carregarUsuarios(true);
  } catch(_){ if (typeof showStatus === 'function') showStatus('Falha ao aplicar ajuste em massa.'); }
};
