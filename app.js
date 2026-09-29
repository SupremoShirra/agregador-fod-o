'use strict';

const $ = (s, r = document) => r.querySelector(s);
const CATEGORIES = ['Utilitários', 'Jogos', 'Produtividade', 'Design e arte', 'Educação', 'Outros'];
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

const state = { me: null, projects: [], cat: 'Todos', q: '' };
const fmtDate = (t) => new Date(t).toLocaleDateString('pt-BR');
const emailOf = (u) => u.toLowerCase() + '@' + CFG.EMAIL_DOMAIN;

let toastTimer;
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
  if (/permission denied|row-level security/i.test(m)) return 'O banco recusou a operação por falta de permissão. Rode o fix.sql no Supabase.';
  if (/check constraint|violates/i.test(m)) return 'Algum campo está fora do limite permitido.';
  return m || 'Algo deu errado. Tente de novo.';
}
const isAuthErr = (err) => err && (err.status === 401 || /jwt|not authenticated/i.test(err.message || ''));

/* ---------- Sessão ---------- */
async function loadMe(session) {
  if (!session) { state.me = null; return; }
  const uid = session.user.id;
  const get = () => sb.from('profiles').select('id, username').eq('id', uid).maybeSingle();
  let { data, error } = await get();
  if (error) throw error;
  if (!data) {
    // Perfil ainda não existe (o gatilho do banco pode não ter rodado): cria a partir do nome escolhido no cadastro
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

function renderSession() {
  const box = $('#session');
  box.replaceChildren();
  if (state.me) {
    box.append(
      h('span', { class: 'who' }, '@' + state.me.username),
      h('button', { class: 'btn solid', onclick: () => openEditor() }, 'Novo projeto'),
      h('button', { class: 'btn ghost', onclick: logout }, 'Sair')
    );
  } else {
    box.append(
      h('button', { class: 'btn', onclick: () => openAuth('login') }, 'Entrar'),
      h('button', { class: 'btn solid', onclick: () => openAuth('register') }, 'Criar conta')
    );
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
  $('#authTitle').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#authSubmit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('#authSwitch').textContent = reg ? 'Já tenho conta' : 'Quero criar uma conta';
  $('#authForm').password.autocomplete = reg ? 'new-password' : 'current-password';
  $('#authHint').textContent = hint || (reg ? 'Usuário: 3 a 20 letras, números ou _. Senha: mínimo de 8 caracteres. Anote a senha: não há recuperação por e-mail.' : '');
  $('#authError').textContent = '';
  $('#authForm').password.value = '';
  if (!$('#authDlg').open) $('#authDlg').showModal();
  $('#authForm').username.focus();
}
$('#authSwitch').addEventListener('click', () => openAuth(authMode === 'login' ? 'register' : 'login'));
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const username = f.username.value.trim();
  const password = f.password.value;
  const btn = $('#authSubmit');
  btn.disabled = true;
  try {
    let res;
    if (authMode === 'register') {
      res = await sb.auth.signUp({ email: emailOf(username), password, options: { data: { username } } });
      if (!res.error && !res.data.session) {
        throw new Error('O cadastro foi criado, mas o projeto exige confirmação por e-mail. O administrador precisa desativar "Confirm email" no Supabase.');
      }
    } else {
      res = await sb.auth.signInWithPassword({ email: emailOf(username), password });
    }
    if (res.error) throw res.error;
    await loadMe(res.data.session);
    if (!state.me) throw new Error('Não foi possível carregar o perfil. Tente entrar de novo.');
    f.reset();
    $('#authDlg').close();
    renderSession();
    toast(authMode === 'login' ? 'Bem-vindo de volta, ' + state.me.username + '!' : 'Conta criada!');
    route();
  } catch (err) {
    $('#authError').textContent = friendly(err);
  } finally { btn.disabled = false; }
});

let editingId = null;
function openEditor(p) {
  if (!state.me) return openAuth('login', 'Entre para publicar um projeto.');
  const f = $('#editForm');
  editingId = p ? p.id : null;
  $('#editTitle').textContent = p ? 'Editar projeto' : 'Novo projeto';
  f.category.replaceChildren(...CATEGORIES.map((c) => h('option', { value: c }, c)));
  f.title.value = p ? p.title : '';
  f.category.value = p ? p.category : CATEGORIES[0];
  f.description.value = p ? p.description : '';
  f.code.value = p ? p.code : '';
  $('#editError').textContent = '';
  $('#editDlg').showModal();
  f.title.focus();
}
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { title: f.title.value.trim(), category: f.category.value, description: f.description.value.trim(), code: f.code.value };
  try {
    let id = editingId;
    if (id) {
      // O banco só deixa passar se você for o autor; se não for, volta 0 linhas alteradas
      const { data, error } = await sb.from('projects').update(body).eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) throw new Error('Só o autor pode alterar este projeto.');
    } else {
      const { data, error } = await sb.from('projects').insert(body).select('id').single();
      if (error) throw error;
      id = data.id;
    }
    $('#editDlg').close();
    toast(editingId ? 'Projeto atualizado.' : 'Projeto publicado!');
    if (location.hash === '#/p/' + id) route(); else location.hash = '#/p/' + id;
  } catch (err) {
    if (isAuthErr(err)) { $('#editDlg').close(); requireLogin(); }
    else $('#editError').textContent = friendly(err);
  }
});

/* ---------- Lista ---------- */
async function showList() {
  const view = $('#view');
  const { data, error } = await sb.from('projects')
    .select('id, title, description, category, updated_at, user_id, profiles(username)')
    .order('updated_at', { ascending: false });
  if (error) { view.replaceChildren(h('p', { class: 'empty' }, friendly(error))); return; }
  state.projects = data.map((p) => ({ ...p, author: p.profiles ? p.profiles.username : '?' }));

  const results = h('ul', { class: 'list' });
  const search = h('input', {
    type: 'search', placeholder: 'Buscar por título, autor ou descrição', 'aria-label': 'Buscar projetos', value: state.q,
    oninput: (e) => { state.q = e.target.value; renderResults(); }
  });
  const select = h('select', {
    'aria-label': 'Filtrar por categoria',
    onchange: (e) => { state.cat = e.target.value; renderResults(); }
  }, ['Todos', ...CATEGORIES].map((c) => h('option', { value: c, selected: c === state.cat }, c === 'Todos' ? 'Todas as categorias' : c)));

  function renderResults() {
    const q = state.q.trim().toLowerCase();
    const shown = state.projects.filter((p) =>
      (state.cat === 'Todos' || p.category === state.cat) &&
      (!q || [p.title, p.description, p.author].some((s) => s.toLowerCase().includes(q))));
    results.replaceChildren(...shown.map((p) => h('li', { class: 'item' },
      h('h2', {}, h('a', { href: '#/p/' + p.id }, p.title)),
      h('p', {}, p.description),
      h('div', { class: 'meta' },
        h('span', { class: 'tag' }, p.category),
        h('span', {}, '@' + p.author + ' · ' + fmtDate(p.updated_at)),
        state.me && state.me.id === p.user_id ? h('span', { class: 'mine' }, 'Seu projeto') : null)
    )));
    if (!shown.length) {
      results.replaceChildren(h('li', { class: 'empty' },
        state.projects.length ? 'Nenhum projeto bate com a busca.' :
          state.me ? 'Ainda não há projetos. Publique o primeiro!' : 'Ainda não há projetos. Crie uma conta para publicar o primeiro.'));
    }
  }

  view.replaceChildren(
    h('section', { class: 'intro' },
      h('h1', {}, 'Projetos da turma'),
      h('p', {}, 'Cada um publica os seus apps em HTML. Todo mundo pode abrir e rodar; só o autor edita ou apaga.')),
    h('div', { class: 'tools' }, search, select),
    results
  );
  renderResults();
}

/* ---------- Projeto ---------- */
async function showProject(id) {
  const view = $('#view');
  const back = h('a', { class: 'back', href: '#/' }, '← Todos os projetos');
  const { data, error } = await sb.from('projects')
    .select('id, title, description, category, code, updated_at, user_id, profiles(username)')
    .eq('id', id).maybeSingle();
  if (error || !data) {
    view.replaceChildren(back, h('p', { class: 'empty' }, error ? friendly(error) : 'Projeto não encontrado.'));
    return;
  }
  const p = { ...data, author: data.profiles ? data.profiles.username : '?' };
  const mine = state.me && state.me.id === p.user_id;

  const stage = h('div', { class: 'stage' });
  const tabRun = h('button', { class: 'tab', role: 'tab', onclick: () => tab('run') }, 'Executar');
  const tabCode = h('button', { class: 'tab', role: 'tab', onclick: () => tab('code') }, 'Código');

  function tab(which) {
    tabRun.setAttribute('aria-selected', which === 'run');
    tabCode.setAttribute('aria-selected', which === 'code');
    if (which === 'run') {
      // sandbox SEM allow-same-origin: o projeto roda isolado e não enxerga a sessão de login
      const frame = h('iframe', { sandbox: 'allow-scripts allow-modals allow-forms', title: p.title, referrerpolicy: 'no-referrer' });
      frame.srcdoc = p.code;
      stage.replaceChildren(frame);
    } else {
      stage.replaceChildren(h('div', { class: 'codebox' },
        h('button', { class: 'btn', onclick: copyCode }, 'Copiar código'),
        h('pre', {}, p.code)));
    }
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(p.code); toast('Código copiado.'); }
    catch { toast('Não foi possível copiar. Selecione o texto manualmente.'); }
  }
  async function remove() {
    if (!confirm('Excluir "' + p.title + '"? Isso não pode ser desfeito.')) return;
    const { data: del, error: err } = await sb.from('projects').delete().eq('id', p.id).select('id');
    if (err) { if (isAuthErr(err)) requireLogin(); else toast(friendly(err)); return; }
    if (!del.length) { toast('Só o autor pode apagar este projeto.'); return; }
    toast('Projeto excluído.');
    location.hash = '#/';
  }

  view.replaceChildren(
    back,
    h('div', { class: 'phead' },
      h('div', {},
        h('h1', {}, p.title),
        h('div', { class: 'sub' },
          h('span', { class: 'tag' }, p.category),
          h('span', {}, 'por @' + p.author + ' · atualizado em ' + fmtDate(p.updated_at)))),
      mine ? h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => openEditor(p) }, 'Editar'),
        h('button', { class: 'btn danger', onclick: remove }, 'Excluir')) : null),
    h('p', { class: 'desc' }, p.description),
    h('div', { class: 'tabs', role: 'tablist' }, tabRun, tabCode),
    stage
  );
  tab('run');
}

/* ---------- Rotas e início ---------- */
function route() {
  window.scrollTo(0, 0);
  const m = location.hash.match(/^#\/p\/(\d+)$/);
  return m ? showProject(m[1]) : showList();
}
window.addEventListener('hashchange', route);

(async function init() {
  if (!sb) {
    renderSession();
    $('#view').replaceChildren(
      h('h1', {}, 'Falta configurar'),
      h('p', {}, 'Abra o arquivo config.js e cole a URL e a chave do seu projeto no Supabase. O passo a passo está no README.')
    );
    return;
  }
  const { data } = await sb.auth.getSession();
  try { await loadMe(data.session); } catch (err) { toast(friendly(err)); }
  renderSession();
  sb.auth.onAuthStateChange((event, session) => {
    // Só reage a saída/renovação; login e cadastro já são tratados no formulário
    if (event === 'SIGNED_OUT' && state.me) { state.me = null; renderSession(); route(); }
  });
  route();
})();
