/* ============================================================
   app.js - toute la logique de Nade Book
   ============================================================ */

/* ---------------- constantes ---------------- */

const MAPS = [
  { id: 'mirage',   name: 'Mirage'   },
  { id: 'inferno',  name: 'Inferno'  },
  { id: 'dust2',    name: 'Dust II'  },
  { id: 'nuke',     name: 'Nuke'     },
  { id: 'ancient',  name: 'Ancient'  },
  { id: 'anubis',   name: 'Anubis'   },
  { id: 'overpass', name: 'Overpass' },
  { id: 'train',    name: 'Train'    },
  { id: 'vertigo',  name: 'Vertigo'  },
  { id: 'cache',    name: 'Cache'    },
  { id: 'office',   name: 'Office'   },
  { id: 'italy',    name: 'Italy'    },
];

const TYPES = {
  smoke: { label: 'Smoke', color: 'var(--c-smoke)' },
  flash: { label: 'Flash', color: 'var(--c-flash)' },
  molly: { label: 'Molo',  color: 'var(--c-molly)' },
  he:    { label: 'HE',    color: 'var(--c-he)'    },
};

const TECH = {
  stand:   'Statique',
  jump:    'Jump-throw',
  run:     'Run-throw',
  runjump: 'Run + Jump',
  walk:    'Walk-throw',
};

/* Segments d'un clip de lineup. En jeu on veut le repere de visee
   tout de suite : un tap plutot qu'une chasse dans la barre de lecture. */
const CHAP = {
  walkup:     'Placement',
  lineup:     'Repère',
  trajectory: 'Trajectoire',
  boom:       'Résultat',
};

/* teinte stable par map, pour que chaque vignette ait sa couleur */
const MAP_HUE = { mirage:32, inferno:8, dust2:44, nuke:196, ancient:96,
                  anubis:172, overpass:214, train:264, vertigo:302,
                  cache:132, office:228, italy:58 };

/* ---------------- etat ---------------- */

const state = {
  lineups: [],
  scope:   { kind: 'map', map: 'mirage' },  // {kind:'map'|'fav'|'all'}
  side:    'all',
  type:    'all',
  query:   '',
  view:    localStorage.getItem('nadebook-view') || 'col2',  // col2 | col1
  current: null,      // lineup ouvert dans le detail
  editing: null,      // lineup en cours d'edition dans le formulaire
  draftMedia: [],     // medias du formulaire avant sauvegarde
};

const urlCache = new Map();   // blobId -> objectURL

/* ---------------- raccourcis DOM ---------------- */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const uid = () =>
  (crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const mapName = (id) => (MAPS.find(m => m.id === id) || { name: id }).name;

let toastTimer;
/** ms = 0 : le message reste affiche jusqu'au suivant (operations longues). */
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** URL utilisable dans <img>/<video> pour un fichier stocke en base. */
async function mediaURL(blobId) {
  if (urlCache.has(blobId)) return urlCache.get(blobId);
  const rec = await DB.getMedia(blobId);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(blobId, url);
  return url;
}

/* ============================================================
   NAVIGATION ENTRE LES VUES
   ============================================================ */

function show(view) {
  ['maps', 'list', 'detail'].forEach(v => {
    $('#view-' + v).hidden = (v !== view);
  });
  // on remet le scroll en haut, sinon on arrive au milieu de la page
  const sc = $('#view-' + view + ' .scroll');
  if (sc) sc.scrollTop = 0;
}

/* ============================================================
   VUE 1 : LES MAPS
   ============================================================ */

function renderMaps() {
  const total = state.lineups.length;
  const favs  = state.lineups.filter(l => l.favorite).length;

  $('#count-all').textContent = total;
  $('#count-fav').textContent = favs;
  $('#stat-line').textContent = total === 0
    ? 'Aucun lineup pour le moment'
    : total + (total > 1 ? ' lineups enregistres' : ' lineup enregistre');

  renderEmptyHint();

  $('#map-grid').innerHTML = MAPS.map(m => {
    const list = state.lineups.filter(l => l.map === m.id);
    const hue  = MAP_HUE[m.id] ?? 210;

    // une pastille par type de grenade present sur la map
    const dots = Object.keys(TYPES)
      .filter(t => list.some(l => l.type === t))
      .map(t => `<i style="background:${TYPES[t].color}"></i>`).join('');

    const bg = `background:
      radial-gradient(120% 90% at 80% 0%, hsla(${hue},62%,52%,.30), transparent 62%),
      linear-gradient(160deg, hsla(${hue},40%,28%,.42), transparent 70%)`;

    return `
      <button class="map-card" data-map="${m.id}">
        <span class="mc-bg" style="${bg}"></span>
        <span class="mc-dots">${dots}</span>
        <span class="mc-name">${esc(m.name)}</span>
        <span class="mc-meta">${list.length === 0 ? 'vide' : list.length + (list.length > 1 ? ' lineups' : ' lineup')}</span>
      </button>`;
  }).join('');
}

/**
 * Une app vide ne disait rien : impossible de deviner qu'il fallait
 * aller dans les Reglages. Ici on annonce ce qui est disponible.
 */
async function renderEmptyHint() {
  const el = $('#empty-hint');
  if (state.lineups.length > 0) { el.hidden = true; return; }

  let ready = 0;
  if (isLocal()) {
    try {
      const b = await (await fetch('data/nadebook-import.json', { cache: 'no-store' })).json();
      ready = (b.lineups || []).length;
    } catch { /* pas de paquet prepare : message generique */ }
  }

  if (ready) {
    el.innerHTML =
      `<h3>${ready} lineups prêts à importer</h3>
       <p>Un paquet a été préparé sur ce PC. Un appui et l'app est remplie.</p>
       <button type="button" id="hint-import">Importer les ${ready} lineups</button>`;
    $('#hint-import').addEventListener('click', importLocal);
  } else {
    el.innerHTML =
      `<h3>Aucun lineup pour l'instant</h3>
       <p>Ouvre une map et appuie sur <b>+</b> pour en créer un.
          Ou passe par <b>Réglages</b> pour importer un paquet, restaurer
          une sauvegarde, ou charger des exemples.</p>`;
  }
  el.hidden = false;
}

/* ============================================================
   VUE 2 : LA LISTE FILTREE
   ============================================================ */

/** Applique portee + filtres + recherche. */
function filtered() {
  let out = state.lineups;

  if (state.scope.kind === 'map')      out = out.filter(l => l.map === state.scope.map);
  else if (state.scope.kind === 'fav') out = out.filter(l => l.favorite);

  if (state.side !== 'all') out = out.filter(l => l.side === state.side);
  if (state.type !== 'all') out = out.filter(l => l.type === state.type);

  const q = state.query.trim().toLowerCase();
  if (q) {
    out = out.filter(l => [l.title, l.from, l.to, l.notes, mapName(l.map)]
      .join(' ').toLowerCase().includes(q));
  }

  // smoke, flash, molo, HE puis alphabetique : ordre previsible
  const order = ['smoke', 'flash', 'molly', 'he'];
  return out.sort((a, b) =>
    order.indexOf(a.type) - order.indexOf(b.type) ||
    (a.title || '').localeCompare(b.title || ''));
}

async function renderList() {
  const items = filtered();

  $('#list-title').textContent =
    state.scope.kind === 'map' ? mapName(state.scope.map)
    : state.scope.kind === 'fav' ? 'Favoris'
    : 'Tous les lineups';

  const base = state.scope.kind === 'map'
    ? state.lineups.filter(l => l.map === state.scope.map).length
    : state.scope.kind === 'fav'
      ? state.lineups.filter(l => l.favorite).length
      : state.lineups.length;

  $('#list-sub').textContent = items.length === base
    ? base + (base > 1 ? ' lineups' : ' lineup')
    : items.length + ' sur ' + base;

  $('#list-empty').hidden = items.length > 0;

  $('#lineup-list').innerHTML = items.map(l => {
    const tech = l.tech ? `<span class="tag tech">${TECH[l.tech]}</span>` : '';
    const star = l.favorite ? '<span class="lu-star">&#9733;</span>' : '';
    const map  = state.scope.kind === 'map' ? '' : `<span class="tag map">${esc(mapName(l.map))}</span>`;
    const route = [l.from, l.to].filter(Boolean).join('  →  ');
    const extra = (l.media && l.media.length > 1) ? `<span class="cnt">${l.media.length}</span>` : '';

    return `
      <button class="lu" data-id="${l.id}">
        <span class="lu-thumb" data-thumb="${l.id}"><span class="ph">&#9673;</span>${extra}</span>
        <span class="lu-body">
          <span class="lu-title">${esc(l.title || 'Sans titre')}</span>
          <span class="lu-route">${esc(route) || '&nbsp;'}</span>
          <span class="lu-tags">
            <span class="tag side-${l.side}">${l.side}</span>
            <span class="tag ty-${l.type}">${TYPES[l.type].label}</span>
            ${map}${tech}${star}
          </span>
        </span>
      </button>`;
  }).join('');

  // les vignettes sont chargees apres coup (lecture asynchrone en base)
  for (const l of items) {
    const box = $(`[data-thumb="${l.id}"]`);
    if (!box) continue;

    let el = null;

    // La miniature dediee prime : c'est l'image du repere de visee,
    // la seule qui distingue deux lineups vers la meme cible. C'est aussi
    // une image legere plutot qu'une video a decoder dans chaque ligne.
    const pUrl = l.poster ? await mediaURL(l.poster) : null;
    if (pUrl) {
      el = Object.assign(document.createElement('img'),
        { src: pUrl, alt: '', loading: 'lazy' });
    } else {
      const first = (l.media || [])[0];
      if (!first) continue;
      if (first.kind === 'link') {
        const ph = box.querySelector('.ph');
        if (ph) ph.innerHTML = '&#128279;';
        continue;
      }
      const url = await mediaURL(first.blobId);
      if (!url) continue;
      el = first.kind === 'video'
        ? Object.assign(document.createElement('video'),
            { src: url, muted: true, playsInline: true, preload: 'metadata' })
        : Object.assign(document.createElement('img'), { src: url, alt: '' });
    }

    const ph = box.querySelector('.ph');
    if (ph) ph.remove();
    box.prepend(el);
  }
}

/** Applique la taille d'affichage choisie et la retient. */
function applyView() {
  const list = $('#lineup-list');
  list.classList.toggle('col2', state.view === 'col2');
  list.classList.toggle('col1', state.view === 'col1');
  $$('#viewmode button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.view));
  localStorage.setItem('nadebook-view', state.view);
}

function syncChips() {
  $$('#side-filter .chip').forEach(c => c.classList.toggle('active', c.dataset.side === state.side));
  $$('#type-filter .chip').forEach(c => c.classList.toggle('active', c.dataset.type === state.type));
}

function openList(scope) {
  state.scope = scope;
  state.side = 'all'; state.type = 'all'; state.query = '';
  $('#search').value = '';
  syncChips();
  applyView();
  show('list');
  renderList();
}

/* ============================================================
   VUE 3 : LE DETAIL
   ============================================================ */

async function openDetail(id) {
  const l = state.lineups.find(x => x.id === id);
  if (!l) return;
  state.current = l;

  $('#detail-title').textContent = l.title || 'Sans titre';

  $('#detail-tags').innerHTML = `
    <span class="tag map">${esc(mapName(l.map))}</span>
    <span class="tag side-${l.side}">${l.side}</span>
    <span class="tag ty-${l.type}">${TYPES[l.type].label}</span>`;

  $('#detail-route').innerHTML = (l.from || l.to)
    ? `<b>${esc(l.from || '?')}</b><span class="arrow">&rarr;</span><b>${esc(l.to || '?')}</b>`
    : '';

  $('#detail-tech').innerHTML = l.tech ? `<span>${TECH[l.tech]}</span>` : '';
  $('#detail-notes').textContent = l.notes || '';
  $('#btn-fav').classList.toggle('on', !!l.favorite);

  // --- medias ---
  const stage = $('#media-stage');
  stage.innerHTML = '';
  const media = l.media || [];

  if (media.length === 0) {
    stage.innerHTML = '<div class="none">Aucun media.<br>Appuie sur le crayon pour ajouter une video, un GIF ou une image.</div>';
    $('#media-dots').innerHTML = '';
  } else {
    for (const m of media) {
      if (m.kind === 'link') {
        const a = document.createElement('a');
        a.className = 'linkcard';
        a.href = m.url; a.target = '_blank'; a.rel = 'noopener';
        a.innerHTML = `<div style="font-size:26px">&#128279;</div><div>${esc(m.url)}</div>`;
        stage.appendChild(a);
        continue;
      }
      const url = await mediaURL(m.blobId);
      if (!url) continue;
      if (m.kind === 'video') {
        const v = document.createElement('video');
        v.src = url;
        v.controls = true; v.loop = true; v.muted = true;
        v.playsInline = true; v.preload = 'metadata';
        // affiche le repere de visee avant lecture, pas le spawn
        const p = l.poster ? await mediaURL(l.poster) : null;
        if (p) v.poster = p;
        stage.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = url; img.alt = '';
        stage.appendChild(img);
      }
    }
    $('#media-dots').innerHTML = media.length > 1
      ? media.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('')
      : '';
  }

  renderChapters(l);

  const src = $('#detail-source');
  src.hidden = !l.source;
  if (l.source) src.href = l.source;

  show('detail');
}

/** Boutons de saut : Placement / Repere / Trajectoire / Resultat. */
function renderChapters(l) {
  const box = $('#chapters');
  box.innerHTML = '';

  const vid = $('#media-stage video');
  const chaps = (l.chapters || []).filter(c => typeof c.start === 'number');
  if (!vid || !chaps.length) return;

  const buttons = chaps.map(c => {
    const b = document.createElement('button');
    b.textContent = CHAP[c.name] || c.name;
    b.addEventListener('click', () => {
      vid.currentTime = c.start;
      vid.play().catch(() => { /* iOS peut refuser hors geste : sans importance */ });
    });
    box.appendChild(b);
    return b;
  });

  // le chapitre courant s'allume pendant la lecture
  vid.addEventListener('timeupdate', () => {
    let active = -1;
    chaps.forEach((c, i) => { if (vid.currentTime >= c.start) active = i; });
    buttons.forEach((b, i) => b.classList.toggle('on', i === active));
  });
}

/* points de pagination du carrousel */
$('#media-stage').addEventListener('scroll', () => {
  const st = $('#media-stage');
  const i = Math.round(st.scrollLeft / st.clientWidth);
  $$('#media-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
}, { passive: true });

/* ============================================================
   FORMULAIRE
   ============================================================ */

function openSheet(el) {
  $('#sheet-backdrop').hidden = false;
  el.hidden = false;
}
function closeSheets() {
  $('#sheet-backdrop').hidden = true;
  $('#sheet-form').hidden = true;
  $('#sheet-settings').hidden = true;
}

function segSet(container, value) {
  $$('.seg-b', container).forEach(b => b.classList.toggle('active', b.dataset.v === value));
}
const segGet = (container) => {
  const a = $('.seg-b.active', container);
  return a ? a.dataset.v : '';
};

function openForm(lineup) {
  state.editing = lineup || null;
  state.draftMedia = lineup ? JSON.parse(JSON.stringify(lineup.media || [])) : [];

  $('#form-title').textContent = lineup ? 'Modifier' : 'Nouveau lineup';
  $('#f-delete').hidden = !lineup;

  $('#f-title').value = lineup?.title || '';
  $('#f-map').value   = lineup?.map  || (state.scope.kind === 'map' ? state.scope.map : 'mirage');
  $('#f-side').value  = lineup?.side || 'T';
  $('#f-from').value  = lineup?.from || '';
  $('#f-to').value    = lineup?.to   || '';
  $('#f-notes').value = lineup?.notes || '';

  segSet($('#f-type'), lineup?.type || 'smoke');
  segSet($('#f-tech'), lineup?.tech || '');

  renderThumbs();
  openSheet($('#sheet-form'));
}

async function renderThumbs() {
  const box = $('#f-thumbs');
  box.innerHTML = '';
  for (let i = 0; i < state.draftMedia.length; i++) {
    const m = state.draftMedia[i];
    const d = document.createElement('div');
    d.className = 'th';

    if (m.kind === 'link') {
      d.innerHTML = `<div class="lk">${esc(m.url)}</div>`;
    } else {
      const url = await mediaURL(m.blobId);
      d.innerHTML = m.kind === 'video'
        ? `<video src="${url}" muted playsinline preload="metadata"></video>`
        : `<img src="${url}" alt="">`;
    }
    const rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'rm'; rm.innerHTML = '&times;';
    rm.onclick = () => { state.draftMedia.splice(i, 1); renderThumbs(); };
    d.appendChild(rm);
    box.appendChild(d);
  }
}

async function saveForm() {
  const title = $('#f-title').value.trim();
  const type  = segGet($('#f-type'));
  if (!title) { toast('Il manque le titre'); $('#f-title').focus(); return; }

  const lu = {
    id:    state.editing?.id || uid(),
    title,
    map:   $('#f-map').value,
    side:  $('#f-side').value,
    type,
    from:  $('#f-from').value.trim(),
    to:    $('#f-to').value.trim(),
    tech:  segGet($('#f-tech')),
    notes: $('#f-notes').value.trim(),
    media: state.draftMedia,
    // on ne perd pas ce que le formulaire n'expose pas
    chapters:  state.editing?.chapters || [],
    source:    state.editing?.source || '',
    credit:    state.editing?.credit || '',
    poster:    state.editing?.poster || '',
    favorite:  state.editing?.favorite || false,
    createdAt: state.editing?.createdAt || Date.now(),
  };

  // les medias retires du formulaire n'ont plus de raison d'occuper la place
  if (state.editing) {
    const kept = new Set(lu.media.filter(m => m.blobId).map(m => m.blobId));
    for (const m of (state.editing.media || [])) {
      if (m.blobId && !kept.has(m.blobId)) {
        await DB.deleteMedia(m.blobId);
        const u = urlCache.get(m.blobId);
        if (u) { URL.revokeObjectURL(u); urlCache.delete(m.blobId); }
      }
    }
  }

  await DB.putLineup(lu);
  await reload();
  closeSheets();

  if (state.current && state.current.id === lu.id) openDetail(lu.id);
  else renderList();

  toast(state.editing ? 'Modifie' : 'Lineup ajoute');
  state.editing = null;
}

/* ============================================================
   SAUVEGARDE / RESTAURATION
   ============================================================ */

const blobToDataURL = (blob) => new Promise((res) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.readAsDataURL(blob);
});

async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

async function exportBackup() {
  toast('Preparation...');
  const lineups = await DB.allLineups();
  const media   = await DB.allMedia();
  const out = { app: 'nadebook', version: 1, date: new Date().toISOString(), lineups, media: [] };

  for (const m of media) {
    out.media.push({ id: m.id, mime: m.mime, data: await blobToDataURL(m.blob) });
  }

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nadebook-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'nadebook') { toast('Fichier non reconnu'); return; }
    for (const m of (data.media || [])) {
      await DB.putMedia(m.id, await dataURLToBlob(m.data), m.mime);
    }
    for (const l of (data.lineups || [])) await DB.putLineup(l);
    await reload();
    renderMaps();
    closeSheets();
    toast((data.lineups || []).length + ' lineups importes');
  } catch (e) {
    toast('Import impossible');
  }
}

/**
 * Import d'un paquet prepare sur PC : le .json des fiches et les .mp4,
 * selectionnes ensemble depuis l'app Fichiers. Chaque fiche nomme son
 * fichier, on les rapproche par ce nom.
 * Les videos manquantes ne bloquent rien : la fiche est creee quand meme,
 * tu pourras y coller ton propre clip plus tard.
 */
async function importPack(files, lazyFetch) {
  const list = Array.from(files);
  const jsonFile = list.find(f => /\.json$/i.test(f.name));
  if (!jsonFile) { toast('Il manque le fichier .json'); return; }

  let data;
  try { data = JSON.parse(await jsonFile.text()); }
  catch { toast('JSON illisible'); return; }

  if (data.app === 'nadebook') return importBackup(jsonFile);   // sauvegarde classique
  if (data.app !== 'nadebook-import') { toast('Paquet non reconnu'); return; }

  const media = new Map(list.filter(f => f !== jsonFile).map(f => [f.name, f]));
  const lineups = data.lineups || [];
  const total = lineups.length;

  /* ---- Phase 1 : les fiches seules.
     Quelques Ko : c'est immediat et ca ne peut pas saturer le stockage.
     Si les videos echouent ensuite, l'app reste utilisable telle quelle. */
  toast('Import des fiches...', 0);
  const previous = new Map();
  try {
    for (const l of lineups) {
      const old = await DB.getLineup(l.id);
      previous.set(l.id, old);
      await DB.putLineup({
        id: l.id, title: l.title, map: l.map, side: l.side, type: l.type,
        from: l.from || '', to: l.to || '', tech: l.tech || '', notes: l.notes || '',
        chapters: l.chapters || [], source: l.source || '', credit: l.credit || '',
        // on reporte ce que la phase 2 n'a pas encore (re)pose,
        // sinon un import interrompu effacerait medias et miniatures
        media:  old ? (old.media || []) : [],
        poster: old ? (old.poster || '') : '',
        favorite:  old ? old.favorite  : false,
        createdAt: old ? old.createdAt : Date.now(),
      });
    }
  } catch (e) {
    console.error('[import] fiches', e);
    toast('Échec sur les fiches : ' + (e.name || e.message), 8000);
    await reload();
    return;
  }
  await reload();

  /* ---- Phase 2 : les videos, une par une.
     Chacune est isolee : une qui casse n'emporte pas les autres,
     et on sait laquelle et pourquoi. */
  let ok = 0, posters = 0, fail = 0, firstErr = null;

  /** Fichier issu du selecteur, sinon recupere a la demande. null si absent. */
  const grab = async (name) => {
    if (!name) return null;
    const direct = media.get(name);
    if (direct) return direct;
    if (!lazyFetch) return null;
    try { return await lazyFetch(name); }
    catch (e) {
      if (!firstErr) firstErr = e;
      console.error('[import] ' + name, e);
      return null;
    }
  };

  for (let i = 0; i < lineups.length; i++) {
    const l = lineups[i];

    // Video et miniature sont traitees separement : on peut donc renvoyer
    // un paquet de miniatures seules (quelques Mo) sans retransferer les
    // videos deja presentes sur l'appareil.
    const vid = await grab(l.file);
    const pos = await grab(l.poster);
    if (!vid && !pos) { if (l.file || l.poster) fail++; continue; }

    try {
      const cur = await DB.getLineup(l.id);
      if (!cur) continue;

      if (vid) {
        for (const m of cur.media || []) {
          if (m.blobId) await DB.deleteMedia(m.blobId);     // remplacement propre
        }
        const bid = uid();
        await DB.putMedia(bid, vid, vid.type || 'video/mp4');
        cur.media = [{ kind: 'video', blobId: bid }];
        ok++;
      }

      if (pos) {
        if (cur.poster) await DB.deleteMedia(cur.poster);
        const pid = uid();
        await DB.putMedia(pid, pos, pos.type || 'image/jpeg');
        cur.poster = pid;
        posters++;
      }

      await DB.putLineup(cur);
    } catch (e) {
      fail++;
      if (!firstErr) firstErr = e;
      console.error('[import] ' + l.id, e);
    }
    if (i % 3 === 0) toast(`Médias ${i + 1}/${total}...`, 0);
  }

  await reload();
  closeSheets();
  show('maps');

  const bilan = [
    `${total} fiches`,
    ok ? `${ok} vidéos` : '',
    posters ? `${posters} miniatures` : '',
  ].filter(Boolean).join(', ');

  if (!fail) {
    toast(bilan + ' — importé', 4500);
  } else {
    const txt = String(firstErr && (firstErr.name + ' ' + firstErr.message));
    const why = /quota|storage/i.test(txt) ? 'stockage saturé'
              : firstErr ? firstErr.name : 'erreur inconnue';
    toast(`${bilan} — ${fail} échec(s) (${why})`, 10000);
  }
}

/**
 * Import direct depuis le serveur local, pour tester sur PC sans passer
 * par le selecteur de fichiers. N'existe pas sur l'iPhone : la-bas,
 * media/ n'est pas publie (et ne doit pas l'etre).
 */
const isLocal = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function importLocal() {
  toast('Lecture du paquet...', 0);

  let text;
  try {
    const res = await fetch('data/nadebook-import.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (e) {
    console.error('[import] paquet', e);
    toast('Paquet illisible : ' + e.message, 8000);
    return;
  }

  // Le .json est passe comme fichier ; les videos seront tirees une par une.
  const jsonFile = new File([text], 'nadebook-import.json', { type: 'application/json' });

  // Sur un lot de plusieurs centaines de Mo, le navigateur lache
  // occasionnellement une requete (le fichier, lui, est intact).
  // Trois tentatives espacees suffisent a absorber ces ratés.
  await importPack([jsonFile], async (name, tries = 3) => {
    let last;
    for (let k = 1; k <= tries; k++) {
      try {
        const res = await fetch('media/' + name, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blob = await res.blob();
        const type = /\.jpe?g$/i.test(name) ? 'image/jpeg'
                   : /\.png$/i.test(name)   ? 'image/png'
                   : 'video/mp4';
        return new File([blob], name, { type });
      } catch (e) {
        last = e;
        if (k < tries) await new Promise(r => setTimeout(r, 400 * k));
      }
    }
    throw new Error(`media/${name} : ${last && last.message}`);
  });
}

/* ---------------- jeu d'exemple ---------------- */

const DEMO = [
  { map:'mirage',  side:'T',  type:'smoke', title:'Smoke Window',        from:'T Spawn',       to:'Window',        tech:'jump',    notes:'Colle-toi au coin gauche de la caisse, vise le sommet de l’antenne, jump-throw.' },
  { map:'mirage',  side:'T',  type:'smoke', title:'Smoke CT depuis Top Mid', from:'Top Mid',   to:'CT Spawn',      tech:'run',     notes:'Run-throw en sortant de mid, le smoke bloque la rotation CT.' },
  { map:'mirage',  side:'T',  type:'flash', title:'Pop-flash A Ramp',    from:'Palace',        to:'A Site',        tech:'stand',   notes:'Flash par-dessus le mur, sortie immediate derriere.' },
  { map:'mirage',  side:'CT', type:'molly', title:'Molo Under Palace',   from:'CT Spawn',      to:'Palace',        tech:'stand',   notes:'Retarde le rush palace en debut de round.' },
  { map:'dust2',   side:'T',  type:'smoke', title:'Smoke Cross Long',    from:'T Spawn',       to:'Long Cross',    tech:'jump',    notes:'Jump-throw depuis le coin, permet le cross safe vers Pit.' },
  { map:'dust2',   side:'T',  type:'molly', title:'Molo Pit',            from:'Long Doors',    to:'Pit',           tech:'stand',   notes:'Deloge le CT cache dans le Pit avant de prendre Long.' },
  { map:'inferno', side:'T',  type:'smoke', title:'Smoke CT depuis Banane', from:'Banana',     to:'CT Spawn',      tech:'runjump', notes:'Run + jump depuis la moitie de banane.' },
  { map:'inferno', side:'CT', type:'he',    title:'HE Banane',           from:'CT Banana',     to:'Banana',        tech:'run',     notes:'Combo avec la molo : degats garantis sur un rush.' },
];

async function loadDemo() {
  for (const d of DEMO) {
    await DB.putLineup({ ...d, id: uid(), media: [], favorite: false, createdAt: Date.now() });
  }
  await reload();
  renderMaps();
  closeSheets();
  toast('8 lineups d’exemple ajoutes');
}

/* ============================================================
   CHARGEMENT + BRANCHEMENT DES EVENEMENTS
   ============================================================ */

/**
 * Recharge les fiches depuis la base.
 * Le garde-fou temporel est la pour une raison precise : une connexion
 * IndexedDB morte ne rend jamais la main et ne leve aucune erreur.
 * Sans lui, l'app reste figee sans le moindre message.
 */
async function reload() {
  try {
    state.lineups = await Promise.race([
      DB.allLineups(),
      new Promise((_, rej) => setTimeout(
        () => rej(new Error('base de données bloquée')), 8000)),
    ]);
  } catch (e) {
    console.error('[reload]', e);
    toast('Stockage bloqué : ferme les autres onglets de l\'app, puis recharge.', 0);
    state.lineups = state.lineups || [];
  }
  renderMaps();
}

function wire() {

  /* --- vue maps --- */
  $('#map-grid').addEventListener('click', e => {
    const c = e.target.closest('.map-card');
    if (c) openList({ kind: 'map', map: c.dataset.map });
  });

  $$('.quick-card').forEach(b => b.addEventListener('click', () => {
    openList({ kind: b.dataset.quick });
  }));

  $('#btn-settings').addEventListener('click', async () => {
    const u = await DB.usage();
    const mo = (u.bytes / 1048576).toFixed(0);
    const part = u.quota
      ? ` sur ~${(u.quota / 1073741824).toFixed(1)} Go disponibles`
      : '';
    $('#storage-note').textContent =
      `${state.lineups.length} lineups, ${u.count} médias — ${mo} Mo${part}`;
    openSheet($('#sheet-settings'));
  });

  /* --- vue liste --- */
  $('#btn-back-maps').addEventListener('click', () => { renderMaps(); show('maps'); });

  $('#side-filter').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.side = c.dataset.side; syncChips(); renderList();
  });
  $('#type-filter').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    state.type = c.dataset.type; syncChips(); renderList();
  });
  $('#search').addEventListener('input', e => {
    state.query = e.target.value; renderList();
  });

  $('#viewmode').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.view = b.dataset.mode;
    applyView();
  });

  $('#lineup-list').addEventListener('click', e => {
    const c = e.target.closest('.lu');
    if (c) openDetail(c.dataset.id);
  });

  $('#btn-add').addEventListener('click', () => openForm(null));

  /* --- vue detail --- */
  $('#btn-back-list').addEventListener('click', () => {
    $$('#media-stage video').forEach(v => v.pause());
    state.current = null;
    show('list'); renderList();
  });

  $('#btn-fav').addEventListener('click', async () => {
    const l = state.current; if (!l) return;
    l.favorite = !l.favorite;
    await DB.putLineup(l);
    await reload();
    $('#btn-fav').classList.toggle('on', l.favorite);
    toast(l.favorite ? 'Ajoute aux favoris' : 'Retire des favoris');
  });

  $('#btn-edit').addEventListener('click', () => {
    if (state.current) openForm(state.current);
  });

  /* --- formulaire --- */
  $('#f-map').innerHTML = MAPS.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');

  $('#f-type').addEventListener('click', e => {
    const b = e.target.closest('.seg-b'); if (b) segSet($('#f-type'), b.dataset.v);
  });
  $('#f-tech').addEventListener('click', e => {
    const b = e.target.closest('.seg-b'); if (b) segSet($('#f-tech'), b.dataset.v);
  });

  $('#f-file').addEventListener('change', async e => {
    for (const file of e.target.files) {
      const id = uid();
      await DB.putMedia(id, file, file.type);
      state.draftMedia.push({
        kind: file.type.startsWith('video') ? 'video' : 'image',
        blobId: id,
      });
    }
    e.target.value = '';
    renderThumbs();
  });

  $('#f-link-btn').addEventListener('click', () => {
    const url = prompt('Colle le lien (YouTube, Imgur, Gfycat...)');
    if (url && url.trim()) {
      state.draftMedia.push({ kind: 'link', url: url.trim() });
      renderThumbs();
    }
  });

  $('#form-save').addEventListener('click', saveForm);
  $('#form-cancel').addEventListener('click', () => { state.editing = null; closeSheets(); });
  $('#sheet-backdrop').addEventListener('click', () => { state.editing = null; closeSheets(); });

  $('#f-delete').addEventListener('click', async () => {
    if (!state.editing) return;
    if (!confirm('Supprimer definitivement ce lineup ?')) return;
    await DB.deleteLineup(state.editing.id);
    state.editing = null; state.current = null;
    await reload();
    closeSheets();
    show('list'); renderList();
    toast('Supprime');
  });

  /* --- reglages --- */
  $('#set-close').addEventListener('click', closeSheets);
  if (isLocal()) {
    $('#btn-local').hidden = false;
    $('#btn-local').addEventListener('click', importLocal);
  }
  $('#bundle-file').addEventListener('change', e => {
    if (e.target.files.length) importPack(e.target.files);
    e.target.value = '';
  });
  $('#btn-export').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', e => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-demo').addEventListener('click', loadDemo);
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('Effacer TOUS les lineups et leurs medias ? Cette action est definitive.')) return;
    await DB.clearAll();
    urlCache.forEach(u => URL.revokeObjectURL(u));
    urlCache.clear();
    await reload();
    closeSheets();
    show('maps');
    toast('Tout a ete efface');
  });
}

/* ---------------- demarrage ---------------- */

(async function init() {
  wire();

  // Stockage persistant : quota plus large, et le navigateur ne purge
  // pas nos videos pour faire de la place. Refus = on continue quand meme.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  await reload();
  show('maps');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http simple : pas de hors-ligne */ });
  }
})();
