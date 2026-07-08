# Contribuer à Capella

## Utiliser l'extension (pas besoin de compte)

Aucun accès au dépôt n'est nécessaire pour l'utiliser. Il suffit de :

1. Télécharger le code (bouton **Code → Download ZIP**, ou `git clone`).
2. `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée** → dossier `capella`.

## Proposer une modification

Personne ne peut **pousser** directement sur ce dépôt : seuls les collaborateurs
explicitement ajoutés par le propriétaire en ont le droit. Pour proposer un
changement :

1. **Fork** le dépôt (ton propre copie sur ton compte).
2. Commit sur ta copie.
3. Ouvre une **Pull Request** — elle devra être relue et acceptée par le
   propriétaire avant d'être fusionnée.

## Style de code

Capella est écrit en JavaScript (extension Chrome MV3). Le style s'inspire des
principes de code sûr appliqués en cours (EPITA C coding style, NASA « Power of
Ten », JSF) — adaptés au JavaScript :

- **Fonctions courtes** à responsabilité unique (idéalement < 60 lignes).
- **Pas de nombre magique** : constantes nommées en haut du fichier.
- **Valider les entrées** et vérifier les valeurs de retour ; échouer proprement
  (l'extension ne doit jamais casser la page Auriga — tout est sous `try/catch`).
- **Portée minimale** : déclarer les variables au plus près de leur usage.
- **Zéro avertissement** : le code doit passer `npm run lint` (ESLint) et
  `npm run format:check` (Prettier) sans erreur.

### Outils

```bash
npm install       # installe eslint + prettier (dev only)
npm run lint      # analyse statique
npm run format    # reformate le code
```
