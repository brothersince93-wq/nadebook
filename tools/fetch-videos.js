/* ============================================================
   fetch-videos.js — télécharge les clips sélectionnés et prépare
   le paquet à importer dans l'app.

   Usage :
     node tools/fetch-videos.js            garde les originaux (recommandé)
     node tools/fetch-videos.js --hevc     réencode en HEVC (~2x plus léger)
     node tools/fetch-videos.js --dry      montre ce qui serait fait

   Sortie :
     media/<id>.mp4              les clips
     data/nadebook-import.json   les fiches (métadonnées + chapitres)

   media/ et data/ sont dans .gitignore : ces fichiers ne doivent
   jamais partir sur un dépôt. Usage personnel uniquement.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const MEDIA = path.join(ROOT, 'media');
const DATA  = path.join(ROOT, 'data');

const HEVC = process.argv.includes('--hevc');
const DRY  = process.argv.includes('--dry');
const UA   = 'NadeBook/1.0 (app perso, usage personnel)';

const mo = b => (b / 1048576).toFixed(1);

/* ---------- lecture des entrées ---------- */

function read(file, hint) {
  const p = path.join(DATA, file);
  if (!fs.existsSync(p)) { console.error(`Manque ${path.relative(ROOT, p)} — ${hint}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const index = read('csnades-index.json', 'lance : node tools/fetch-index.js');
const sel   = read('selection.json',     'fais ta sélection dans tools/picker.html');

const byId = new Map(index.items.map(i => [i.srcId, i]));
const picked = sel.ids.map(id => byId.get(id)).filter(Boolean);

if (picked.length !== sel.ids.length) {
  console.warn(`! ${sel.ids.length - picked.length} id(s) de la sélection absents de l'index`);
}

/* ---------- conversion vers le schéma de l'app ---------- */

/** Les descriptions du site sont en Markdown. L'app affiche du texte brut :
 *  sans nettoyage on lirait "### Firebox Molotov" tel quel. */
function plain(s) {
  return String(s || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')        // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')     // liens -> libelle seul
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')          // titres
    .replace(/^\s{0,3}>\s?/gm, '')               // citations
    .replace(/^\s*[-*+]\s+/gm, '• ')             // puces
    .replace(/\*\*|__|`|~~/g, '')                // gras / code / barre
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toLineup(i) {
  // La technique exacte du lancer compte autant que le repère :
  // on la remonte en tête des notes plutôt que de la laisser enfouie.
  const notes = [
    i.throwType ? `Lancer : ${i.throwType}` : '',
    plain(i.description),
    // spot / trajectory / crosshairLineup sont des tableaux d'images,
    // pas du texte : seuls name et description sont exploitables ici.
    // un nom de moment seul ("while lineup") n'apprend rien : on ne
    // garde le moment que s'il porte une description.
    ...(i.moments || [])
      .filter(m => plain(m.description))
      .map(m => [m.name, plain(m.description)].filter(Boolean).join(' — ')),
  ].filter(Boolean).join('\n');

  const t = i.timestamps || {};
  const chap = ['walkup', 'lineup', 'trajectory', 'boom']
    .filter(k => t[k] && typeof t[k].start === 'number')
    .map(k => ({ name: k, start: +t[k].start.toFixed(2) }));

  return {
    id: 'csn-' + i.srcId,
    title: i.title || `${i.type} ${i.to}`,
    map: i.map, side: i.side, type: i.type, tech: i.tech,
    from: i.from, to: i.to,
    notes,
    chapters: chap,
    source: i.sourceUrl,
    credit: 'csnades.app',
    file: i.srcId + '.mp4',
    poster: fs.existsSync(path.join(MEDIA, i.srcId + '.jpg')) ? i.srcId + '.jpg' : '',
    favorite: false,
  };
}

/* ---------- téléchargement ---------- */

async function download(item) {
  const dest = path.join(MEDIA, item.srcId + '.mp4');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return { dest, skipped: true };

  const res = await fetch(item.videoUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return { dest, skipped: false };
}

/**
 * Instant a capturer pour la miniature.
 * La premiere image montre le joueur au spawn : identique pour tous les
 * clips d'une meme map. On prend le milieu du segment "lineup", ou le
 * crosshair est pose sur le repere — c'est ce qui distingue reellement
 * "T Spawn 1" de "T Spawn 9".
 */
function posterTime(ts, duration) {
  const seg = ts && ts.lineup;
  if (seg && typeof seg.start === 'number') {
    const { start } = seg;
    const end = (typeof seg.end === 'number' && seg.end > start && seg.end < 600)
      ? seg.end : start + 2;
    return +((start + end) / 2).toFixed(2);
  }
  return +((duration || 20) * 0.4).toFixed(2);   // a defaut, 40% du clip
}

function makePoster(file, at) {
  const out = file.replace(/\.mp4$/i, '.jpg');
  // -ss avant -i : recherche rapide, sans decoder tout le debut
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-ss', String(at), '-i', file,
    '-frames:v', '1', '-q:v', '4', '-vf', 'scale=480:-2', out]);
  return path.basename(out);
}

function transcode(file) {
  const tmp = file.replace(/\.mp4$/, '.hevc.mp4');
  // -g 15 : une image-cle toutes les ~0.5s. Les sorties OBS ont des
  // image-cles espacees de ~2s, donc un saut de chapitre peut tomber
  // jusqu'a 2s a cote. Densifier rend les sauts precis.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-c:v', 'libx265', '-crf', '28', '-preset', 'medium', '-g', '15',
    '-tag:v', 'hvc1', '-an', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, file);
}

/* ---------- programme principal ---------- */

(async () => {
  const totalBytes = picked.reduce((a, i) => a + (i.bytes || 0), 0);
  console.log(`${picked.length} lineups sélectionnés — ${mo(totalBytes)} Mo à télécharger`);
  const perMap = {};
  picked.forEach(i => perMap[i.map] = (perMap[i.map] || 0) + 1);
  console.log(Object.entries(perMap).map(([k, v]) => `${k}:${v}`).join('  ') + '\n');

  if (DRY) { picked.forEach(i => console.log(`  ${i.map.padEnd(8)} ${i.title}`)); return; }

  fs.mkdirSync(MEDIA, { recursive: true });

  let done = 0, failed = 0, skipped = 0, posters = 0;
  const queue = picked.slice();

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const r = await download(item);
        if (r.skipped) skipped++;
        else if (HEVC) transcode(r.dest);

        // miniature : generee si absente, y compris pour les clips deja la
        const jpg = r.dest.replace(/\.mp4$/i, '.jpg');
        if (!fs.existsSync(jpg)) {
          makePoster(r.dest, posterTime(item.timestamps, null));
          posters++;
        }
      } catch (e) {
        failed++;
        console.error(`  echec ${item.title} : ${e.message}`);
      }
      process.stdout.write(`  ${++done}/${picked.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  process.stdout.write(' '.repeat(24) + '\r');

  /* paquet d'import */
  const bundle = {
    app: 'nadebook-import',
    version: 1,
    createdAt: new Date().toISOString(),
    credit: 'Lineups et videos : csnades.app — utilises avec autorisation, usage personnel.',
    lineups: picked.map(toLineup),
  };
  fs.writeFileSync(path.join(DATA, 'nadebook-import.json'), JSON.stringify(bundle, null, 1));

  const onDisk = fs.readdirSync(MEDIA).filter(f => f.endsWith('.mp4'))
    .reduce((a, f) => a + fs.statSync(path.join(MEDIA, f)).size, 0);

  console.log('='.repeat(50));
  console.log(`${picked.length - failed} clips prets dans media/  (${mo(onDisk)} Mo${HEVC ? ', HEVC' : ', originaux'})`);
  if (posters) console.log(`${posters} miniatures generees (image du repere de visee)`);
  if (skipped) console.log(`${skipped} deja presents, non retelecharges`);
  if (failed)  console.log(`${failed} en echec`);
  console.log(`fiches : data/nadebook-import.json`);
  console.log(`\nchapitres disponibles sur ${bundle.lineups.filter(l => l.chapters.length).length} fiches`);
})();
