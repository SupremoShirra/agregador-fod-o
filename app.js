'use strict';

const $ = (s, r = document) => r.querySelector(s);
const CATS = ['Utilitários', 'Jogos', 'Produtividade', 'Design e arte', 'Educação', 'Outros'];
const MAX_CODE = 400000;
// Edite aqui as novidades do site (mais recente primeiro)
const NEWS = [
  { d: '2026-09-29', t: 'Perfis, forks e moderação', b: 'Agora cada usuário tem perfil, todo jogo tem página própria com forks e o jogo abre em tela cheia.' }
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
let nav = 0, toastTimer;
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR');
const emailOf = (u) => u.toLowerCase() + '@' + CFG.EMAIL_DOMAIN;
const isStaff = () => !!state.me && !state.me.banned && ['owner', 'moderator'].includes(state.me.role);

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
  if (/permission denied|row-level security/i.test(m)) return 'Sem permissão. Confira se você rodou o schema-v2.sql e se sua conta não está banida.';
  if (/check constraint|violates/i.test(m)) return 'Algum campo está fora do limite permitido.';
  return m || 'Algo deu errado. Tente de novo.';
}
const isAuthErr = (e) => e && (e.status === 401 || /jwt|not authenticated/i.test(e.message || ''));

/* ---------- Dados ---------- */
async function loadList(force) {
  if (state.list && !force) return state.list;
  const { data, error } = await sb.from('projects')
    .select('id, title, description, category, updated_at, user_id, forked_from, profiles(username)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (state.list = data.map((p) => ({ ...p, author: p.profiles ? p.profiles.username : '?' })));
}

async function loadMe(session) {
  if (!session) { state.me = null; return; }
  const uid = session.user.id;
  const get = () => sb.from('profiles').select('id, username, role, banned').eq('id', uid).maybeSingle();
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
      h('a', { class: 'btn ghost', href: '#/u/' + encodeURIComponent(state.me.username) }, '@' + state.me.username),
      state.me.banned ? h('span', { class: 'tag ban' }, 'Conta banida') : h('button', { class: 'btn solid', onclick: () => openEditor() }, 'Novo projeto'),
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

let ed = { id: null, fork: null };
function openEditor(p, forkOf) {
  if (!state.me) return openAuth('login', 'Entre para publicar.');
  if (state.me.banned) return toast('Sua conta está banida e não pode publicar.');
  const f = $('#editForm');
  ed = { id: p && !forkOf ? p.id : null, fork: forkOf || null };
  $('#editTitle').textContent = forkOf ? 'Novo fork' : p ? 'Editar projeto' : 'Novo projeto';
  f.category.replaceChildren(...CATS.map((c) => h('option', { value: c }, c)));
  f.title.value = p ? p.title : '';
  f.category.value = p ? p.category : CATS[0];
  f.description.value = p ? p.description : '';
  f.code.value = p ? p.code : '';
  $('#editError').textContent = '';
  $('#editDlg').showModal();
  f.title.focus();
}
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, btn = $('#editSubmit');
  const body = { title: f.title.value.trim(), category: f.category.value, description: f.description.value.trim(), code: f.code.value };
  if (body.code.length > MAX_CODE) { $('#editError').textContent = 'O código passa de 400 mil caracteres.'; return; }
  btn.disabled = true;
  try {
    let id = ed.id;
    if (id) {
      const { data, error } = await sb.from('projects').update(body).eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) throw new Error('Sem permissão para alterar este projeto.');
    } else {
      if (ed.fork) body.forked_from = ed.fork;
      const { data, error } = await sb.from('projects').insert(body).select('id').single();
      if (error) throw error;
      id = data.id;
    }
    state.list = null;
    $('#editDlg').close();
    toast(ed.id ? 'Projeto atualizado.' : ed.fork ? 'Fork criado!' : 'Projeto publicado!');
    if (location.hash === '#/p/' + id) route(); else location.hash = '#/p/' + id;
  } catch (err) {
    if (isAuthErr(err)) { $('#editDlg').close(); requireLogin(); }
    else $('#editError').textContent = friendly(err);
  } finally { btn.disabled = false; }
});

/* ---------- Componentes ---------- */
const userLink = (name) => h('a', { href: '#/u/' + encodeURIComponent(name) }, '@' + name);

function card(p) {
  return h('li', { class: 'card' },
    h('h3', {}, h('a', { href: '#/p/' + p.id }, p.title)),
    h('p', {}, p.description),
    h('div', { class: 'meta' },
      h('span', { class: 'tag' }, p.category),
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
      (state.cat === 'Todos' || (state.cat === 'Forks' ? p.forked_from : p.category === state.cat)) &&
      (!q || [p.title, p.description, p.author].some((s) => s.toLowerCase().includes(q))));
    grid.replaceChildren(...(r.length ? r.map(card) : [h('li', { class: 'empty' }, list.length ? 'Nada bate com a busca.' : 'Ainda não há projetos. Publique o primeiro!')]));
  };
  $('#view').replaceChildren(
    h('section', { class: 'hero' },
      h('h1', {}, 'Jogue, leia, faça fork.'),
      h('p', {}, 'Apps e jogos em HTML feitos pela turma. Clique e jogue em tela cheia.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn solid', href: '#/novidades' }, "What's new"),
        h('a', { class: 'btn', href: '#/sobre' }, 'Sobre nós'))),
    h('div', { class: 'tools' }, h('input', {
      type: 'search', placeholder: 'Buscar por título, autor ou descrição', 'aria-label': 'Buscar', value: state.q,
      oninput: (e) => { state.q = e.target.value; draw(); }
    })),
    chips, grid);
  draw();
}

function showNews() {
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, "What's new"),
    ...NEWS.map((n) => h('article', {}, h('time', {}, fmtDate(n.d)), h('h2', {}, n.t), h('p', {}, n.b)))));
}
function showAbout() {
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Sobre nós'), h('p', {}, ABOUT)));
}

async function showProfile(name, my) {
  const { data: u, error } = await sb.from('profiles').select('id, username, role, banned, created_at').eq('username', name).maybeSingle();
  if (error) throw error;
  const list = await loadList();
  if (my !== nav) return;
  if (!u) { $('#view').replaceChildren(h('p', { class: 'empty' }, 'Usuário não encontrado.')); return; }
  const mine = list.filter((p) => p.user_id === u.id);
  $('#view').replaceChildren(
    h('div', { class: 'phead' },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, u.username[0].toUpperCase()),
      h('div', {}, h('h1', {}, '@' + u.username),
        h('div', { class: 'meta' }, roleTag(u), h('span', {}, 'Membro desde ' + fmtDate(u.created_at)), h('span', {}, mine.length + ' projeto(s)')))),
    userActions(u, () => { state.list = null; route(); }),
    h('ul', { class: 'grid' }, mine.length ? mine.map(card) : [h('li', { class: 'empty' }, 'Nenhum projeto publicado.')]));
}

async function showProject(id, my) {
  const [{ data: p, error }, list] = await Promise.all([
    sb.from('projects').select('id, title, description, category, code, updated_at, user_id, forked_from, profiles(username)').eq('id', id).maybeSingle(),
    loadList()
  ]);
  if (error) throw error;
  if (my !== nav) return;
  if (!p) { $('#view').replaceChildren(h('a', { href: '#/' }, '← Início'), h('p', { class: 'empty' }, 'Projeto não encontrado.')); return; }
  const author = p.profiles ? p.profiles.username : '?';
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
  frame.srcdoc = p.code;
  const stage = h('div', { class: 'stage' }, frame);

  const fork = () => openEditor({ ...p, title: p.title + ' (fork)', description: 'Fork de ' + p.title + '. ' + p.description }, p.id);
  const remove = async () => {
    if (!confirm('Excluir "' + p.title + '"? Isso não pode ser desfeito.')) return;
    const { data: del, error: err } = await sb.from('projects').delete().eq('id', p.id).select('id');
    if (err) { if (isAuthErr(err)) requireLogin(); else toast(friendly(err)); return; }
    if (!del.length) return toast('Sem permissão para apagar este projeto.');
    state.list = null;
    toast('Projeto excluído.');
    location.hash = '#/';
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(p.code); toast('Código copiado.'); } catch { toast('Não foi possível copiar.'); }
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
        parent ? h('span', { class: 'tag fork' }, 'Fork') : null,
        userLink(author),
        h('span', {}, 'atualizado em ' + fmtDate(p.updated_at)),
        parent ? h('a', { href: '#/p/' + parent.id }, 'baseado em ' + parent.title) : null),
      h('p', {}, p.description),
      h('p', { class: 'hint' }, 'Este projeto roda isolado (sandbox) e não acessa sua conta.'),
      canEdit ? h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => openEditor(p) }, 'Editar'),
        h('button', { class: 'btn danger', onclick: remove }, 'Excluir')) : null,
      h('details', {}, h('summary', {}, 'Código'),
        h('div', { class: 'codebox' }, h('pre', {}, p.code)),
        h('button', { class: 'btn', onclick: copy }, 'Copiar código')),
      h('h2', {}, 'Forks (' + forks.length + ')'),
      h('ul', { class: 'grid' }, forks.length ? forks.map(card) : [h('li', { class: 'empty' }, 'Ninguém fez fork ainda. Seja o primeiro!')])));
}

async function showMod(my) {
  if (!isStaff()) { location.hash = '#/'; return; }
  const [{ data: users, error }, list] = await Promise.all([
    sb.from('profiles').select('id, username, role, banned').order('username'), loadList()]);
  if (error) throw error;
  if (my !== nav) return;
  const refresh = () => { state.list = null; route(); };
  const owner = state.me.role === 'owner';
  const input = h('input', { placeholder: 'Nome de usuário', maxlength: '20', 'aria-label': 'Novo moderador' });
  const add = async () => {
    const u = users.find((x) => x.username.toLowerCase() === input.value.trim().toLowerCase());
    if (!u) return toast('Usuário não encontrado.');
    if (await rpc('set_role', { target: u.id, new_role: 'moderator' }, '@' + u.username + ' agora é moderador.')) refresh();
  };
  $('#view').replaceChildren(h('div', { class: 'page' }, h('h1', {}, 'Moderação'),
    owner ? h('div', { class: 'inline' }, input, h('button', { class: 'btn solid', onclick: add }, 'Adicionar moderador')) : null,
    h('p', { class: 'hint' }, 'Para excluir ou editar jogos, abra a página do jogo. Aqui você gerencia contas.'),
    h('table', { class: 'users' }, h('tbody', {}, users.map((u) => h('tr', {},
      h('td', {}, userLink(u.username), ' ', roleTag(u), h('div', { class: 'hint' }, list.filter((p) => p.user_id === u.id).length + ' projeto(s)')),
      h('td', {}, userActions(u, refresh))))))));
}

/* ---------- Rotas ---------- */
async function route() {
  const my = ++nav;
  window.scrollTo(0, 0);
  document.body.classList.remove('imm');
  document.title = 'Bancada';
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, arg] = hash.split('/');
  try {
    if (page === 'p' && /^\d+$/.test(arg || '')) await showProject(arg, my);
    else if (page === 'u' && arg) await showProfile(decodeURIComponent(arg), my);
    else if (page === 'mod') await showMod(my);
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
