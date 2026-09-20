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
- vérifie `bun run check` avant de soumettre la PR.

Les actions sensibles doivent rester refusées par défaut et nécessiter une confirmation explicite.

## Commits

Privilégie des messages impératifs et descriptifs, par exemple `feat: ajouter le contrat des tools`. Une PR doit être relisible et réversible.
