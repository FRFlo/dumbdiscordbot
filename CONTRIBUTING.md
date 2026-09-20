# Contribuer

Merci de contribuer à `dumbdiscordbot`.

## Préparer l’environnement

```bash
bun install
cp .env.example .env
bun run check
```

Utilise une branche courte basée sur `develop`, par exemple `feat/tool-reminders` ou `fix/context-limit`.

## Pull requests

- explique le problème et la solution ;
- garde les changements ciblés ;
- ajoute ou mets à jour les tests lorsque le comportement change ;
- documente les impacts sur permissions, secrets et données ;
- vérifie `bun run check` avant de soumettre la PR ;
- utilise `bun run format` pour appliquer le formatage Oxfmt et `bun run lint`
  pour lancer Oxlint séparément.

Les actions sensibles doivent rester refusées par défaut et nécessiter une confirmation explicite.

## Ajouter un tool

Ajoute un fichier dans `src/tools/` ou dans un sous-dossier métier. Exporte un tool TanStack AI par défaut, ou un tableau de tools si le fichier représente un groupe cohérent. Le registre le découvrira automatiquement au démarrage ; il ne faut pas modifier le bootstrap.

## Commits

Privilégie des messages impératifs et descriptifs, par exemple `feat: ajouter le contrat des tools`. Une PR doit être relisible et réversible.
