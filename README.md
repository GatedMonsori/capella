# Capella

> *Capella est l'étoile la plus brillante de la constellation **Auriga** (le Cocher) — de quoi éclairer Auriga.*

Extension Chrome qui remplace l'affichage des notes d'**Auriga** (plateforme Aurion d'EPITA) par une interface claire : arborescence semestre → UE → module avec les moyennes, et chaque épreuve rangée sous son module avec son type et son coefficient. Libellés Auriga traduits en français lisible.

## Comment ça marche

Auriga est une SPA Angular (produit **Aurion**) qui charge tout depuis une API JSON. L'extension :

1. **`src/capture.js`** (MAIN world, `document_start`) — intercepte `fetch`/`XHR` avant le boot d'Angular et enregistre les réponses JSON de l'API.
2. **`src/ui.js`** — reconstruit un bulletin propre à partir de deux endpoints :
   - `/api/menuEntries/1144/searchResult` → **moyennes** de chaque niveau (semestre/UE/module) — « Mes notes (synthèse) »
   - `/api/menuEntries/1036/searchResult` → **notes d'épreuves** avec coefficient (%) et type — « Mes notes (éval) »
   - `/api/me` et `/api/globalPreferences` → identité et année académique

Quand tu ouvres Auriga, l'interface **s'affiche automatiquement par-dessus**. Si les notes ne sont pas encore chargées, elle navigue toute seule (derrière l'overlay) vers les deux pages de notes pour les récupérer, puis les affiche.

## Fonctionnalités

- Vue **semestre → UE → module** dépliable, fusion des deux pages de notes.
- Moyennes déjà calculées par Auriga (finale / provisoire avant rattrapage), avec code couleur (/20).
- Épreuves rangées sous leur module : titre, **type** (Examen / Examen final / TP-Oral / Rattrapage…) et **coefficient**.
- Glossaire de traduction des termes Auriga (« Composant pédagogique » → « Module », etc.).
- Bouton **↻ Recharger**, **✕ Auriga original** (revenir à l'interface d'origine), onglet **Debug** (export JSON brut).

> Les moyennes affichées sont **celles calculées par Auriga**, pas des recalculs — donc fiables. Les **coefficients** (ECUE) et **ECTS** (UE) proviennent de `/api/obligations` (`obligationRelations[].coefficient`) et ont été **vérifiés au bulletin officiel** (syllabus S5/S6) : correspondance exacte. Le poids d'une UE dans le semestre = ses crédits ECTS. Le GPA n'est pas fourni par ces endpoints, donc non affiché.

## Installation (mode développeur)

1. Chrome → `chrome://extensions`
2. Active **Mode développeur** (haut à droite)
3. **Charger l'extension non empaquetée** → sélectionne le dossier `auriga-plus`
4. Ouvre https://auriga.epita.fr — l'interface Auriga+ apparaît

## Structure

```
auriga-plus/
├── manifest.json      # MV3, content scripts sur auriga.epita.fr
└── src/
    ├── capture.js     # MAIN world, document_start — hooke fetch/XHR
    ├── ui.js          # parse Aurion + rend le bulletin
    └── ui.css
```

## Programme-agnostique

Capella ne suppose rien du programme : il fonctionne pour n'importe quelle
formation EPITA (ING, Prépa, Bachelor Cyber 1/2, etc.), pas seulement Cyber FISA.

- **Structure** reconstruite à partir de `/api/obligations` (`obligationRelations` :
  parent → enfant + coefficient) — l'arbre officiel de chaque programme, sans
  aucune analyse de code. Repli sur un motif de code si les obligations ne sont
  pas encore chargées.
- **Pages de notes détectées par forme** (présence d'une colonne
  `obligationRelationParentCoefficient` → épreuves ; `caption` → synthèse), pas
  par identifiant de menu en dur.
- **Colonnes** lues via la métadonnée `columns` de l'API (aucun index codé en dur).
- Épreuves reliées à leur module par un code normalisé multi-filières
  (`normCode` : retire le jeton de filière FISA/FISE… et le suffixe d'épreuve).
