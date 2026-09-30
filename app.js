const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = null;
async function api(u, method = 'GET', body) {
  const r = await fetch('/api' + u, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
}
function toast(m) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 2200); }
const thumb = g => g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" loading="lazy">` : '🎮';
const card = g => `<article class="card"><a class="thumb" href="#/game/${g.id}">${thumb(g)}</a>
<button class="fav ${g.fav ? 'on' : ''}" data-fav="${g.id}" aria-label="Toggle favorite">♥</button>
<div class="b"><span class="tag" style="align-self:flex-start">${esc(g.category)}</span><h3>${esc(g.name)}</h3><p>${esc(g.description)}</p>
<div class="r"><span style="color:var(--muted);font-size:12px">${g.plays} plays</span><a class="btn sm" href="#/game/${g.id}">Play Now</a></div></div></article>`;
const grid = (gs, empty = 'No games yet.') => gs.length ? `<div class="grid">${gs.map(card).join('')}</div>` : `<div class="empty">${empty}</div>`;

async function boot() {
  try { document.getElementById('site').textContent = (await api('/settings')).site_name; document.title = document.getElementById('site').textContent; } catch {}
  try { me = (await api('/me')).user; } catch {}
  renderUser(); route();
}
function renderUser() {
  document.getElementById('user').innerHTML = me
    ? `<div class="menu"><button class="btn ghost" tabindex="0">${esc(me.username)}</button><div class="dd">${me.role === 'admin' ? '<a href="/admin/">Admin Dashboard</a>' : ''}<a href="#/favorites">Favorites</a><button id="out">Log out</button></div></div>`
    : `<a class="btn" href="#/login">Log in</a>`;
  const o = document.getElementById('out'); if (o) o.onclick = async () => { await api('/auth/logout', 'POST'); me = null; renderUser(); location.hash = '#/'; };
}
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = '#/games?q=' + encodeURIComponent(e.target.value); });
window.addEventListener('hashchange', route);
app.addEventListener('click', async e => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  if (!me) { location.hash = '#/login'; return; }
  const on = b.classList.toggle('on'); await api('/favorites/' + b.dataset.fav, on ? 'POST' : 'DELETE').catch(() => b.classList.toggle('on'));
});

async function route() {
  const [p, qs] = location.hash.slice(1).split('?'); const parts = p.split('/').filter(Boolean); const q = new URLSearchParams(qs || '');
  document.querySelectorAll('.links a').forEach(a => a.classList.toggle('on', a.dataset.r === (parts[0] || 'home')));
  window.scrollTo(0, 0);
  try {
    if (!parts[0]) return await home();
    if (parts[0] === 'games') return await games(q);
    if (parts[0] === 'game') return await detail(parts[1]);
    if (parts[0] === 'favorites') return await favorites();
    if (parts[0] === 'login' || parts[0] === 'signup') return authForm(parts[0]);
    app.innerHTML = '<div class="empty">Page not found.</div>';
  } catch (e) { app.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
async function home() {
  const [latest, popular, feat] = await Promise.all([api('/games?sort=latest&limit=8'), api('/games?sort=most_played&limit=8'), api('/games?featured=1&limit=8')]);
  const h = feat.games[0] || latest.games[0];
  const hero = h ? `<section class="hero" style="background-image:url('${esc(h.thumbnail || '')}')"><div class="in"><span class="tag">${feat.games[0] ? 'Featured' : 'Newest'} · ${esc(h.category)}</span><h1>${esc(h.name)}</h1><p>${esc(h.description)}</p><a class="btn" href="#/game/${h.id}">Play Now</a></div></section>`
    : `<section class="hero"><div class="in"><h1>Your games, one launcher</h1><p>No games are published yet.</p></div></section>`;
  let recent = ''; if (me) { const r = await api('/recent'); if (r.games.length) recent = `<h2 class="sec">Recently played</h2>${grid(r.games)}`; }
  app.innerHTML = hero + recent + `<h2 class="sec">Featured Games</h2>${grid(feat.games, 'No featured games yet.')}<h2 class="sec">Latest Games<a href="#/games?sort=latest">See all</a></h2>${grid(latest.games)}<h2 class="sec">Popular Games<a href="#/games?sort=most_played">See all</a></h2>${grid(popular.games)}<div style="height:50px"></div>`;
}
async function games(q) {
  const cats = (await api('/categories')).categories, sort = q.get('sort') || 'latest', cat = q.get('category') || '', term = q.get('q') || '';
  const d = await api(`/games?sort=${sort}&category=${encodeURIComponent(cat)}&q=${encodeURIComponent(term)}`);
  app.innerHTML = `<h2 class="sec">Games</h2><div class="bar"><input id="s" value="${esc(term)}" placeholder="Search games"><select id="c"><option value="">All categories</option>${cats.map(c => `<option ${c.name === cat ? 'selected' : ''} value="${esc(c.name)}">${esc(c.name)} (${c.n})</option>`).join('')}</select>
<select id="o"><option value="latest" ${sort === 'latest' ? 'selected' : ''}>Latest</option><option value="popular" ${sort === 'popular' ? 'selected' : ''}>Popular</option><option value="most_played" ${sort === 'most_played' ? 'selected' : ''}>Most played</option></select></div>${grid(d.games, 'No games match your search.')}`;
  const go = () => location.hash = `#/games?q=${encodeURIComponent(s.value)}&category=${encodeURIComponent(c.value)}&sort=${o.value}`;
  const s = document.getElementById('s'), c = document.getElementById('c'), o = document.getElementById('o');
  c.onchange = o.onchange = go; s.onkeydown = e => e.key === 'Enter' && go();
}
async function favorites() {
  if (!me) { location.hash = '#/login'; return; }
  const [f, r] = await Promise.all([api('/favorites'), api('/recent')]);
  app.innerHTML = `<h2 class="sec">Favorites</h2>${grid(f.games, 'Tap the heart on a game to save it here.')}<h2 class="sec">Recently played</h2>${grid(r.games, 'Games you play will show up here.')}`;
}
async function detail(id) {
  const g = (await api('/games/' + id)).game;
  app.innerHTML = `<div class="detail"><div><div class="stage" id="stage"><div class="cover" style="background-image:url('${esc(g.thumbnail || '')}')"><button class="btn" id="play">▶ Play</button></div></div>
<div style="margin-top:12px;display:flex;gap:10px"><button class="btn ghost" id="fs">Fullscreen</button><button class="btn ghost" data-fav="${g.id}" id="fv">${g.fav ? '♥ In favorites' : '♡ Add to favorites'}</button></div></div>
<aside class="info"><span class="tag">${esc(g.category)}</span><h1>${esc(g.name)}</h1><p style="color:#c6c9ea;white-space:pre-line">${esc(g.description)}</p>
<dl><dt>Version</dt><dd>${esc(g.version)}</dd><dt>Plays</dt><dd>${g.plays}</dd><dt>Added</dt><dd>${new Date(g.created_at).toLocaleDateString()}</dd></dl></aside></div>`;
  const stage = document.getElementById('stage');
  document.getElementById('play').onclick = async () => {
    if (!me) { location.hash = '#/login'; return; }
    try { await api(`/games/${g.id}/play`, 'POST'); } catch (e) { return toast(e.message); }
    const f = document.createElement('iframe'); f.src = g.source_type === 'files' ? `/play/${g.id}/` : g.game_url;
    f.allow = 'fullscreen; autoplay; gamepad; clipboard-write'; f.allowFullscreen = true;
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-popups'); stage.replaceChildren(f);
  };
  document.getElementById('fs').onclick = () => (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
  document.getElementById('fv').addEventListener('click', e => setTimeout(() => e.target.textContent = e.target.classList.contains('on') ? '♥ In favorites' : '♡ Add to favorites'));
  document.getElementById('fv').classList.toggle('on', !!g.fav);
}
function authForm(mode) {
  const su = mode === 'signup';
  app.innerHTML = `<form class="form" id="af"><h1>${su ? 'Create account' : 'Log in'}</h1>
${su ? '<label>Username</label><input name="username" required autocomplete="username"><label>Email</label><input name="email" type="email" required autocomplete="email">' : '<label>Username or email</label><input name="login" required autocomplete="username">'}
<label>Password</label><input name="password" type="password" required minlength="8" autocomplete="${su ? 'new-password' : 'current-password'}"><div class="err" id="er"></div>
<button class="btn" style="width:100%">${su ? 'Sign up' : 'Log in'}</button><p style="color:var(--muted);text-align:center">${su ? 'Have an account? <a href="#/login" style="color:var(--accent)">Log in</a>' : 'New here? <a href="#/signup" style="color:var(--accent)">Create an account</a>'}</p></form>`;
  document.getElementById('af').onsubmit = async e => {
    e.preventDefault();
    try { me = (await api('/auth/' + mode, 'POST', Object.fromEntries(new FormData(e.target)))).user; renderUser(); location.hash = '#/'; }
    catch (x) { document.getElementById('er').textContent = x.message; }
  };
}
boot();
