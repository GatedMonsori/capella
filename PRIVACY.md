# Politique de confidentialité — Capella

_Dernière mise à jour : 2026_

Capella est une extension de navigateur qui réaffiche, de façon plus lisible, les
notes déjà présentes dans **Auriga** (la plateforme Aurion d'EPITA), uniquement sur
le domaine `https://auriga.epita.fr`.

## Ce que Capella lit

- Les données de notes que **ta propre session Auriga** a déjà chargées dans la page
  (moyennes, épreuves, coefficients).
- Ton arbre pédagogique et ses coefficients, via l'API interne d'Auriga
  (`/api/obligations`), en réutilisant **ta session déjà authentifiée** sur le même
  domaine.

## Ce que Capella stocke (localement, sur ton appareil)

- Tes **réglages de seuils** et le **cache des coefficients**, dans le `localStorage`
  du domaine `auriga.epita.fr`.
- Les notes hypothétiques du simulateur, en mémoire de la page uniquement.

## Ce que Capella NE fait PAS

- **Aucune donnée n'est transmise à un serveur tiers.** Rien n'est envoyé à l'auteur,
  ni à un service d'analyse, de publicité ou de suivi.
- Aucun identifiant, mot de passe ou jeton n'est enregistré durablement ni exfiltré.
  Le jeton de session d'Auriga n'est utilisé que pour des requêtes vers `auriga.epita.fr`
  lui-même (même origine), le temps de l'affichage.
- Aucune donnée ne quitte ton navigateur.

## Suppression des données

Désinstaller l'extension, ou vider le stockage du site `auriga.epita.fr`, efface tout
ce que Capella a enregistré.

## Divulgation

Capella est un projet **non officiel**, indépendant, **sans affiliation ni approbation**
d'EPITA ni d'Auriga/Aurion.

## Contact

Questions : ouvrir une _issue_ sur le dépôt du projet.
