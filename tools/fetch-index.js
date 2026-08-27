/* ============================================================
   fetch-index.js — récupère l'index des lineups csnades.app
   pour les maps autorisées, et mesure le poids des vidéos.

   Usage :  node tools/fetch-index.js
            node tools/fetch-index.js --no-size   (saute la pesée)

   N'écrit qu'un fichier JSON dans data/. Ne télécharge aucune vidéo.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* Périmètre autorisé par les auteurs du site (usage personnel). */
const MAPS = ['mirage', 'dust2', 'inferno', 'ancient'];

const UA = 'NadeBook/1.0 (app perso, usage personnel)';
const OUT = path.join(__dirname, '..', 'data', 'csnades-index.json');

/* ---------- correspondances vers le schéma Nade Book ---------- */

const TYPE = { smoke: 'smoke', molotov: 'molly', flash: 'flash', he: 'he' };
const SIDE = { tt: 'T', ct: 'CT' };
const LABEL = { smoke: 'Smoke', molly: 'Molo', flash: 'Flash', he: 'HE' };

/** Les titres du site sont des slugs d'URL ("/dust2/goose-molotov-from-short").
 *  Les noms de position, eux, sont propres : on reconstruit un titre lisible.
 *  La provenance est deja affichee sous le titre, inutile de la repeter ici. */
function title(type, target, slug) {
  if (target) return `${LABEL[type] || ''} ${target}`.trim();
  const tail = String(slug || '').split('/').pop().replace(/-/g, ' ').trim();
  return tail ? tail[0].toUpperCase() + tail.slice(1) : 'Sans titre';
}

/** moveType + throwType -> une des techniques de l'app */
function tech(moveType, throwType) {
  const jump = /jumpthrow/i.test(throwType || '');
  if (moveType === 'walk') return 'walk';
  if (moveType === 'run')  return jump ? 'runjump' : 'run';
  return jump ? 'jump' : 'stand';   // still / special
}

/* ---------- récupération d'une map ---------- */

async function fetchMap(slug) {
  const res = await fetch('https://csnades.app/' + slug, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(slug + ' : HTTP ' + res.status);
  const html = await res.text();

  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error(slug + ' : __NEXT_DATA__ introuvable');

  const zipped = JSON.parse(m[1]).props.pageProps.nadesZipped;
  const json = zlib.gunzipSync(Buffer.from(zipped, 'base64')).toString('utf8');
  return JSON.parse(json);
}

/* ---------- normalisation ---------- */

const unknown = { type: new Set(), side: new Set() };

function normalise(nade, slug) {
  const d = nade.nadeData || {};
  const v = (nade.videos || [])[0] || null;

  if (d.nadeType && !TYPE[d.nadeType]) unknown.type.add(d.nadeType);
  if (d.baseTeam && !SIDE[d.baseTeam]) unknown.side.add(d.baseTeam);

  const type = TYPE[d.nadeType] || 'smoke';
  const from = (d.origin && (d.origin.originDisplayName || d.origin.name)) || '';
  const to   = (d.target && (d.target.targetDisplayName || d.target.name)) || '';

  return {
    srcId: nade.id,
    map:   slug,
    side:  SIDE[d.baseTeam] || 'T',
    type,
    title: title(type, to, nade.nadeName),
    slug:  nade.nadeName || '',
    from,
    to,
    tech:  tech(d.moveType, d.throwType),
    throwType: d.throwType || '',
    moveType:  d.moveType || '',
    description: nade.description || '',
    moments: (nade.moments || []).map(x => ({
      name: x.name, spot: x.spot, trajectory: x.trajectory,
      description: x.description, crosshairLineup: x.crosshairLineup,
    })),
    videoUrl:   v ? v.url : null,
    timestamps: v ? v.timestamps || null : null,
    sourceUrl: `https://csnades.app/${slug}/${nade.id}`,
    views: nade.viewCount || 0,
    favs:  nade.favouriteCount || 0,
  };
}

/* ---------- pesée des vidéos (requêtes HEAD, aucun octet de contenu) ---------- */

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return r.ok ? Number(r.headers.get('content-length') || 0) : 0;
  } catch { return 0; }
}

async function measure(items, concurrency = 8) {
  const targets = items.filter(i => i.videoUrl);
  let done = 0;
  const queue = targets.slice();

  const worker = async () => {
    while (queue.length) {
      const it = queue.shift();
      it.bytes = await head(it.videoUrl);
      if (++done % 25 === 0) process.stdout.write(`   pesée ${done}/${targets.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write(' '.repeat(30) + '\r');
}

/* ---------- programme principal ---------- */

const mo = (b) => (b / 1048576).toFixed(1);

(async () => {
  const all = [];

  for (const slug of MAPS) {
    process.stdout.write(`→ ${slug} ... `);
    const raw = await fetchMap(slug);
    const items = raw.map(n => normalise(n, slug));
    all.push(...items);
    console.log(`${items.length} lineups, ${items.filter(i => i.videoUrl).length} avec vidéo`);
  }

  if (!process.argv.includes('--no-size')) {
    console.log('\nPesée des vidéos (requêtes HEAD)...');
    await measure(all);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    source: 'https://csnades.app',
    note: 'Index recupere avec autorisation des auteurs, usage personnel uniquement.',
    maps: MAPS,
    fetchedAt: new Date().toISOString(),
    items: all,
  }, null, 1));

  /* ---- rapport ---- */
  console.log('\n' + '='.repeat(52));
  console.log(`${all.length} lineups   ->   ${path.relative(process.cwd(), OUT)}`);

  const byMap = {};
  for (const i of all) {
    const m = byMap[i.map] ||= { n: 0, bytes: 0, vids: 0 };
    m.n++; if (i.videoUrl) m.vids++; m.bytes += i.bytes || 0;
  }
  console.log('\nmap        lineups  videos    poids');
  for (const [k, v] of Object.entries(byMap)) {
    console.log(`${k.padEnd(10)} ${String(v.n).padStart(6)}  ${String(v.vids).padStart(6)}  ${(mo(v.bytes) + ' Mo').padStart(9)}`);
  }

  const sizes = all.map(i => i.bytes || 0).filter(Boolean).sort((a, b) => a - b);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (sizes.length) {
    console.log(`\nTOTAL      ${mo(total)} Mo  (${(total / 1073741824).toFixed(2)} Go)`);
    console.log(`moyenne ${mo(total / sizes.length)} Mo | median ${mo(sizes[sizes.length >> 1])} Mo`);
    console.log(`min ${mo(sizes[0])} Mo | max ${mo(sizes.at(-1))} Mo`);
  }

  const counts = (key) => Object.entries(all.reduce((a, i) => (a[i[key]] = (a[i[key]] || 0) + 1, a), {}))
    .map(([k, v]) => `${k}:${v}`).join('  ');
  console.log('\ntypes     ' + counts('type'));
  console.log('sides     ' + counts('side'));
  console.log('technique ' + counts('tech'));
  console.log('chapitres ' + all.filter(i => i.timestamps).length + ' lineups avec timecodes');

  if (unknown.type.size) console.log('\n! types inconnus :', [...unknown.type].join(', '));
  if (unknown.side.size) console.log('! sides inconnus :', [...unknown.side].join(', '));
})().catch(e => { console.error('\nERREUR :', e.message); process.exit(1); });
