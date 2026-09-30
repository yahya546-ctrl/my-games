const m = document.getElementById('m');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(u, method = 'GET', body) {
  const isFD = body instanceof FormData;
  const r = await fetch('/api/admin' + u, { method, headers: body && !isFD ? { 'Content-Type': 'application/json' } : {}, body: body ? (isFD ? body : JSON.stringify(body)) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong'); return d;
}
function toast(t) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = t; document.body.append(e); setTimeout(() => e.remove(), 2400); }
const stat = (n, l) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`;
const pill = p => `<span class="pill ${p ? 'on' : 'off'}">${p ? 'Published' : 'Draft'}</span>`;

async function route() {
  const [r, id] = (location.hash.slice(1) || 'dashboard').split('/');
  document.querySelectorAll('.side a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + r));
  try { await ({ dashboard, games, add: () => form(id), users, stats, settings }[r] || dashboard)(); } catch (e) { m.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
addEventListener('hashchange', route);

async function gamesTable() {
  const { games } = await api('/games');
  if (!games.length) return '<div class="empty">No games yet. <a href="#add" style="color:var(--accent)">Add your first game</a></div>';
  return `<div class="tw"><table><tr><th>Game</th><th>Status</th><th>Plays</th><th>Edit</th><th>Publish/Unpublish</th><th>Delete</th></tr>${games.map(g => `<tr>
<td>${esc(g.name)} <span style="color:var(--muted)">· ${esc(g.category)}</span></td><td>${pill(g.published)}</td><td>${g.plays}</td>
<td><a class="btn ghost sm" href="#add/${g.id}">Edit</a></td>
<td><button class="btn ghost sm" data-act="${g.published ? 'unpublish' : 'publish'}" data-id="${g.id}">${g.published ? 'Unpublish' : 'Publish'}</button></td>
<td><button class="btn danger sm" data-act="delete" data-id="${g.id}" data-n="${esc(g.name)}">Delete</button></td></tr>`).join('')}</table></div>`;
}
m.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const { act, id } = b.dataset;
  try {
    if (act === 'delete') { if (!confirm(`Delete "${b.dataset.n}" permanently? This removes its files too.`)) return; await api('/games/' + id, 'DELETE'); toast('Deleted'); }
    else if (act === 'publish' || act === 'unpublish') { await api(`/games/${id}/${act}`, 'POST'); toast(act === 'publish' ? 'Published' : 'Unpublished'); }
    else { await api(`/users/${id}/${act}`, 'POST'); toast('Updated'); }
    route();
  } catch (x) { toast(x.message); }
});
async function dashboard() {
  const s = await api('/stats');
  m.innerHTML = `<h1>Dashboard</h1><div class="stats">${stat(s.totalGames, 'Total Games')}${stat(s.publishedGames, 'Published Games')}${stat(s.totalUsers, 'Total Users')}${stat(s.totalPlays, 'Total Plays')}</div>${await gamesTable()}`;
}
async function games() { m.innerHTML = `<h1>Games</h1>${await gamesTable()}`; }
async function stats() {
  const s = await api('/stats');
  m.innerHTML = `<h1>Statistics</h1><div class="stats">${stat(s.newUsers7d, 'New users (7 days)')}${stat(s.totalPlays, 'Total plays')}</div><h3>Most played</h3><div class="tw"><table><tr><th>Game</th><th>Plays</th></tr>${s.top.map(g => `<tr><td>${esc(g.name)}</td><td>${g.plays}</td></tr>`).join('') || '<tr><td colspan=2>No plays yet</td></tr>'}</table></div>`;
}
async function users() {
  const { users } = await api('/users');
  m.innerHTML = `<h1>Users</h1><div class="tw"><table><tr><th>User</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>${users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${u.role}</td>
<td>${u.banned ? '<span class="pill off">Suspended</span>' : '<span class="pill on">Active</span>'}</td><td>
<button class="btn ghost sm" data-act="${u.banned ? 'unban' : 'ban'}" data-id="${u.id}">${u.banned ? 'Unsuspend' : 'Suspend'}</button>
<button class="btn ghost sm" data-act="${u.role === 'admin' ? 'make-user' : 'make-admin'}" data-id="${u.id}">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button></td></tr>`).join('')}</table></div>`;
}
async function settings() {
  const s = await (await fetch('/api/settings')).json();
  m.innerHTML = `<h1>Settings</h1><form class="f" id="sf"><label>Site name</label><input name="site_name" maxlength="40" value="${esc(s.site_name)}"><button class="btn">Save changes</button></form>`;
  document.getElementById('sf').onsubmit = async e => { e.preventDefault(); try { await api('/settings', 'PUT', Object.fromEntries(new FormData(e.target))); toast('Saved'); } catch (x) { toast(x.message); } };
}
async function form(id) {
  const g = id ? (await api('/games')).games.find(x => x.id == id) : null;
  m.innerHTML = `<h1>${g ? 'Edit game' : 'Add Game'}</h1><form class="f" id="gf">
<label>Game Name</label><input name="name" required maxlength="80" value="${esc(g?.name)}">
<label>Description</label><textarea name="description" rows="4" maxlength="2000">${esc(g?.description)}</textarea>
<div class="row"><div><label>Category</label><input name="category" maxlength="30" placeholder="Action, Puzzle…" value="${esc(g?.category || 'General')}"></div><div><label>Version</label><input name="version" maxlength="20" value="${esc(g?.version || '1.0')}"></div></div>
<label>Thumbnail (PNG, JPG or WEBP, max 2 MB)${g?.thumbnail ? ' — leave empty to keep the current one' : ''}</label><input type="file" name="thumbnail" accept="image/png,image/jpeg,image/webp">
<label>Game Files (.zip with index.html)${g ? ' — upload to replace' : ''}</label><input type="file" name="gamefile" accept=".zip">
<label>or Game URL (https://…)</label><input name="game_url" type="url" placeholder="https://example.com/my-game/" value="${g?.source_type === 'url' ? esc(g.game_url) : ''}">
<div class="chk"><input type="checkbox" name="featured" id="ft" ${g?.featured ? 'checked' : ''}><label for="ft" style="margin:0">Show in Featured Games</label></div>
<div class="err" id="er"></div>
${g ? '<button class="btn" data-p="">Save changes</button>' : '<button class="btn publish" data-p="1">PUBLISH GAME</button> <button class="btn ghost" data-p="0">Save as draft</button>'}</form>`;
  let pub = ''; document.querySelectorAll('#gf button').forEach(b => b.onclick = () => pub = b.dataset.p);
  document.getElementById('gf').onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(e.target); fd.set('featured', e.target.featured.checked ? '1' : '0');
    if (pub !== '') fd.set('published', pub);
    const bs = e.target.querySelectorAll('button'); bs.forEach(b => b.disabled = true);
    try { await api(g ? '/games/' + g.id : '/games', g ? 'PUT' : 'POST', fd); toast(pub === '1' ? 'Published' : 'Saved'); location.hash = '#games'; }
    catch (x) { document.getElementById('er').textContent = x.message; bs.forEach(b => b.disabled = false); }
  };
}
route();
