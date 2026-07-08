# Chrome Web Store — fiche & checklist de publication

Copier-coller pour le Developer Dashboard. **Non officiel** : ne pas utiliser les
logos EPITA/Auriga dans les visuels.

## Champs de la fiche

**Nom**

```
Capella — notes Auriga (EPITA)
```

**Résumé** (≤ 132 caractères)

```
Une vue claire de tes notes EPITA (Auriga) : arbre semestre/UE/module, moyennes, coefficients, ECTS et simulateur. Non officiel.
```

**Description**

```
Capella réaffiche tes notes Auriga (la plateforme Aurion d'EPITA) de façon lisible,
directement par-dessus le site.

• Arborescence claire semestre → UE → module, avec les moyennes déjà calculées par
  Auriga (donc fiables).
• Chaque épreuve rangée sous son module, avec son type et son coefficient.
• Coefficients et crédits ECTS affichés, plus le suivi des crédits validés.
• Seuils de validation modifiables (par défaut : matière ≥ 7, UE ≥ 10).
• Simulateur « what-if » : saisis des notes hypothétiques et vois tes moyennes UE,
  semestre et tes ECTS se recalculer en direct.
• Fonctionne pour n'importe quel programme EPITA (l'arbre et les coefficients sont
  lus depuis Auriga, sans hypothèse sur ta filière).

Confidentialité : Capella lit uniquement TES données déjà présentes dans Auriga et
ne transmet rien à l'extérieur. Tout reste dans ton navigateur. Voir la politique de
confidentialité.

Projet open-source et NON OFFICIEL : sans affiliation ni approbation d'EPITA ni
d'Auriga/Aurion. « Auriga » et « EPITA » ne sont cités que pour décrire la
compatibilité.
```

**Catégorie** : Productivité
**Langue** : Français
**URL politique de confidentialité** :
`https://github.com/GatedMonsori/capella/blob/main/PRIVACY.md`

## Justification des permissions (formulaire de review)

- **`content_scripts` limité à `https://auriga.epita.fr/*`** : l'extension n'agit
  que sur Auriga ; aucune permission d'hôte large, aucun `tabs`, aucun `storage` API
  (uniquement `localStorage` du site).
- **`world: "MAIN"`** : nécessaire pour lire les données JSON déjà chargées par
  l'application Angular d'Auriga et pour appeler son API interne (`/api/obligations`)
  avec la session de l'utilisateur, en même origine.
- **Pas de code distant** (conforme MV3), **aucune collecte ni transmission de
  données**, pas d'analytics.

## Divulgations « utilisation des données »

- Données personnelles (notes) : **traitées localement, non vendues, non transmises
  à des tiers**, non utilisées hors de la finalité (affichage des notes).
- Cocher : ne collecte pas / ne transmet pas de données utilisateur hors de l'appareil.

## Ce qu'il reste à fournir toi-même

- [ ] Compte développeur Chrome Web Store (frais unique de 5 $).
- [ ] **Au moins 1 capture d'écran 1280×800** (ex. la vue bulletin de Capella) —
      à prendre sur ton navigateur (impossible à générer automatiquement).
- [ ] (Optionnel) petite tuile promo 440×280.
- [ ] Uploader le ZIP de l'extension (voir `npm run pack` ou zipper le dossier).

## Icônes

`icons/icon128.png` (manifest) et `icons/icon512.png` (fiche / promo) sont fournis.
