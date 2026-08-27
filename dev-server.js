/* ============================================================
   dev-server.js — petit serveur local pour tester l'app
   Lancement :  node dev-server.js
   Puis ouvre  http://localhost:5173  dans ton navigateur.
   (aucune dépendance à installer)
   ============================================================ */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.gif':  'image/gif',
};

const handler = (req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);

  // Le sélecteur poste ici : la sélection atterrit dans data/selection.json,
  // directement lisible depuis le projet (pas de fichier à déplacer à la main).
  if (req.method === 'POST' && rel === '/api/selection') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, 'data', 'selection.json'), JSON.stringify(data, null, 1));
        console.log(`selection recue : ${(data.ids || []).length} lineups`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"ok":false}');
      }
    });
    return;
  }

  if (rel === '/') rel = '/index.html';

  const file = path.join(ROOT, rel);

  // on ne sort pas du dossier du projet
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Interdit'); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
};

/* Si le port est pris (une autre instance tourne deja), on ne plante pas
   avec une trace illisible : on essaie simplement les ports suivants. */
function listen(port, tries = 10) {
  const server = http.createServer(handler);
  server.once('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (tries <= 0) {
      console.error(`Ports ${PORT} a ${port} tous occupes.`);
      console.error(`Ferme l'autre serveur, ou choisis-en un : PORT=8080 node dev-server.js`);
      process.exit(1);
    }
    console.log(`  port ${port} occupe, essai sur ${port + 1}...`);
    listen(port + 1, tries - 1);
  });
  server.listen(port, () => {
    console.log('\n  Nade Book  ->  http://localhost:' + port);
    if (port !== Number(PORT)) console.log(`  (le port ${PORT} etait deja pris)`);
    console.log('');
  });
}

listen(Number(PORT));
