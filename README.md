# dumbdiscordbot

Bot Discord agentique piloté par IA, conçu pour interagir avec les membres via un provider de modèle **OpenAI-compatible** et exécuter des tools configurables.

> **État du projet : préparation.** Le dépôt contient l’architecture, les conventions et le squelette nécessaires. Le bot fonctionnel et ses tools seront implémentés dans une prochaine étape.

## Objectifs

- offrir une conversation naturelle avec un agent dans Discord ;
- laisser le modèle choisir des tools typés et contrôlés ;
- rendre le provider et le modèle interchangeables ;
- demander une confirmation avant toute action sensible ;
- conserver une base maintenable, testable et observable.

L’approche s’inspire d’**Hermes-Agent** : une boucle agentique reçoit le contexte, appelle éventuellement des tools, observe leurs résultats puis répond à l’utilisateur. Ce projet ne réutilise pas de code d’Hermes-Agent.

## Prérequis

- [Bun](https://bun.sh/) (`latest`) ;
- un bot Discord créé dans le [Developer Portal](https://discord.com/developers/applications) ;
- un serveur de modèle OpenAI-compatible. [Ollama](https://ollama.com/) est l’exemple local par défaut ; la couche IA est gérée par [TanStack AI](https://tanstack.com/ai).

## Démarrage du scaffold

```bash
bun install
cp .env.example .env
bun run check
bun run dev
```

Le démarrage charge les commandes et événements depuis `src/commands/` et `src/events/`, enregistre `/ping`, puis connecte le client Discord. Ne renseigne jamais de secret dans Git : `.env` est ignoré. Le provider et la boucle agentique sont encore une base d'architecture ; les tools métier viendront ensuite.

## Configuration IA

Les variables `OPENAI_BASE_URL`, `OPENAI_API_KEY` et `OPENAI_MODEL` permettent de cibler Ollama ou tout autre endpoint compatible. La valeur `ollama` pour la clé convient à un serveur local qui n’authentifie pas les requêtes ; utilise la clé exigée par ton provider en production.

Le Code Mode de TanStack AI utilise QuickJS natif via Bun pour exécuter le code généré dans un isolate limité. Les paramètres de sécurité sont configurables dans `.env` avec les variables `CODE_MODE_*`.

## Observabilité PostHog

L’observabilité PostHog est activée lorsque `POSTHOG_API_KEY` est renseignée. Elle suit les exécutions IA, les appels de tools, les durées, les erreurs et les erreurs globales de l’application. Les prompts et réponses ne sont pas envoyés par défaut ; seuls des métadonnées et compteurs sont capturés.

```bash
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com
```

Pour PostHog Cloud Europe, utilise `https://eu.i.posthog.com`. Le client est flushé lors de l’arrêt du bot. Consulte [la documentation d’architecture](docs/ARCHITECTURE.md) pour les événements suivis et les choix de confidentialité.

## Déploiement Docker

L’image est construite et publiée automatiquement dans GitHub Container Registry par [le workflow Docker](.github/workflows/docker.yml). Elle est disponible sous `ghcr.io/frflo/dumbdiscordbot` avec les tags de branche, de version et `latest` sur la branche par défaut.

Construire et lancer localement :

```bash
docker build -t dumbdiscordbot .
docker run --rm --env-file .env --restart unless-stopped dumbdiscordbot
```

Pour utiliser Ollama installé sur la machine hôte depuis Docker Desktop, définis `OPENAI_BASE_URL=http://host.docker.internal:11434/v1`. Le conteneur reçoit les secrets uniquement via son environnement ; aucune clé n’est intégrée à l’image.

## Documentation

- [Architecture et principes](docs/ARCHITECTURE.md)
- [Contribuer](CONTRIBUTING.md)
- [Sécurité](SECURITY.md)
- [Code de conduite](CODE_OF_CONDUCT.md)

## Roadmap indicative

1. définir le contrat des tools et les politiques de permissions ;
2. implémenter le client Discord et la boucle agentique ;
3. ajouter mémoire, confirmations et observabilité ;
4. couvrir les tools par des tests et un mode simulation ;
5. documenter le déploiement et les opérations.

## Licence

Aucune licence n’est appliquée pour le moment. Tous droits réservés jusqu’à décision ultérieure.
