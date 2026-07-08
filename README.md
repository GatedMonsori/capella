# Auriga+

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

> Les moyennes affichées sont **celles calculées par Auriga**, pas des recalculs — donc fiables. Les ECTS/GPA ne sont pas fournis par ces endpoints, donc non affichés (pas d'invention).

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

## Notes techniques

- Les codes Auriga encodent l'arborescence : `2526_BSI_CYBER_FISA_S05_CYBER_BK`
  = année 2025-26 / Bachelor cyber FISA / S05 / UE Cybersécurité / module Blockchain.
  L'arbre est reconstruit par préfixe ; les épreuves (`..._FISA_EXA_1`) sont reliées
  à leur module par un code normalisé (voir `normCode` dans `ui.js`).
- Colonnes lues dynamiquement via la métadonnée `columns` de l'API (pas d'index en dur).
