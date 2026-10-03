'use strict';

const $ = (s, r = document) => r.querySelector(s);
const CATS = ['Utilitários', 'Jogos', 'Produtividade', 'Design e arte', 'Educação', 'Outros'];
/* ===================== LIMITES E CONFIGURAÇÕES (edite aqui) =====================
   Ao mudar um limite, mude também o schema-v4.sql (valores em comentário lá). */
const PROJECT_LIMITS = {
  MAX_ASSETS_MB: 30,            // imagens + áudios + modelos 3D por projeto (HTML/CSS/JS NÃO contam)
  MAX_HTML_CHARACTERS: 400000,
  MAX_CSS_CHARACTERS: 200000,
  MAX_JS_CHARACTERS: 1000000
};
const STORAGE_BUCKET = 'projetos';   // bucket do Supabase Storage (criado no SQL)
// Formatos aceitos: extensão -> pasta dentro do projeto e tipo MIME. Para liberar outro, adicione aqui E no schema-v4.sql
const ASSET_TYPES = {
  avif: { dir: 'imagens', mime: 'image/avif' }, webp: { dir: 'imagens', mime: 'image/webp' },
  opus: { dir: 'audio', mime: 'audio/ogg' }, aac: { dir: 'audio', mime: 'audio/aac' },
  glb: { dir: 'modelos', mime: 'model/gltf-binary' }
};
const KIND = { imagens: 'imagem', audio: 'audio', modelos: 'modelo' };
// Onde ficam os arquivos: <bucket>/<id do projeto>/<caminho>. É também a base das referências relativas dos jogos.
const projectBase = (id) => CFG.SUPABASE_URL + '/storage/v1/object/public/' + STORAGE_BUCKET + '/' + id + '/';
const fileUrl = (id, path) => projectBase(id) + path;
// Downloads pedidos pelo jogo (Bancada.download): o site pergunta ao jogador antes de baixar
const DOWNLOAD = { MAX_MB: 30, EXT: ['mp3', 'wav', 'ogg', 'opus', 'aac', 'json', 'txt', 'png', 'webp', 'glb'] };
// Salas online (Bancada.joinRoom): limites por jogador, para não estourar o plano gratuito do Supabase Realtime
const ROOM_LIMITS = { MAX_MSG_CHARS: 4000, MIN_INTERVAL_MS: 40, MAX_ROOMS: 1 };   // 40 ms = no máximo 25 msg/s
// Capas e fotos de perfil: o navegador reduz e converte para WebP antes de enviar (mude também o schema-v5.sql se mudar o limite)
const IMAGE_BUCKET = 'imagens';
// ============================================================
// TAMANHO DA IMAGEM DAS CAPAS — EDITE AQUI
// COVER_W / COVER_H = resolução final gravada da capa.
// A aparência na tela inicial também é controlada por .cover no style.css.
// ============================================================
const IMAGE_LIMITS = { MAX_INPUT_MB: 2, COVER_W: 640, COVER_H: 360, AVATAR_PX: 256, QUALITY: 0.82 };
const CODE_FILES = [['index.html', 'code', 'text/plain'], ['style.css', 'css', 'text/css'], ['script.js', 'js', 'text/javascript']];
// Edite aqui as novidades do site (mais recente primeiro)
const NEWS = [
  { d: '2026-09-29', t: 'Perfis, forks e moderação', b: [
    'Agora cada usuário tem perfil.',
    'Todo jogo tem página própria com forks.',
    'Segurança contra scripts maliciosos.',
    'Layout refeito totalmente do zero.',
    'Opção de criar forks sobre jogos já existentes.',
    'Opção de jogar em tela cheia.',
    'Aba de [Documentação](#/docs).',
    'Aba de [Sobre nós](#/sobre).',
    'Moderação ativa.',
    'Suporte a records e rankings. (veja a [Documentação](#/docs) para saber como implementar)'
  ] }
];
const ABOUT = 'A Bancada é a vitrine de apps e jogos em HTML da turma. Todo mundo pode jogar e ler o código; só o autor (ou a moderação) altera um projeto. Quer melhorar o jogo de alguém? Crie um fork.';
const CFG = window.CONFIG || {};
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.startsWith('COLE_') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.startsWith('COLE_');
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

// Cria elementos sem innerHTML: todo texto entra como texto puro (evita XSS)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const state = { me: null, list: null, cat: 'Todos', q: '' };
let nav = 0, toastTimer, cleanup = null;
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR');
const emailOf = (u) => u.toLowerCase() + '@' + CFG.EMAIL_DOMAIN;
const isStaff = () => !!state.me && !state.me.banned && ['owner', 'moderator'].includes(state.me.role);
const canSeeProject = (p) => !!p && (p.is_public !== false || (state.me && !state.me.banned && (state.me.id === p.user_id || isStaff())));
const privacyLabel = (p) => p.is_public === false ? 'Privado' : 'Público';

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function friendly(err) {
  const m = (err && err.message) || '';
  if (/invalid login credentials/i.test(m)) return 'Usuário ou senha incorretos.';
  if (/already registered|already been registered/i.test(m)) return 'Esse nome de usuário já existe.';
  if (/database error saving new user/i.test(m)) return 'Esse nome de usuário não pôde ser criado (já existe ou é inválido).';
  if (/rate limit|too many/i.test(m)) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/jwt|not authenticated/i.test(m)) return 'Sua sessão expirou. Entre de novo.';
  if (/failed to fetch|network/i.test(m)) return 'Sem conexão com o servidor. Tente de novo.';
  if (/permission denied|row-level security/i.test(m)) return 'Sem permissão. Rode o schema-bancada-completo.sql e entre novamente na sua conta.';
  if (/exceeded|too large|payload/i.test(m)) return 'Arquivo grande demais.';
  if (/check constraint|violates/i.test(m)) return 'Algum campo está fora do limite permitido.';
  return m || 'Algo deu errado. Tente de novo.';
}
const isAuthErr = (e) => e && (e.status === 401 || /jwt|not authenticated/i.test(e.message || ''));

/* ---------- Dados ---------- */
async function loadList(force) {
  if (state.list && !force) return state.list;
  const { data, error } = await sb.from('projects')
    .select('id, title, description, category, updated_at, user_id, forked_from, cover_at, is_public, profiles!user_id(username)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (state.list = data.map((p) => ({ ...p, author: p.profiles ? p.profiles.username : '?' })));
}

async function loadMe(session) {
  if (!session) { state.me = null; return; }
  const uid = session.user.id;
  const get = () => sb.from('profiles').select('id, username, role, banned, avatar_at').eq('id', uid).maybeSingle();
  let { data, error } = await get();
  if (error) throw error;
  if (!data) {
    const username = session.user.user_metadata && session.user.user_metadata.username;
    if (username) {
      const ins = await sb.from('profiles').insert({ id: uid, username });
      if (ins.error && ins.error.code !== '23505') throw ins.error;
      ({ data, error } = await get());
      if (error) throw error;
    }
  }
  state.me = data || null;
}

/* ---------- Sessão ---------- */
function renderSession() {
  const box = $('#session');
  box.replaceChildren();
  $('#modLink').hidden = !isStaff();
  if (state.me) {
    box.append(
      h('a', { class: 'btn ghost', href: '#/u/' + encodeURIComponent(state.me.username) }, avatarUrl(state.me) ? h('img', { class: 'mini', src: avatarUrl(state.me), alt: '' }) : null, '@' + state.me.username),
      state.me.banned ? h('span', { class: 'tag ban' }, 'Conta banida') : h('a', { class: 'btn solid', href: '#/novo' }, 'Novo projeto'),
      h('button', { class: 'btn ghost', onclick: logout }, 'Sair'));
  } else {
    box.append(
      h('button', { class: 'btn', onclick: () => openAuth('login') }, 'Entrar'),
      h('button', { class: 'btn solid', onclick: () => openAuth('register') }, 'Criar conta'));
  }
}

async function logout() {
  await sb.auth.signOut();
  state.me = null;
  renderSession();
  toast('Você saiu da conta.');
  route();
}

function requireLogin() {
  state.me = null;
  renderSession();
  openAuth('login', 'Sua sessão expirou. Entre de novo.');
}

/* ---------- Diálogos ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

let authMode = 'login';
function openAuth(mode, hint = '') {
  authMode = mode;
  const reg = mode === 'register';
  const f = $('#authForm');
  $('#authTitle').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#authSubmit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#authSwitch').textContent = reg ? 'Já tenho conta' : 'Quero criar uma conta';
  f.password.autocomplete = reg ? 'new-password' : 'current-password';
  $('#authHint').textContent = hint || (reg ? 'Usuário: 3 a 20 letras, números ou _. Senha: mínimo de 8 caracteres. Não há recuperação por e-mail.' : '');
  $('#authError').textContent = '';
  f.password.value = '';
  if (!$('#authDlg').open) $('#authDlg').showModal();
  f.username.focus();
}
$('#authSwitch').addEventListener('click', () => openAuth(authMode === 'login' ? 'register' : 'login'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, username = f.username.value.trim(), password = f.password.value, btn = $('#authSubmit');
  btn.disabled = true;
  try {
    let res;
    if (authMode === 'register') {
      res = await sb.auth.signUp({ email: emailOf(username), password, options: { data: { username } } });
      if (!res.error && !res.data.session) throw new Error('Cadastro criado, mas o projeto exige confirmação por e-mail. Desative "Confirm email" no Supabase.');
    } else {
      res = await sb.auth.signInWithPassword({ email: emailOf(username), password });
    }
    if (res.error) throw res.error;
    await loadMe(res.data.session);
    if (!state.me) throw new Error('Não foi possível carregar o perfil. Tente entrar de novo.');
    f.reset();
    $('#authDlg').close();
    renderSession();
    toast(authMode === 'login' ? 'Bem-vindo, ' + state.me.username + '!' : 'Conta criada!');
    route();
  } catch (err) {
    $('#authError').textContent = friendly(err);
  } finally { btn.disabled = false; }
});

/* ---------- Componentes ---------- */
const userLink = (name) => h('a', { href: '#/u/' + encodeURIComponent(name) }, '@' + name);

function card(p) {
  return h('li', { class: 'card' },
    coverUrl(p) ? h('img', { class: 'cover', src: coverUrl(p), alt: '', loading: 'lazy', decoding: 'async', width: '640', height: '360' }) : null,
    h('h3', {}, h('a', { href: '#/p/' + p.id }, p.title)),
    h('p', {}, p.description),
    h('div', { class: 'meta' },
      h('span', { class: 'tag' }, p.category),
      p.is_public === false ? h('span', { class: 'tag private' }, 'Privado') : null,
      p.forked_from ? h('span', { class: 'tag fork' }, 'Fork') : null,
      userLink(p.author),
      h('span', {}, fmtDate(p.updated_at))));
}

async function rpc(fn, args, ok) {
  const { error } = await sb.rpc(fn, args);
  if (error) { if (isAuthErr(error)) requireLogin(); else toast(friendly(error)); return false; }
  toast(ok);
  return true;
}

// Botões de moderação sobre um usuário u ({id, username, role, banned})
function userActions(u, after) {
  const me = state.me;
  if (!isStaff() || u.id === me.id || u.role === 'owner' || (u.role === 'moderator' && me.role !== 'owner')) return null;
  const run = async (fn, args, msg) => { if (await rpc(fn, args, msg)) after(); };
  return h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => run('set_ban', { target: u.id, flag: !u.banned }, u.banned ? 'Conta reativada.' : 'Conta banida.') }, u.banned ? 'Reativar' : 'Banir'),
    h('button', { class: 'btn danger', onclick: () => { if (confirm('Excluir a conta @' + u.username + ' e todos os projetos dela?')) run('delete_user', { target: u.id }, 'Conta excluída.'); } }, 'Excluir conta'),
    me.role === 'owner' ? h('button', { class: 'btn', onclick: () => run('set_role', { target: u.id, new_role: u.role === 'moderator' ? 'user' : 'moderator' }, 'Cargo atualizado.') }, u.role === 'moderator' ? 'Remover moderador' : 'Tornar moderador') : null);
}

const roleTag = (u) => [
  u.role === 'owner' ? h('span', { class: 'tag role' }, 'Dono') : u.role === 'moderator' ? h('span', { class: 'tag role' }, 'Moderador') : null,
  u.banned ? h('span', { class: 'tag ban' }, 'Banido') : null];

/* ---------- SDK de ranking (injetado em todo jogo) ---------- */
// O jogo fala com o site por postMessage; só o site (pai) conversa com o banco, usando o login do jogador.
const SDK = `<script>(()=>{const p=new Map(),R=new Map();let n=0;addEventListener('message',e=>{const m=e.data;if(e.source!==parent||!m||m.bancada!==1)return;if(m.event){const r=R.get(m.room);if(!r)return;if(m.kind==='presence'){r.last=m.players;r.p.forEach(f=>f(m.players))}else r.m.forEach(f=>f(m.data,m.from));return}const r=p.get(m.id);if(!r)return;p.delete(m.id);m.error?r.reject(new Error(m.error)):r.resolve(m)});const call=(type,d,t=8000)=>new Promise((res,rej)=>{const id=++n;p.set(id,{resolve:res,reject:rej});parent.postMessage({bancada:1,id,type,...d},'*');setTimeout(()=>{if(p.delete(id))rej(new Error('Tempo esgotado'))},t)});window.Bancada={submitScore:s=>call('score',{score:s}).then(r=>r.best),getRanking:k=>call('ranking',{limit:k}).then(r=>r.ranking),getUser:()=>call('user').then(r=>r.username),download:(name,data)=>call('download',{name,data},120000).then(()=>true),joinRoom:async room=>{room=String(room).replace(/[^\\w-]/g,'').slice(0,40);const r=await call('join',{room},15000),o={m:[],p:[],last:null};R.set(room,o);return{id:r.me,name:r.name,send:d=>parent.postMessage({bancada:1,type:'send',room,data:d},'*'),onMessage:f=>o.m.push(f),onPresence:f=>{o.p.push(f);if(o.last)f(o.last)},leave:()=>{R.delete(room);parent.postMessage({bancada:1,type:'leave',room},'*')}}}}})()<\/script>`;
const withSdk = (code, extra = '') => /<(?:head|html)[^>]*>/i.test(code) ? code.replace(/<(?:head|html)[^>]*>/i, (m) => m + extra + SDK) : extra + SDK + code;

/* ---------- Imagens (capas e fotos) e denúncias ---------- */
const imgUrl = (path, v) => CFG.SUPABASE_URL + '/storage/v1/object/public/' + IMAGE_BUCKET + '/' + path + '.webp?v=' + Date.parse(v);
const coverUrl = (p) => (p.cover_at ? imgUrl('capas/' + p.id, p.cover_at) : null);
const avatarUrl = (u) => (u.avatar_at ? imgUrl('avatares/' + u.id, u.avatar_at) : null);

// Reduz e recorta (centro) no navegador e converte para WebP: a imagem enviada fica com poucos KB
async function resizeImage(file, w, hh) {
  if (!/^image\/(png|jpe?g|webp|avif|gif)$/.test(file.type)) throw new Error('Use uma imagem PNG, JPG, WEBP, AVIF ou GIF.');
  if (file.size > IMAGE_LIMITS.MAX_INPUT_MB * 1048576) throw new Error('A imagem passa de ' + IMAGE_LIMITS.MAX_INPUT_MB + ' MB.');
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const k = Math.max(w / bmp.width, hh / bmp.height);
  c.getContext('2d').drawImage(bmp, (w - bmp.width * k) / 2, (hh - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
  bmp.close();
  const blob = await new Promise((r) => c.toBlob(r, 'image/webp', IMAGE_LIMITS.QUALITY));
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  return blob;
}
async function uploadImage(path, blob) {
  const { error } = await sb.storage.from(IMAGE_BUCKET).upload(path + '.webp', blob, { contentType: 'image/webp', upsert: true });
  if (error) throw error;
}

async function report(kind, id) {
  if (!state.me) return openAuth('login', 'Entre para denunciar.');
  const reason = (prompt('Descreva o motivo da denúncia (mínimo 3 caracteres):') || '').trim().slice(0, 500);
  if (reason.length < 3) return;
  const { error } = await sb.from('reports').insert({ [kind === 'project' ? 'project_id' : 'profile_id']: id, reason });
  toast(error ? (error.code === '23505' ? 'Você já denunciou isto.' : friendly(error)) : 'Denúncia enviada. Obrigado!');
}

// Foto e denúncia no perfil de u
function profileTools(u) {
  const mine = !!state.me && state.me.id === u.id && !state.me.banned;
  const change = async (file) => {
    try {
      await uploadImage('avatares/' + u.id, await resizeImage(file, IMAGE_LIMITS.AVATAR_PX, IMAGE_LIMITS.AVATAR_PX));
      const { error } = await sb.rpc('set_avatar', { flag: true });
      if (error) throw error;
      state.me.avatar_at = new Date().toISOString();
      renderSession(); toast('Foto atualizada.'); route();
    } catch (err) { toast(friendly(err)); }
  };
  const remove = async () => {
    const { error } = await sb.rpc('set_avatar', { flag: false, target: mine ? null : u.id });
    if (error) return toast(friendly(error));
    await sb.storage.from(IMAGE_BUCKET).remove(['avatares/' + u.id + '.webp']);
    if (mine) { state.me.avatar_at = null; renderSession(); }
    toast('Foto removida.'); route();
  };
  return h('div', { class: 'actions' },
    mine ? h('label', { class: 'btn' }, 'Trocar foto',
      h('input', { type: 'file', accept: 'image/*', hidden: '', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) change(f); } })) : null,
    u.avatar_at && (mine || isStaff()) ? h('button', { class: 'btn danger', onclick: remove }, 'Remover foto') : null,
    !mine ? h('button', { class: 'btn', onclick: () => report('profile', u.id) }, 'Denunciar') : null);
}

/* ---------- Páginas ---------- */
async function showHome(my) {
  const list = await loadList();
  if (my !== nav) return;
  const grid = h('ul', { class: 'grid' });
  const chips = h('div', { class: 'chips' });
  const draw = () => {
    const q = state.q.trim().toLowerCase();
    chips.replaceChildren(...['Todos', ...CATS, 'Forks'].map((c) =>
      h('button', { class: 'chip', 'aria-pressed': String(c === state.cat), onclick: () => { state.cat = c; draw(); } }, c)));
    const r = list.filter((p) =>
      (state.cat === 'Forks' ? p.forked_from : !p.forked_from && (state.cat === 'Todos' || p.category === state.cat)) &&
      (!q || [p.title, p.description, p.author].some((s) => s.toLowerCase().includes(q))));
    grid.replaceChildren(...(r.length ? r.map(card) : [h('li', { class: 'empty' }, list.length ? 'Nada bate com a busca.' : 'Ainda não há projetos. Publique o primeiro!')]));
  };
  $('#view').replaceChildren(
    h('section', { class: 'hero' },
      h('h1', {}, 'Jogue, leia, faça fork.'),
      h('p', {}, 'Apps e jogos em HTML feitos pela turma. Clique e jogue em tela cheia.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn solid', href: '#/novidades' }, "What's new"),
        h('a', { class: 'btn', href: '#/sobre' }, 'Sobre nós'),
        h('a', { class: 'btn', href: '#/docs' }, 'Documentação'))),
    h('div', { class: 'tools' }, h('input', {
      type: 'search', placeholder: 'Buscar por título, autor ou descrição', 'aria-label': 'Buscar', value: state.q,
      oninput: (e) => { state.q = e.target.value; draw(); }
    })),
    chips, grid);
  draw();
}

function showNews() {
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, "What's new"),
    ...NEWS.map((n) => h('article', {}, h('time', {}, fmtDate(n.d)), h('h2', {}, n.t), (Array.isArray(n.b) ? h('ol', {}, n.b.map((i) => h('li', {}, rich(i)))) : h('p', {}, rich(n.b)))))));
}
function showAbout() {
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Sobre nós'), h('p', {}, rich(ABOUT))));
}

async function showProfile(name, my) {
  const { data: u, error } = await sb.from('profiles').select('id, username, role, banned, created_at, avatar_at').eq('username', name).maybeSingle();
  if (error) throw error;
  const list = await loadList();
  if (my !== nav) return;
  if (!u) { $('#view').replaceChildren(h('p', { class: 'empty' }, 'Usuário não encontrado.')); return; }
  const mine = list.filter((p) => p.user_id === u.id);
  $('#view').replaceChildren(
    h('div', { class: 'phead' },
      avatarUrl(u) ? h('img', { class: 'avatar', src: avatarUrl(u), alt: 'Foto de ' + u.username }) : h('div', { class: 'avatar', 'aria-hidden': 'true' }, u.username[0].toUpperCase()),
      h('div', {}, h('h1', {}, '@' + u.username),
        h('div', { class: 'meta' }, roleTag(u), h('span', {}, 'Membro desde ' + fmtDate(u.created_at)), h('span', {}, mine.length + ' projeto(s)')))),
    profileTools(u),
    userActions(u, () => { state.list = null; route(); }),
    h('ul', { class: 'grid' }, mine.length ? mine.map(card) : [h('li', { class: 'empty' }, 'Nenhum projeto publicado.')]));
}

async function showProject(id, my) {
  const [{ data: p, error }, list, { data: assets }] = await Promise.all([
    sb.from('projects').select('id, title, description, category, code, css, js, updated_at, user_id, forked_from, cover_at, is_public, profiles!user_id(username)').eq('id', id).maybeSingle(),
    loadList(),
    sb.from('assets').select('path, kind, size').eq('project_id', id).order('path')
  ]);
  if (error) throw error;
  if (my !== nav) return;
  if (!p) { $('#view').replaceChildren(h('a', { href: '#/' }, '← Bancada'), h('p', { class: 'empty' }, 'Projeto não encontrado ou privado.')); return; }
  if (!canSeeProject(p)) { $('#view').replaceChildren(h('a', { href: '#/' }, '← Bancada'), h('p', { class: 'empty' }, 'Este projeto é privado. Apenas o autor e a administração podem vê-lo.')); return; }
  const author = p.profiles ? p.profiles.username : '?';
  const projFiles = [...CODE_FILES.filter(([, col]) => p[col]).map(([path, col]) => ({ path, kind: 'codigo', size: new Blob([p[col]]).size })), ...(assets || [])];
  const canEdit = state.me && !state.me.banned && (state.me.id === p.user_id || isStaff());
  const parent = p.forked_from && list.find((x) => x.id === p.forked_from);
  const forks = list.filter((x) => x.forked_from === p.id);
  document.body.classList.add('imm');
  document.title = p.title + ' – Bancada';

  // Sandbox SEM allow-same-origin: o jogo roda numa origem isolada, sem acesso à sessão, cookies ou DOM do site
  const frame = h('iframe', {
    sandbox: 'allow-scripts allow-pointer-lock allow-modals allow-forms', allow: 'fullscreen; gamepad; autoplay',
    allowfullscreen: '', title: p.title, referrerpolicy: 'no-referrer', loading: 'eager'
  });
  frame.srcdoc = buildDoc(p);
  const stage = h('div', { class: 'stage' }, frame);

  const loadRank = async () => {
    const { data, error: er } = await sb.from('scores').select('score, profiles!user_id(username)')
      .eq('project_id', p.id).order('score', { ascending: false }).order('updated_at').limit(100);
    if (er) throw er;
    return data;
  };
  let last = 0, lastDl = 0, lastSend = 0;
  const rooms = new Map();
  const onMsg = async (e) => {
    const m = e.data;
    if (e.source !== frame.contentWindow || !m || m.bancada !== 1) return;
    const reply = (d) => frame.contentWindow && frame.contentWindow.postMessage({ bancada: 1, id: m.id, ...d }, '*');
    try {
      if (m.type === 'user') return reply({ username: state.me ? state.me.username : null });
      if (m.type === 'ranking') {
        const r = await loadRank();
        return reply({ ranking: r.slice(0, Math.min(100, Math.max(1, Number(m.limit) || 20))).map((s) => ({ username: s.profiles ? s.profiles.username : '?', score: Number(s.score) })) });
      }
      if (m.type === 'download') {
        const d = m.data, ext = String(m.name || '').split('.').pop().toLowerCase();
        const okType = typeof d === 'string' || d instanceof Blob || d instanceof ArrayBuffer || ArrayBuffer.isView(d);
        const size = !okType ? 0 : typeof d === 'string' ? new Blob([d]).size : (d.size || d.byteLength);
        if (!okType || !size || !DOWNLOAD.EXT.includes(ext)) return reply({ error: 'Arquivo não permitido. Extensões: ' + DOWNLOAD.EXT.join(', ') + '.' });
        if (size > DOWNLOAD.MAX_MB * 1048576) return reply({ error: 'Arquivo grande demais (máximo ' + DOWNLOAD.MAX_MB + ' MB).' });
        if (Date.now() - lastDl < 2000) return reply({ error: 'Muitos downloads seguidos.' });
        lastDl = Date.now();
        const name = String(m.name).replace(/[^\w.-]/g, '-').slice(-80);
        if (!confirm('O jogo "' + p.title + '" quer baixar "' + name + '" (' + mb(size) + '). Baixar?')) return reply({ error: 'Download cancelado.' });
        const url = URL.createObjectURL(new Blob([d], { type: 'application/octet-stream' }));
        const a = h('a', { href: url, download: name });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return reply({ ok: true });
      }
      if (m.type === 'join') {
        const name = String(m.room || '').replace(/[^\w-]/g, '').slice(0, 40);
        if (!name) return reply({ error: 'Nome de sala inválido.' });
        if (!state.me) { toast('Entre na sua conta para jogar online.'); return reply({ error: 'Não está logado.' }); }
        if (rooms.has(name) || rooms.size >= ROOM_LIMITS.MAX_ROOMS) return reply({ error: 'Só é possível estar em ' + ROOM_LIMITS.MAX_ROOMS + ' sala por vez.' });
        const me = { id: crypto.randomUUID().slice(0, 8), name: state.me.username };
        const ch = sb.channel('bancada:' + p.id + ':' + name, { config: { broadcast: { self: false }, presence: { key: me.id } } });
        const push = (d) => frame.contentWindow && frame.contentWindow.postMessage({ bancada: 1, event: true, room: name, ...d }, '*');
        ch.on('broadcast', { event: 'm' }, ({ payload }) => push({ kind: 'message', from: payload.f, data: payload.d }));
        ch.on('presence', { event: 'sync' }, () => push({ kind: 'presence', players: Object.entries(ch.presenceState()).map(([id, v]) => ({ id, name: v[0].name })) }));
        rooms.set(name, { ch, me });
        let answered = false;
        ch.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') { await ch.track({ name: me.name }); if (!answered) { answered = true; reply({ me: me.id, name: me.name }); } }
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && !answered) { answered = true; rooms.delete(name); sb.removeChannel(ch); reply({ error: 'Não foi possível entrar na sala.' }); }
        });
        return;
      }
      if (m.type === 'send') {
        const r = rooms.get(String(m.room));
        if (!r || Date.now() - lastSend < ROOM_LIMITS.MIN_INTERVAL_MS) return;
        lastSend = Date.now();
        const txt = JSON.stringify(m.data);
        if (txt === undefined || txt.length > ROOM_LIMITS.MAX_MSG_CHARS) return;
        r.ch.send({ type: 'broadcast', event: 'm', payload: { f: r.me, d: JSON.parse(txt) } });   // 'f' (quem enviou) é colocado pelo site: não dá para falsificar
        return;
      }
      if (m.type === 'leave') {
        const r = rooms.get(String(m.room));
        if (r) { rooms.delete(String(m.room)); sb.removeChannel(r.ch); }
        return;
      }
      if (m.type === 'score') {
        const s = Number(m.score);
        if (!Number.isFinite(s) || s < 0) return reply({ error: 'Pontuação inválida.' });
        if (!state.me) { toast('Entre na sua conta para entrar no ranking.'); return reply({ error: 'Não está logado.' }); }
        if (Date.now() - last < 1000) return reply({ error: 'Muitos envios seguidos.' });
        last = Date.now();
        const { data, error: er } = await sb.rpc('submit_score', { p_project: p.id, p_score: s });
        if (er) throw er;
        return reply({ best: Number(data) });
      }
    } catch (err) { reply({ error: friendly(err) }); }
  };
  addEventListener('message', onMsg);
  cleanup = () => { removeEventListener('message', onMsg); rooms.forEach((r) => sb.removeChannel(r.ch)); rooms.clear(); };

  const fork = () => (state.me ? (location.hash = '#/novo/' + p.id) : openAuth('login', 'Entre para criar um fork.'));
  const remove = async () => {
    if (!confirm('Excluir "' + p.title + '"? Isso não pode ser desfeito.')) return;
    const { data: del, error: err } = await sb.from('projects').delete().eq('id', p.id).select('id');
    if (err) { if (isAuthErr(err)) requireLogin(); else toast(friendly(err)); return; }
    if (!del.length) return toast('Sem permissão para apagar este projeto.');
    sb.storage.from(STORAGE_BUCKET).remove(projFiles.map((x) => p.id + '/' + x.path));
    if (p.cover_at) sb.storage.from(IMAGE_BUCKET).remove(['capas/' + p.id + '.webp']);
    state.list = null;
    toast('Projeto excluído.');
    location.hash = '#/';
  };

  $('#view').replaceChildren(
    h('div', { class: 'player' },
      h('div', { class: 'pbar' },
        h('a', { class: 'btn ghost', href: '#/' }, '← Bancada'),
        h('strong', {}, p.title),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: fork }, 'Criar fork'),
        h('button', { class: 'btn solid', onclick: () => (stage.requestFullscreen ? stage.requestFullscreen() : toast('Seu navegador não suporta tela cheia.')) }, 'Tela cheia'),
        h('a', { class: 'btn ghost', href: '#details', onclick: (e) => { e.preventDefault(); $('#details').scrollIntoView({ behavior: 'smooth' }); } }, 'Detalhes ↓')),
      stage),
    h('section', { class: 'details', id: 'details' },
      h('h1', {}, p.title),
      h('div', { class: 'meta' },
        h('span', { class: 'tag' }, p.category),
        p.is_public === false ? h('span', { class: 'tag private' }, 'Privado') : null,
        parent ? h('span', { class: 'tag fork' }, 'Fork') : null,
        userLink(author),
        h('span', {}, 'atualizado em ' + fmtDate(p.updated_at)),
        parent ? h('a', { href: '#/p/' + parent.id }, 'baseado em ' + parent.title) : null),
      h('p', {}, p.description),
      h('p', { class: 'hint' }, 'Este projeto roda isolado (sandbox) e não acessa sua conta.'),
      !(state.me && state.me.id === p.user_id) ? h('button', { class: 'btn', onclick: () => report('project', p.id) }, 'Denunciar') : null,
      canEdit ? h('div', { class: 'actions' },
        h('a', { class: 'btn', href: '#/editar/' + p.id }, 'Editar'),
        h('button', { class: 'btn danger', onclick: remove }, 'Excluir')) : null,
      h('details', {}, h('summary', {}, 'Código'),
        [['HTML', p.code], ['CSS', p.css], ['JavaScript', p.js]].filter(([, t]) => t).map(([n, t]) => h('div', {},
          h('h3', {}, n), h('div', { class: 'codebox' }, h('pre', {}, t)), h('button', { class: 'btn', onclick: () => copyText(t) }, 'Copiar ' + n)))),
      h('details', {}, h('summary', {}, 'Arquivos do projeto (referências e URLs)'),
        projFiles.length ? projFiles.map((x) => fileRow(x, p.id)) : h('p', { class: 'hint' }, 'Este projeto não tem arquivos.')),
      h('h2', {}, 'Forks (' + forks.length + ')'),
      h('ul', { class: 'grid' }, forks.length ? forks.map(card) : [h('li', { class: 'empty' }, 'Ninguém fez fork ainda. Seja o primeiro!')])));
}

async function showMod(my) {
  if (!isStaff()) { location.hash = '#/'; return; }
  const [{ data: users, error }, list, { data: reps }] = await Promise.all([
    sb.from('profiles').select('id, username, role, banned').order('username'), loadList(),
    sb.from('reports').select('id, reason, created_at, project_id, profile_id, project:projects!project_id(title), target:profiles!profile_id(username), reporter:profiles!reporter_id(username)')
      .eq('status', 'open').order('created_at', { ascending: false }).limit(100)]);
  if (error) throw error;
  if (my !== nav) return;
  const refresh = () => { state.list = null; route(); };
  const owner = state.me.role === 'owner';
  const close = async (r, status) => {
    const { error: er } = await sb.from('reports').update({ status }).eq('id', r.id);
    if (er) toast(friendly(er)); else { toast('Denúncia ' + (status === 'resolved' ? 'resolvida.' : 'descartada.')); refresh(); }
  };
  const repList = h('div', {}, (reps || []).length ? reps.map((r) => h('article', {},
    h('h3', {}, r.project_id ? h('a', { href: '#/p/' + r.project_id }, 'Jogo: ' + (r.project ? r.project.title : '(apagado)'))
      : h('a', { href: '#/u/' + encodeURIComponent(r.target ? r.target.username : '') }, 'Perfil: @' + (r.target ? r.target.username : '?'))),
    h('p', {}, r.reason),
    h('p', { class: 'hint' }, 'por @' + (r.reporter ? r.reporter.username : '?') + ' · ' + fmtDate(r.created_at)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => close(r, 'resolved') }, 'Resolvida'),
      h('button', { class: 'btn ghost', onclick: () => close(r, 'dismissed') }, 'Descartar')))) : [h('p', { class: 'hint' }, 'Nenhuma denúncia aberta.')]);
  const input = h('input', { placeholder: 'Nome de usuário', maxlength: '20', 'aria-label': 'Novo moderador' });
  const add = async () => {
    const u = users.find((x) => x.username.toLowerCase() === input.value.trim().toLowerCase());
    if (!u) return toast('Usuário não encontrado.');
    if (await rpc('set_role', { target: u.id, new_role: 'moderator' }, '@' + u.username + ' agora é moderador.')) refresh();
  };
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Moderação'),
    owner ? h('div', { class: 'inline' }, input, h('button', { class: 'btn solid', onclick: add }, 'Adicionar moderador')) : null,
    h('p', { class: 'hint' }, 'Para excluir ou editar jogos, abra a página do jogo. Aqui você gerencia contas.'),
    h('h2', {}, 'Denúncias abertas (' + (reps || []).length + ')'), repList, h('h2', {}, 'Contas'),
    h('table', { class: 'users' }, h('tbody', {}, users.map((u) => h('tr', {},
      h('td', {}, userLink(u.username), ' ', roleTag(u), h('div', { class: 'hint' }, list.filter((p) => p.user_id === u.id).length + ' projeto(s)')),
      h('td', {}, userActions(u, refresh))))))));
}

/* ---------- Documentação ---------- */
// Para adicionar conteúdo, crie outra seção aqui. Blocos: ['p', texto] ['h3', texto] ['ul', [itens]] ['code', código].
// Use `crases` dentro dos textos para destacar código.
const DOCS = [
  { id: 'ranking', title: 'Ranking e pontuação', blocks: [
    ['p', "Na Bancada o jogo roda isolado por segurança, então o `localStorage` não guarda nada de forma permanente. Para o ranking valer para todo mundo, use o objeto `Bancada`, que o site cria sozinho dentro do seu jogo. Não precisa instalar nem importar nada."],
    ['h3', 'As 3 funções'],
    ['ul', [
      "`await Bancada.getUser()`: devolve o nome de quem está jogando, ou `null` se não estiver logado.",
      "`await Bancada.submitScore(pontos)`: envia a pontuação e devolve a melhor pontuação dessa pessoa.",
      "`await Bancada.getRanking(20)`: devolve o top 20 como `[{username, score}]`, do maior para o menor."]],
    ['h3', 'Exemplo'],
    ['code', `const online = typeof Bancada !== 'undefined';    // false se abrir o arquivo fora da Bancada

// 1) Quando a partida terminar, envie a pontuação
async function fimDeJogo(pontos) {
  if (online) {
    try {
      const nome = await Bancada.getUser();
      if (!nome) aviso('Entre na sua conta para entrar no ranking.');
      else await Bancada.submitScore(pontos);
    } catch (e) { console.warn(e.message); }
  }
  await desenharRanking();
}

// 2) Para mostrar o ranking
async function desenharRanking() {
  const lista = online ? await Bancada.getRanking(10) : [];
  // desenhe com textContent (nunca innerHTML)
  // lista[0].username, lista[0].score ...
}`],
    ['h3', 'Regras'],
    ['ul', [
      "Só entra no ranking quem está logado.",
      "A pontuação é um número maior ou igual a 0, e o maior valor ganha. Cada jogador guarda só a melhor.",
      "Envie no fim da partida, não a cada ponto. O limite é 1 envio por segundo.",
      "O ranking é por jogo. Um fork começa com o ranking vazio.",
      "Só funciona dentro da Bancada. Fora dela o `Bancada` não existe, por isso a checagem `online`.",
      "Ao mostrar nomes de jogadores, use `textContent`, nunca `innerHTML`."]],
    ['h3', 'Peça para a sua IA'],
    ['p', "Se você faz o jogo com ajuda de uma IA, cole este pedido junto com o código:"],
    ['code', `Ajuste este jogo para usar o ranking online da Bancada. Apague o ranking em localStorage. Use typeof Bancada !== 'undefined' para checar se está na Bancada. No fim da partida, chame await Bancada.submitScore(pontos), só se await Bancada.getUser() não for null. Para mostrar o ranking, use await Bancada.getRanking(10), que devolve [{username, score}] do maior para o menor. Desenhe os nomes com textContent, nunca innerHTML.`]
  ] },
  { id: 'limites', title: 'O que o jogo pode fazer', blocks: [
    ['p', "Todo jogo roda num quadro isolado (sandbox). Ele não enxerga sua conta nem a página da Bancada."],
    ['h3', 'Funciona'],
    ['ul', ["Teclado, mouse, toque, gamepad, som e tela cheia.", "Travar o mouse (pointer lock), `alert` e formulários.", "Bibliotecas de CDN via `<script src>`, mas o mais seguro é deixar tudo dentro do arquivo."]],
    ['h3', 'Não funciona'],
    ['ul', ["`localStorage`, `sessionStorage` e cookies (use o ranking da Bancada para guardar pontuação).", "Abrir popups, baixar arquivos ou redirecionar a página do site."]],
    ['h3', 'Limites'],
    ['ul', ["O jogo é um único arquivo HTML, com CSS e JS dentro, de até 400 mil caracteres."]]
  ] },
  { id: 'forks', title: 'Publicar e fazer forks', blocks: [
    ['ul', [
      "Para publicar: clique em Novo projeto, cole o código e escolha a categoria.",
      "Para melhorar o jogo de outra pessoa: abra a página do jogo e clique em Criar fork. O código é copiado e vira um projeto seu.",
      "Os forks aparecem na página do jogo original e no filtro Forks da página inicial.",
      "Só o autor e a moderação podem editar ou excluir um projeto.", "Projetos privados só aparecem para o autor e para a administração. A proteção precisa estar ativa no RLS do Supabase."]]
  ] }, 
  { id: 'importacao', title: 'Jogos 3d, fisica, e motores de renderização', blocks: [
    ['h3', "Créditos"],
    ['p', "Graças ao [@Davi](#/u/Dave007), um membro valioso de nossa comunidade, foi possivel descobrir ser possivel a criação de jogos 3d por meio de importação de bibliotecas, e por este feito, o creditamos, parabéns [@Davi](#/u/Dave007)!"],
    ['h3', "O que é a importação de bibliotecas"],
    ['p', "Pense no seu projeto como uma construção de LEGO. Você monta o seu LEGO e usa todas as peças, porém sente que não está como idealizou. Você quer uma peça metálica, redonda e pesada, e, para ficar como quer, decide pedir essa peça emprestada a um amigo. Após colocar a peça, você finalmente sente que sua construção está completa. Mas acabou a brincadeira e aquela peça é muito pesada para levá-la por aí, então você decide devolvê-la ao seu amigo."],
    ['p', "Isto é a importação de bibliotecas. Para não termos que implementar várias bibliotecas ao site e pesar a experiência do usuário ao rodar qualquer jogo, até os que não são 3D, recomendamos que você importe as bibliotecas que usará em seu jogo."],
    ['p', "Para importar uma biblioteca para o seu jogo, você usará a tag `<script>` no cabeçalho `<head>` do seu HTML, apontando o parâmetro `src` para o link da biblioteca na CDN (como a [Cloudflare cdnjs](https://cdnjs.com/libraries))"],
    ['h3', "Veja abaixo o exemplo de importação da [Three.js](https://cdnjs.com/libraries/three.js)"],
    ['code', `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Meu Jogo 3D</title>

  <!-- Aqui é onde a mágica acontece: importando a biblioteca Three.js via CDN -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>

  <script>
    // A partir deste ponto, o Three.js já está carregado!
    // Você já pode usar todos os comandos dele, como criar cenas, câmeras e objetos 3D.
    const cena = new THREE.Scene();
    console.log("Three.js pronto para uso!", cena);
  </script>

</body>
</html>`],
    ['h3', "Bibliotecas Interessantes para Jogos e ferramentas"],
    ['ul', [
      "Motores 3D: [Three.js](https://cdnjs.com/libraries/three.js) Para cenários e objetos mais simples. & [Babylon.js](https://cdnjs.com/libraries/babylonjs) Para projetos mais ambiciosos e avançados.",
      "Motores 2d: [Phaser](https://cdnjs.com/libraries/phaser) Motor Renderizador 2d bem completo, com suporte a sprites, mapa de tiles e fisica simples & [PixiJs](https://cdnjs.com/libraries/pixi.js) Renderizador 2d ultra-rápido, para maxima performance",
      "Fisica 2d & 3d: [Matter.js](https://cdnjs.com/libraries/matter-js) Fisica 2D para objetos, gravidade, colisões, RigidBody & [Cannon.js](https://cdnjs.com/libraries/cannon.js) Fisica de objetos, RigidBody, colisões.",
      "Áudio: [Howler.js](https://cdnjs.com/libraries/howler) Reprodutor de áudio. & [Tone.js](https://cdnjs.com/libraries/tone) Sintetizador de áudio, cria batidas e sons.",
      "Interface & Ferramentas [SweetAlert2](https://cdnjs.com/libraries/limonte-sweetalert2) Pop-ups e alertas personalizaveis. & [Chart.js](https://cdnjs.com/libraries/Chart.js) Gráficos interativos como pizza, barras e linhas, bom para dashboard e painéis.",
      "Animações: [GSAP](https://cdnjs.com/libraries/gsap) Animações suaves para menus, interfaces e jogos. & [Anime.js](https://cdnjs.com/libraries/animejs) Animações leves e basicas."
    ]]
  ] },
  { id: 'online', title: 'Download e salas online', blocks: [
    ['p', "Dentro da Bancada o jogo é isolado por segurança, então um download feito pelo próprio jogo é bloqueado. Use `Bancada.download`: o site pergunta ao jogador se quer baixar e, se ele aceitar, baixa o arquivo."],
    ['code', `// data pode ser Blob, ArrayBuffer, Uint8Array ou texto
await Bancada.download('musica.mp3', blob);`],
    ['ul', ["Extensões aceitas: mp3, wav, ogg, opus, aac, json, txt, png, webp e glb.", "Tamanho máximo: 30 MB, e no máximo um download a cada 2 segundos."]],
    ['h3', 'Salas online'],
    ['p', "Com `Bancada.joinRoom` os jogadores de um mesmo jogo trocam mensagens em tempo real. Só quem está logado entra."],
    ['code', `const sala = await Bancada.joinRoom('arena');

sala.onPresence((jogadores) => { /* [{id, name}] quem está na sala agora */ });
sala.onMessage((dados, de) => { /* de = {id, name}: o nome é o verdadeiro */ });

sala.send({ x: 10, y: 20 });   // vai para todos os OUTROS jogadores
// sala.leave() para sair`],
    ['ul', [
      "Você não recebe as suas próprias mensagens. Para se ver na tela, desenhe a partir dos seus dados.",
      "Cada mensagem aceita até 4000 caracteres, e o site deixa passar no máximo 25 por segundo por jogador.",
      "Cada jogo tem as suas salas: a sala 'arena' de um jogo não se mistura com a de outro.",
      "Não existe servidor decidindo o jogo: um jogador (por exemplo o primeiro da lista) deve ser o 'dono' da partida, e não confie cegamente nos dados dos outros.",
      "Envie só o que mudou (por exemplo 10 vezes por segundo) e deixe o resto para o jogo calcular."]]
  ] }
];

// `texto` vira <code>; [texto](#/docs) ou [texto](https://...) vira link; tudo entra como texto puro
const rich = (t) => t.split(/(\[[^\]]+\]\([^)\s]+\))/).flatMap((part) => {
  const m = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
  if (m) {
    if (m[2].startsWith('#/')) return h('a', { href: m[2] }, m[1]);
    if (/^https?:\/\//i.test(m[2])) return h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer' }, m[1]);
    return part;   // endereços perigosos (ex.: javascript:) viram texto comum
  }
  return part.split('`').map((x, i) => (i % 2 ? h('code', {}, x) : x));
});

function docBlock([type, v]) {
  if (type === 'p') return h('p', {}, rich(v));
  if (type === 'h3') return h('h3', {}, v);
  if (type === 'ul') return h('ul', {}, v.map((i) => h('li', {}, rich(i))));
  const copy = async () => { try { await navigator.clipboard.writeText(v); toast('Copiado.'); } catch { toast('Não foi possível copiar.'); } };
  return h('div', { class: 'codeblock' }, h('button', { class: 'btn', onclick: copy }, 'Copiar'), h('pre', {}, v));
}

function showDocs(id) {
  const sec = DOCS.find((s) => s.id === id) || DOCS[0];
  document.title = sec.title + ' – Documentação – Bancada';
  $('#view').replaceChildren(h('div', { class: 'docs' },
    h('nav', { class: 'toc', 'aria-label': 'Seções da documentação' }, h('h2', {}, 'Documentação'),
      DOCS.map((s) => h('a', { href: '#/docs/' + s.id, 'aria-current': String(s === sec) }, s.title))),
    h('article', {}, h('h1', {}, sec.title), sec.blocks.map(docBlock))));
}

/* ---------- Referências por nome: montagem do jogo ---------- */
// Referência relativa (sem http:, //) = arquivo do próprio projeto
const isLocal = (u) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
const attrOf = (tag, n) => (tag.match(new RegExp('\\b' + n + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')) || []).slice(1).find((v) => v != null);
const escEnd = (s, t) => s.replace(new RegExp('</' + t, 'gi'), '<\\/' + t);

// Junta HTML + CSS + JS. <link>/<script src> locais viram código embutido; imagens, áudios e modelos
// resolvem pela <base> apontando para a pasta do projeto no Storage (injetada em withSdk).
function buildDoc(p) {
  let doc = p.code || '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
  let cssUsed = false, jsUsed = false;
  doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = attrOf(tag, 'href');
    if (!p.css || !/stylesheet/i.test(tag) || !href || !isLocal(href)) return tag;
    if (cssUsed) return '';
    cssUsed = true;
    return '<style>' + escEnd(p.css, 'style') + '</style>';
  });
  doc = doc.replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, (tag) => {
    const src = attrOf(tag, 'src');
    if (!p.js || !src || !isLocal(src)) return tag;
    if (jsUsed) return '';
    jsUsed = true;
    return '<script' + (/type\s*=\s*["']?module/i.test(tag) ? ' type="module"' : '') + '>' + escEnd(p.js, 'script') + '</script>';
  });
  if (p.css && !cssUsed) {
    const st = '<style>' + escEnd(p.css, 'style') + '</style>';
    doc = /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, (m) => st + m) : doc + st;
  }
  if (p.js && !jsUsed) {
    const sc = '<script>' + escEnd(p.js, 'script') + '<\/script>';
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, (m) => sc + m) : doc + sc;
  }
  return withSdk(doc, '<base href="' + projectBase(p.id) + '">');
}

/* ---------- Helpers de arquivos ---------- */
const nfmt = (n) => n.toLocaleString('pt-BR');
const mb = (b) => b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copiado.'); } catch { toast('Não foi possível copiar.'); } }

// Linha de um arquivo: nome, referência (para usar no código) e URL. pid = id do projeto (null se ainda não salvo)
function fileRow(x, pid, onRemove) {
  const icon = { imagem: '🖼️', audio: '🔊', modelo: '🧊', codigo: '📄' }[x.kind];
  const url = pid ? fileUrl(pid, x.path) : null;
  const btn = (label, t) => h('button', { type: 'button', class: 'btn', onclick: () => copyText(t) }, label);
  return h('div', { class: 'filerow' },
    h('strong', {}, icon + ' ' + x.path.split('/').pop() + ' · ' + mb(x.size)),
    h('div', { class: 'ref' }, 'Referência:', h('code', {}, x.path), btn('Copiar referência', x.path)),
    h('div', { class: 'ref' }, 'URL:', url ? [h('code', {}, url), btn('Copiar URL', url)] : h('em', {}, 'disponível depois de salvar')),
    onRemove ? h('button', { type: 'button', class: 'btn danger', onclick: onRemove }, 'Remover') : null);
}

/* ---------- Validação do conteúdo dos campos ---------- */
const stripC = (s) => s.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
const TAG = /<\/?[a-z][a-z0-9-]*[\s>\/]/i;
// Cada verificador devolve o texto do erro, ou '' se estiver ok (regras "plausíveis", fáceis de ajustar)
const CHECKS = {
  html: (s) => (!s.trim() || TAG.test(s) ? '' : 'não parece HTML (nenhuma tag encontrada).'),
  css: (s) => {
    const t = stripC(s);
    if (!t) return '';
    if (TAG.test(t)) return 'parece HTML, não CSS.';
    if (/\b(function|const|let)\s|=>|document\.|window\./.test(t)) return 'parece JavaScript, não CSS.';
    return /\{[^]*\}/.test(t) ? '' : 'não parece CSS (nenhuma regra encontrada).';
  },
  js: (s) => {
    const t = stripC(s);
    if (!t) return '';
    if (/^<[a-z!\/]/i.test(t)) return 'parece HTML, não JavaScript.';
    if (/^[^=;()]*\{[^{}]*:[^{}]*\}/.test(t) && !/\b(function|const|let|var|return)\b|=>/.test(t)) return 'parece CSS, não JavaScript.';
    return '';
  }
};
const CODE_FIELDS = [   // [chave, rótulo, limite em PROJECT_LIMITS, extensões, coluna no banco]
  ['html', 'HTML', 'MAX_HTML_CHARACTERS', '.html', 'code'],
  ['css', 'CSS', 'MAX_CSS_CHARACTERS', '.css', 'css'],
  ['js', 'JavaScript', 'MAX_JS_CHARACTERS', '.js', 'js']
];

/* ---------- Página: novo projeto / fork / editar ---------- */
async function showEditor(mode, arg, my) {
  if (!state.me) { location.hash = '#/'; return openAuth('login', 'Entre para publicar.'); }
  if (state.me.banned) { toast('Sua conta está banida e não pode publicar.'); location.hash = '#/'; return; }
  const isEdit = mode === 'edit';
  let src = null, srcAssets = [];
  if (arg) {
    const [r, a] = await Promise.all([
      sb.from('projects').select('id, title, description, category, code, css, js, user_id, forked_from, cover_at, is_public').eq('id', arg).maybeSingle(),
      sb.from('assets').select('path, kind, size').eq('project_id', arg)]);
    if (r.error) throw r.error;
    if (my !== nav) return;
    src = r.data; srcAssets = a.data || [];
    if (!src) { $('#view').replaceChildren(h('p', { class: 'empty' }, 'Projeto não encontrado.')); return; }
    if (isEdit && src.user_id !== state.me.id && !isStaff()) { toast('Sem permissão para editar.'); location.hash = '#/'; return; }
  }
  const forkOf = !isEdit && src ? src.id : null;
  const B = sb.storage.from(STORAGE_BUCKET);
  const LIM = PROJECT_LIMITS.MAX_ASSETS_MB * 1048576;
  let files = srcAssets.map((a) => ({ ...a, old: true }));   // old = já existe no servidor (ou será copiado, no fork)
  const removed = [];

  const title = h('input', { required: '', minlength: '2', maxlength: '80', value: src ? src.title + (forkOf ? ' (fork)' : '') : '' });
  const category = h('select', {}, CATS.map((c) => h('option', { value: c, selected: src && c === src.category }, c)));
  const description = h('textarea', { rows: '2', required: '', minlength: '2', maxlength: '300' });
  description.value = src ? ((forkOf ? 'Fork de ' + src.title + '. ' : '') + src.description).slice(0, 300) : '';

  // Privacidade: falso = privado. A segurança real é feita pelas políticas RLS do Supabase.
  const publicCheck = h('input', { type: 'checkbox' });
  publicCheck.checked = src ? src.is_public !== false : true;

  let authorSelect = null, authorHint = null;
  if (isStaff()) {
    authorSelect = h('select', {});
    authorHint = h('p', { class: 'hint' }, 'Administradores podem registrar projetos históricos em nome de outro usuário.');
    try {
      const { data: authors, error: authorErr } = await sb.from('profiles').select('id, username').order('username');
      if (authorErr) throw authorErr;
      (authors || []).forEach((u) => authorSelect.append(h('option', { value: u.id }, '@' + u.username)));
      authorSelect.value = src ? src.user_id : state.me.id;
    } catch (err) {
      authorHint.textContent = 'Não foi possível carregar os autores: ' + friendly(err);
    }
  }

  const fields = CODE_FIELDS.map(([key, label, max, accept, col]) => {
    const ta = h('textarea', { class: 'mono', rows: '10', spellcheck: 'false', 'aria-label': label, placeholder: 'Cole seu código ' + label + ' aqui ou arraste um arquivo ' + accept });
    ta.value = src ? src[col] : '';
    ta.addEventListener('input', problems);
    ta.addEventListener('dragover', (e) => e.preventDefault());
    ta.addEventListener('drop', async (e) => { e.preventDefault(); const fl = e.dataTransfer.files[0]; if (fl) { ta.value = await fl.text(); problems(); } });
    return { key, label, max, col, ta, err: h('p', { class: 'error' }) };
  });
  const submit = h('button', { type: 'submit', class: 'btn solid' }, isEdit ? 'Salvar alterações' : 'Criar projeto');
  const status = h('p', { class: 'hint' });

  function problems() {
    let bad = false;
    for (const f of fields) {
      const s = f.ta.value, lim = PROJECT_LIMITS[f.max], why = CHECKS[f.key](s);
      f.err.textContent = s.length > lim
        ? 'O arquivo ' + f.label + ' ultrapassa o limite permitido.\nLimite: ' + nfmt(lim) + ' caracteres\nEncontrado: ' + nfmt(s.length) + ' caracteres'
        : why ? 'Campo ' + f.label + ': ' + why : '';
      bad = bad || !!f.err.textContent;
    }
    submit.disabled = bad;
    return bad;
  }

  // Assets
  const used = () => files.reduce((n, x) => n + x.size, 0);
  const list = h('div', {}), meter = h('p', { class: 'hint' }), assetErr = h('p', { class: 'error' });
  function drawFiles() {
    meter.textContent = 'Armazenamento utilizado: ' + mb(used()) + ' / ' + PROJECT_LIMITS.MAX_ASSETS_MB + ' MB · Disponível: ' + mb(LIM - used());
    list.replaceChildren(...files.map((x) => fileRow(x, isEdit && x.old ? src.id : null, () => {
      if (x.old && isEdit) removed.push(x.path);
      files = files.filter((y) => y !== x); drawFiles();
    })));
  }
  function addFiles(fl) {
    const msgs = [];
    for (const file of fl) {
      const t = ASSET_TYPES[(file.name.split('.').pop() || '').toLowerCase()];
      if (!t) { msgs.push(file.name + ': formato não permitido (use ' + Object.keys(ASSET_TYPES).join(', ') + ').'); continue; }
      const path = t.dir + '/' + file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      if (!file.size) { msgs.push(file.name + ': arquivo vazio.'); continue; }
      if (files.some((x) => x.path === path)) { msgs.push(path + ': já existe neste projeto.'); continue; }
      if (used() + file.size > LIM) { msgs.push(file.name + ' (' + mb(file.size) + ') não cabe: passaria de ' + PROJECT_LIMITS.MAX_ASSETS_MB + ' MB (disponível: ' + mb(LIM - used()) + ').'); continue; }
      files.push({ path, kind: KIND[t.dir], size: file.size, file, mime: t.mime });
    }
    assetErr.textContent = msgs.join('\n');
    drawFiles();
  }
  const zone = h('div', { class: 'drop' }, 'Arraste aqui imagens (.avif, .webp), áudios (.opus, .aac) e modelos 3D (.glb), ou ',
    h('input', { type: 'file', multiple: '', accept: Object.keys(ASSET_TYPES).map((e) => '.' + e).join(','), onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } }));
  zone.addEventListener('dragover', (e) => e.preventDefault());
  zone.addEventListener('drop', (e) => { e.preventDefault(); addFiles([...e.dataTransfer.files]); });

  // Capa (opcional): vira 640x360 WebP no navegador antes de enviar
  let coverBlob = null, coverRemove = false;
  const coverImg = h('img', { class: 'cover', alt: 'Prévia da capa', hidden: '' }), coverErr = h('p', { class: 'error' });
  if (isEdit && coverUrl(src)) { coverImg.src = coverUrl(src); coverImg.hidden = false; }
  const coverBox = h('section', {}, h('h2', {}, 'Capa (opcional)'),
    h('p', { class: 'hint' }, 'PNG, JPG, WEBP ou AVIF de até ' + IMAGE_LIMITS.MAX_INPUT_MB + ' MB. Será recortada em 16:9.'), coverImg, coverErr,
    h('input', { type: 'file', accept: 'image/*', onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      coverErr.textContent = '';
      try {
        coverBlob = await resizeImage(f, IMAGE_LIMITS.COVER_W, IMAGE_LIMITS.COVER_H);
        coverRemove = false; coverImg.src = URL.createObjectURL(coverBlob); coverImg.hidden = false;
      } catch (err) { coverBlob = null; coverErr.textContent = err.message; e.target.value = ''; }
    } }),
    isEdit && src.cover_at ? h('button', { type: 'button', class: 'btn danger', onclick: () => { coverBlob = null; coverRemove = true; coverImg.hidden = true; } }, 'Remover capa') : null);
  const form = h('form', { class: 'editor' },
    h('h1', {}, isEdit ? 'Editar projeto' : forkOf ? 'Novo fork' : 'Novo projeto'),
    h('label', {}, 'Nome do projeto', title), h('label', {}, 'Categoria', category), h('label', {}, 'Descrição curta', description),
    h('label', { class: 'checkline' }, publicCheck, ' Projeto público (desmarque para manter privado)'),
    authorSelect ? h('section', { class: 'admin-project-options' }, h('h2', {}, 'Publicação administrativa'), h('label', {}, 'Autor exibido', authorSelect), authorHint) : null,
    coverBox,
    h('section', {}, h('h2', {}, 'Código (opcional)'),
      h('p', { class: 'hint' }, 'Cole o código ou arraste o arquivo para o campo. Dentro do projeto, use só o nome: style.css, script.js, imagens/foto.webp.'),
      fields.map((f) => h('label', {}, f.label, f.ta, f.err))),
    h('section', {}, h('h2', {}, 'Assets'), zone, meter, assetErr, list),
    status, h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: isEdit ? '#/p/' + src.id : '#/' }, 'Cancelar'), submit));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (problems()) return;
    submit.disabled = true;
    const body = { title: title.value.trim(), category: category.value, description: description.value.trim(), is_public: !!publicCheck.checked };
    if (authorSelect && isStaff()) body.user_id = authorSelect.value;
    for (const f of fields) body[f.col] = f.ta.value;
    let id = isEdit ? src.id : null;
    const uploaded = [];
    try {
      if (isEdit) {
        const { data, error } = await sb.from('projects').update(body).eq('id', id).select('id');
        if (error) throw error;
        if (!data.length) throw new Error('Sem permissão para alterar este projeto.');
      } else {
        if (forkOf) {
          body.forked_from = forkOf;
          // Um fork de projeto privado nasce privado para não vazar o projeto-base.
          if (src && src.is_public === false && !publicCheck.checked) body.is_public = false;
        }
        const { data, error } = await sb.from('projects').insert(body).select('id').single();
        if (error) throw error;
        id = data.id;
      }
      const fresh = files.filter((x) => x.file), copies = isEdit ? [] : files.filter((x) => x.old);
      let n = 0;
      for (const x of fresh) {
        status.textContent = 'Enviando arquivo ' + (++n) + ' de ' + fresh.length + '…';
        const { error } = await B.upload(id + '/' + x.path, x.file, { contentType: x.mime, upsert: true });
        if (error) throw error;
        uploaded.push(id + '/' + x.path);
      }
      for (const x of copies) {   // fork: copia os assets do original
        status.textContent = 'Copiando ' + x.path + '…';
        const { error } = await B.copy(src.id + '/' + x.path, id + '/' + x.path);
        if (error) throw error;
        uploaded.push(id + '/' + x.path);
      }
      const rows = [...fresh, ...copies].map((x) => ({ project_id: id, path: x.path, kind: x.kind, size: x.size }));
      if (rows.length) { const { error } = await sb.from('assets').insert(rows); if (error) throw error; }
      if (removed.length) {
        await sb.from('assets').delete().eq('project_id', id).in('path', removed);
        await B.remove(removed.map((p) => id + '/' + p));
      }
      // cópias do código no Storage: servem só para ter uma URL de cada arquivo
      for (const [name, col, mime] of CODE_FILES) {
        if (body[col]) await B.upload(id + '/' + name, new Blob([body[col]], { type: mime }), { contentType: mime, upsert: true });
        else if (isEdit) await B.remove([id + '/' + name]);
      }
      if (coverBlob) {
        await uploadImage('capas/' + id, coverBlob);
        const { error } = await sb.from('projects').update({ cover_at: new Date().toISOString() }).eq('id', id);
        if (error) throw error;
      } else if (coverRemove) {
        await sb.from('projects').update({ cover_at: null }).eq('id', id);
        await sb.storage.from(IMAGE_BUCKET).remove(['capas/' + id + '.webp']);
      }
      state.list = null;
      toast(isEdit ? 'Projeto atualizado.' : forkOf ? 'Fork criado!' : 'Projeto criado!');
      location.hash = '#/p/' + id;
    } catch (err) {
      if (uploaded.length) await B.remove(uploaded).catch(() => {});
      if (coverBlob && !isEdit && id) await sb.storage.from(IMAGE_BUCKET).remove(['capas/' + id + '.webp']).catch(() => {});
      if (!isEdit && id) await sb.from('projects').delete().eq('id', id);
      if (isAuthErr(err)) requireLogin(); else status.textContent = 'Erro: ' + friendly(err);
      submit.disabled = false;
    }
  });

  $('#view').replaceChildren(form);
  problems();
  drawFiles();
}

/* ---------- Rotas ---------- */
async function route() {
  const my = ++nav;
  if (cleanup) { cleanup(); cleanup = null; }
  window.scrollTo(0, 0);
  document.body.classList.remove('imm');
  document.title = 'Bancada';
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  try {
    if (page === 'p' && /^\d+$/.test(arg || '')) await showProject(arg, my);
    else if (page === 'u' && arg) await showProfile(decodeURIComponent(arg), my);
    else if (page === 'novo' && /^\d*$/.test(arg || '')) await showEditor('new', arg, my);
    else if (page === 'editar' && /^\d+$/.test(arg || '')) await showEditor('edit', arg, my);
    else if (page === 'mod') await showMod(my);
    else if (page === 'docs') showDocs(arg);
    else if (page === 'novidades') showNews();
    else if (page === 'sobre') showAbout();
    else await showHome(my);
  } catch (err) {
    if (my === nav) $('#view').replaceChildren(h('p', { class: 'empty' }, friendly(err)));
  }
}
window.addEventListener('hashchange', route);

(async function init() {
  if (!sb) {
    renderSession();
    $('#view').replaceChildren(h('h1', {}, 'Falta configurar'), h('p', {}, 'Abra o config.js e cole a URL e a chave do seu projeto no Supabase.'));
    return;
  }
  const { data } = await sb.auth.getSession();
  try { await loadMe(data.session); } catch (err) { toast(friendly(err)); }
  renderSession();
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && state.me) { state.me = null; renderSession(); route(); }
  });
  route();
})();
