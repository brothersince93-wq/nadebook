# Nade Book — tes lineups CS2 sur iPhone

Une app perso pour retrouver instantanément tes lineups de grenades Counter-Strike 2,
triés par **map**, par **side (T / CT)** et par **type (Smoke / Flash / Molo / HE)**.

C'est une **PWA** : une app web qui s'installe sur l'écran d'accueil de l'iPhone.
Une fois installée elle se lance en plein écran, sans barre Safari, et fonctionne
**hors ligne** — pratique en LAN ou dans le métro.

---

## 1. Tester sur le PC (30 secondes)

```bash
node dev-server.js
```

Puis ouvre `http://localhost:5173`. Dans Chrome, `F12` → l'icône téléphone
(`Ctrl+Shift+M`) te donne un aperçu au format iPhone.

Va dans **Réglages ⚙️ → « Charger 8 lineups d'exemple »** pour voir à quoi
ça ressemble une fois rempli.

---

## 2. L'installer sur l'iPhone

L'iPhone exige du **HTTPS** pour installer une PWA. Le plus simple et gratuit :
**GitHub Pages**.

```bash
git init
git add .
git commit -m "Nade Book"
```

Crée ensuite un dépôt sur github.com (mets-le en **privé** si tu veux, Pages
fonctionne quand même sur les comptes gratuits), puis :

```bash
git remote add origin https://github.com/TON-PSEUDO/nadebook.git
git branch -M main
git push -u origin main
```

Sur GitHub : **Settings → Pages → Source : Deploy from a branch → `main` / `/ (root)`**.
Au bout d'une minute ton app est en ligne sur `https://TON-PSEUDO.github.io/nadebook/`.

Sur l'iPhone, **dans Safari** (obligatoire — Chrome iOS ne sait pas le faire) :

1. Ouvre cette adresse
2. Bouton **Partager** (le carré avec la flèche)
3. **« Sur l'écran d'accueil »**
4. L'icône apparaît. Lance-la : plein écran, comme une vraie app.

---

## 3. Remplir l'app

Bouton **+** en bas à droite d'une map.

| Champ | À quoi ça sert |
|---|---|
| **Titre** | Ce que tu lis en premier dans la liste. Ex. « Smoke Window jump-throw » |
| **Map / Side** | Les deux filtres principaux |
| **Type** | Smoke, Flash, Molo, HE — code couleur dans toute l'app |
| **Depuis → Vers** | Le trajet de la grenade. C'est ce qui te fait retrouver un lineup en un coup d'œil |
| **Technique** | Statique, Jump-throw, Run-throw, Run+Jump, Walk-throw |
| **Notes** | Le repère visuel exact (« aligner le coin du toit sur le crosshair ») |
| **Médias** | Autant de vidéos / GIF / images que tu veux, ou un lien YouTube |

Tu peux mélanger : une image du point de visée **et** un clip vidéo sur la même fiche.
Le détail les affiche en carrousel (glisse horizontalement).

### Comment produire les clips

- **Sur PC** : `Win + Alt + R` (Xbox Game Bar) enregistre CS2. Découpe le clip
  à 3–5 secondes, c'est largement suffisant pour un lineup.
- **Transfert vers l'iPhone** : envoie-toi les `.mp4` par Telegram / WhatsApp /
  Google Drive / iCloud, enregistre-les dans Photos, puis dans l'app :
  **+ → Fichiers → Photothèque**.
- **Alternative sans vidéo** : une simple capture d'écran du point de visée +
  une note précise suffit très souvent, et pèse 100× moins lourd.

---

## 3 bis. Le pipeline csnades.app

Les clips de **Mirage, Dust2, Inferno et Ancient** ont été autorisés par les auteurs
du site pour un **usage strictement personnel**. Ils ne doivent jamais être
republiés — `.gitignore` bloque `media/`, `data/` et tout `.mp4`.

```bash
node tools/fetch-index.js      # 1. l'index des 368 lineups (métadonnées seules)
```

Puis `http://localhost:5173/tools/picker.html` pour choisir : filtres, aperçu
vidéo, cases à cocher. Le bouton **Enregistrer la sélection** écrit `data/selection.json`.

```bash
node tools/fetch-videos.js     # 2. télécharge la sélection dans media/
node tools/fetch-videos.js --hevc   # variante ~2x plus légère, sauts plus précis
```

Sortie : les clips dans `media/`, une miniature `.jpg` par clip, et les fiches
dans `data/nadebook-import.json`. Le script est reprenable — relancé, il ne
retélécharge pas ce qui est déjà là et ne régénère que les miniatures absentes.

### Pourquoi les miniatures sont prises au milieu du lineup

La première image d'un clip montre le joueur au spawn : elle est identique pour
tous les lineups d'une même map. Impossible d'y distinguer « T Spawn 1 » de
« T Spawn 9 ».

Chaque clip porte un chapitre `lineup` — l'instant où le crosshair est posé sur
le repère de visée. La miniature est extraite au **milieu de ce segment**, ce qui
donne une image franchement différente pour chaque position de départ.
Le calcul est dans `posterTime()` (`tools/fetch-videos.js`) ; à défaut de
chapitre, il retombe sur 40 % de la durée.

### Transférer sur l'iPhone

1. Copie `media/` **et** `data/nadebook-import.json` dans iCloud Drive
   (ou Google Drive / OneDrive).
2. Sur l'iPhone, **installe d'abord l'app sur l'écran d'accueil**, et ouvre-la
   depuis l'icône — pas depuis l'onglet Safari. Le stockage des deux peut être
   séparé : importer dans le mauvais te ferait recommencer.
3. **Réglages → Importer un paquet** → sélectionne le `.json` **et** tous les
   `.mp4` en une fois. L'app apparie chaque fiche à son fichier par le nom.

Les vidéos sans fiche sont ignorées, les fiches sans vidéo sont créées quand même
(tu pourras y coller ton propre clip plus tard).

## 4. Sauvegarder (important)

Tes lineups sont stockés **uniquement sur ton iPhone** (IndexedDB). Rien ne part
sur Internet — ce qui est bien pour la vie privée, mais ça veut dire que si tu
effaces l'app ou les données Safari, tout part.

**Réglages ⚙️ → Exporter une sauvegarde** produit un `.json` qui contient tout,
médias compris. Garde-le dans iCloud Drive. **Importer une sauvegarde** le restaure
(sur un nouveau téléphone, par exemple).

> Note : l'export embarque les vidéos en base64, le fichier peut donc devenir gros.
> Si tu accumules beaucoup de clips, exporte de temps en temps plutôt qu'à chaque ajout.

---

## 5. Structure du projet

```
index.html            écrans (maps, liste, détail, formulaire, réglages)
css/style.css         tout le style
js/db.js              stockage IndexedDB (fiches + fichiers)
js/app.js             logique : filtres, rendu, formulaire, sauvegarde
sw.js                 service worker → fonctionne hors ligne
manifest.webmanifest  nom, icône, mode plein écran
icons/                icônes générées (180 / 192 / 512 px)
dev-server.js         serveur local pour tester sur le PC
```

Aucune dépendance, aucun build, aucun `npm install`. Du HTML, du CSS et du JS.
Tu peux ouvrir n'importe quel fichier et modifier directement.

### Modifications faciles

- **Ajouter une map** → `js/app.js`, tableau `MAPS` en haut du fichier.
- **Changer les couleurs** → `css/style.css`, bloc `:root` (`--c-smoke`, `--accent`…).
- **Ajouter un type de grenade** (Decoy) → objet `TYPES` dans `app.js`,
  plus un bouton dans `index.html` et une couleur dans le CSS.

Après chaque modif : `git add . && git commit -m "..." && git push`,
GitHub Pages se met à jour tout seul en ~1 minute. Sur l'iPhone, ferme et
rouvre l'app pour récupérer la nouvelle version.
