# Architecture cible

## Vue d’ensemble

Le bot sera organisé autour de cinq frontières :

1. **Discord adapter** : transforme les messages et événements Discord en entrées normalisées ;
2. **Agent loop** : TanStack AI construit le contexte, gère le streaming et orchestre les tool calls ;
3. **Model provider** : adaptateur `openaiCompatibleText` de TanStack AI, configurable par variables d’environnement ;
4. **Tool registry** : expose des server tools TanStack AI typés, validés et documentés au modèle ;
5. **Policies and observability** : permissions, confirmations, journaux, métriques et traçabilité.

## Organisation des fichiers Discord

La structure reprend une organisation modulaire éprouvée pour Discord.js :

```text
src/
├── agent/             # boucle IA et orchestration des tool calls
├── commands/          # commandes slash, une commande par fichier
├── events/            # événements Discord, un événement par fichier
├── discord/
│   ├── client.ts      # création et collections du client
│   └── handlers/      # chargement dynamique commands/events/buttons
├── providers/         # implémentations OpenAI-compatible
├── tools/             # registry et tools agentiques
│   ├── registry.ts    # découverte et déduplication
│   ├── core.ts        # groupe de tools liés
│   └── <groupe>/      # tools organisés par domaine
├── safety/            # politiques de risque et confirmations
├── domain/            # types métier indépendants de Discord
└── observability/     # logs et futures métriques
```

Les commandes et événements sont découverts dynamiquement au démarrage. Une commande exporte un objet typé contenant son builder Discord et son exécuteur ; un événement exporte son nom, son caractère unique (`once`) et sa fonction `execute`. Cette convention facilite l'ajout de modules sans modifier le bootstrap.

Les tools suivent la même convention : tout fichier TypeScript sous `src/tools/` est chargé automatiquement. Il peut exporter un seul tool TanStack AI par défaut (fichier par tool) ou un tableau de tools cohérents (fichier par groupe). Les noms doivent être uniques ; le registre refuse les doublons avant le démarrage du bot.

Exemples :

```text
src/tools/
├── core.ts                 # export default [toolA, toolB]
├── moderation/
│   ├── ban.ts               # export default tool
│   └── warn.ts              # export default tool
└── server/
    └── information.ts      # export default tool
```

Chaque tool doit utiliser `toolDefinition()` avec des schémas d’entrée et de sortie Zod, puis `.server()` pour son implémentation. Les tools sensibles devront déclarer leur policy de permission et leur besoin de confirmation avant d’être ajoutés au registre.

La boucle ne doit jamais donner au modèle un accès implicite à Discord, au système de fichiers ou au réseau. Toute capacité passe par un tool explicite.

## Boucle agentique

```text
événement Discord
  → authentification et permissions
  → contexte limité et normalisé
  → modèle
  → réponse ou tool call
  → validation de policy + confirmation éventuelle
  → exécution isolée du tool
  → résultat borné ajouté au contexte
  → modèle jusqu'à réponse finale ou limite d'itérations
```

Chaque exécution doit avoir une limite de temps, une limite d’itérations et une taille maximale de contexte. Les erreurs de tools doivent être retournées comme données contrôlées, jamais comme stack traces au modèle ou à l’utilisateur.

## TanStack AI et Code Mode

Toute la couche IA passe par `@tanstack/ai`. Le provider `openaiCompatibleText` permet d’utiliser Ollama, vLLM, LM Studio ou un autre endpoint compatible sans dépendre directement du SDK OpenAI dans le code applicatif.

Les tools Discord seront déclarés avec `toolDefinition()` et implémentés côté serveur avec `.server()`. `createCodeMode()` les expose au modèle sous forme de fonctions TypeScript orchestrables. Le code généré est exécuté dans un isolate QuickJS natif Bun via `@tanstack/ai-isolate-quickjs-bun`, sans accès direct au filesystem, au réseau ou au processus hôte. Les limites `CODE_MODE_TIMEOUT`, `CODE_MODE_MEMORY_LIMIT`, `CODE_MODE_MAX_STACK_SIZE` et `CODE_MODE_MAX_TOOL_CALLS` doivent rester configurées en production.

Le driver natif Bun nécessite une DLL compilée manuellement sous Windows. Si `QUICKJS_BUN_NATIVE_LIBRARY` est absente, l’application bascule automatiquement vers `@tanstack/ai-isolate-quickjs` (WASM), avec les limites de temps et mémoire conservées. Pour utiliser exactement le driver natif sous Windows sans gérer cette DLL, lancer l’image Linux via Podman (`podman build -t dumbdiscordbot . && podman run --env-file .env dumbdiscordbot`).

## Providers

Le code dépend d’une interface OpenAI-compatible, pas d’un fournisseur concret. `OPENAI_BASE_URL` et `OPENAI_MODEL` permettent de passer d’Ollama en local à un endpoint hébergé sans modifier la logique métier.

## Tools et permissions

Chaque tool devra déclarer : nom, description, schéma d’entrée, schéma de sortie, niveau de risque, permissions Discord requises et besoin de confirmation. Les tools de lecture peuvent être automatiques ; les actions irréversibles (suppression, bannissement, modification de rôles, messages en masse) exigent une confirmation explicite et une journalisation.

## Mémoire et confidentialité

Le contexte doit être limité au serveur, au salon et à la conversation nécessaires. Les secrets, tokens et données sensibles ne doivent jamais entrer dans les prompts ni les logs. Toute mémoire persistante devra avoir une politique de rétention et une commande de suppression.

## Observabilité

Les logs structurés et PostHog permettent de relier une requête Discord, un appel modèle et chaque tool call via un identifiant de corrélation, sans enregistrer les secrets ni le contenu sensible par défaut.

PostHog utilise les événements natifs AI Observability : `$ai_trace` pour la demande agentique, `$ai_generation` pour la réponse du modèle et `$ai_span` pour chaque tool call. Les tools sont également publiés comme `$mcp_tool_call`, avec le nom, la durée, le statut, le modèle et l’intention utilisateur afin d’être visibles dans MCP Analytics. Le projet ne fournit pas encore de serveur MCP : ces événements appliquent le contrat MCP Analytics aux tools internes Code Mode pour observer leur usage de la même manière.

La corrélation utilise `$ai_trace_id`, `$ai_session_id` et `$mcp_conversation_id`. Les contenus sont masqués par défaut. `POSTHOG_CAPTURE_AI_CONTENT=true` capture le texte de la réponse et de la demande ; `POSTHOG_CAPTURE_TOOL_PAYLOADS=true` capture les arguments et résultats des tools. Ces options doivent être activées uniquement après revue de la confidentialité. PostHog est désactivé si `POSTHOG_API_KEY` est vide ; `disableGeoip` est activé.

## Follow-up et silence

`FollowUpState` conserve un état par triplet canal/utilisateur/serveur, avec l’historique des tours et la date de dernière activité. Une mention crée ou réinitialise cet état. Un message sans mention est transmis à l’agent seulement si l’état est encore actif ; la durée est configurée par `FOLLOW_UP_TIMEOUT_MS` et vaut 600 000 ms par défaut.

Pour permettre à l’agent de distinguer une réponse d’un message ambiant, le prompt impose le marqueur exact `[SILENT]` lorsqu’un follow-up ne lui est pas destiné. `messageCreate` ne publie jamais ce marqueur : il supprime l’état immédiatement, ce qui force une nouvelle mention pour reprendre la discussion. Une réponse normale est ajoutée à l’historique et prolonge la fenêtre d’activité.

## Exécution et déploiement

Le runtime officiel est Bun `1.3.14`, requis par le driver QuickJS natif utilisé par Code Mode. Le `Dockerfile` installe les dépendances de production, copie uniquement `src/` et exécute le bot avec l’utilisateur non privilégié `bun`. Le workflow GitHub Actions construit l’image sur les pull requests et la publie dans GHCR sur `develop`, `main` et les tags de version.
