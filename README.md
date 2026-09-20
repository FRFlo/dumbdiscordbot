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

Le démarrage charge les commandes et événements depuis `src/commands/` et `src/events/`, connecte le client Discord, puis synchronise entièrement les commandes. La portée est globale par défaut ou limitée à `DISCORD_GUILD_ID` ; l’autre portée est vidée pour éviter les commandes obsolètes. Ne renseigne jamais de secret dans Git : `.env` est ignoré. Le provider et la boucle agentique sont encore une base d'architecture ; les tools métier viendront ensuite.

## Configuration IA

Les variables `OPENAI_BASE_URL`, `OPENAI_API_KEY` et `OPENAI_MODEL` permettent de cibler Ollama ou tout autre endpoint compatible. La valeur `ollama` pour la clé convient à un serveur local qui n’authentifie pas les requêtes ; utilise la clé exigée par ton provider en production.

Le Code Mode de TanStack AI utilise QuickJS natif via Bun pour exécuter le code généré dans un isolate limité. Les paramètres de sécurité sont configurables dans `.env` avec les variables `CODE_MODE_*`.

Sous macOS et Linux, le driver natif fonctionne directement. Sous Windows, le projet utilise automatiquement le driver QuickJS WASM portable, sauf si `QUICKJS_BUN_NATIVE_LIBRARY` pointe vers une DLL QuickJS compilée manuellement. Pour conserver le driver natif sans compiler de DLL, lance le bot dans l’image Linux avec Podman :

```bash
podman build -t dumbdiscordbot .
podman run --env-file .env dumbdiscordbot
```

Le conteneur reste recommandé pour la production et permet de conserver les limites natives `maxStackSize` et `maxToolCalls` du driver Bun.

### Approbations Code Mode

La fonction `approval` permet au code généré d'attendre une validation Discord avant une action sensible :

```ts
const result = await approval({
  description: "Envoyer un message dans #general",
});

if (result.approved) {
  // appeler ici le tool d'action
}
```

Les boutons sont valides pour l'auteur de la demande uniquement. La durée maximale
est contrôlée par `APPROVAL_TIMEOUT_MS` (20 secondes par défaut), et l'exécution
Code Mode doit rester inférieure à `CODE_MODE_TIMEOUT`. Cette version conserve
l'isolate vivant pendant l'attente : une interruption ou un redémarrage du bot
refuse automatiquement les approbations en attente.

## Persistance des sessions

Les conversations follow-up sont persistées dans SQLite via le module natif `bun:sqlite`. Le chemin par défaut est `./data/sessions.sqlite` et peut être changé avec `SESSION_DATABASE_PATH`.

Avec Podman, monte le dossier `data` pour conserver les sessions lors du remplacement du conteneur :

```bash
podman run --env-file .env -v "${PWD}/data:/app/data" dumbdiscordbot
```

## Observabilité PostHog

L’observabilité PostHog est activée lorsque `POSTHOG_API_KEY` est renseignée. Elle utilise les événements natifs [AI Observability](https://posthog.com/docs/ai-observability) (`$ai_trace`, `$ai_generation`, `$ai_span`) et [MCP Analytics](https://posthog.com/docs/mcp-analytics) (`$mcp_tool_call`) pour relier chaque demande Discord, génération et tool call dans une même trace. Les prompts, réponses et payloads de tools sont masqués par défaut.

```bash
POSTHOG_API_KEY=phc_...
POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_CAPTURE_AI_CONTENT=false
POSTHOG_CAPTURE_TOOL_PAYLOADS=false
```

Pour PostHog Cloud Europe, utilise `https://eu.i.posthog.com`. Les deux variables `POSTHOG_CAPTURE_*` peuvent être activées après revue des données sensibles. Le client est flushé lors de l’arrêt du bot. Consulte [la documentation d’architecture](docs/ARCHITECTURE.md) pour les événements suivis et les choix de confidentialité.

## Follow-up et silence

Une mention démarre une conversation temporaire par utilisateur et canal. Pendant `FOLLOW_UP_TIMEOUT_MS` (10 minutes par défaut), les messages suivants du même utilisateur sont transmis à l’agent sans nouvelle mention. L’agent reçoit aussi l’historique récent de cette conversation.

Si un follow-up ne s’adresse pas à l’agent, il doit répondre exactement `[SILENT]`. La couche Discord consomme alors ce marqueur sans envoyer de message et ferme immédiatement la conversation ; une nouvelle mention est nécessaire pour reprendre.

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
- [Tools Discord](docs/TOOLS.md)
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
