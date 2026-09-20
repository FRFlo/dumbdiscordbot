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
├── tools/             # registry et futurs tools agentiques
├── safety/            # politiques de risque et confirmations
├── domain/            # types métier indépendants de Discord
└── observability/     # logs et futures métriques
```

Les commandes et événements sont découverts dynamiquement au démarrage. Une commande exporte un objet typé contenant son builder Discord et son exécuteur ; un événement exporte son nom, son caractère unique (`once`) et sa fonction `execute`. Cette convention facilite l’ajout de modules sans modifier le bootstrap.

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

## Providers

Le code dépend d’une interface OpenAI-compatible, pas d’un fournisseur concret. `OPENAI_BASE_URL` et `OPENAI_MODEL` permettent de passer d’Ollama en local à un endpoint hébergé sans modifier la logique métier.

## Tools et permissions

Chaque tool devra déclarer : nom, description, schéma d’entrée, schéma de sortie, niveau de risque, permissions Discord requises et besoin de confirmation. Les tools de lecture peuvent être automatiques ; les actions irréversibles (suppression, bannissement, modification de rôles, messages en masse) exigent une confirmation explicite et une journalisation.

## Mémoire et confidentialité

Le contexte doit être limité au serveur, au salon et à la conversation nécessaires. Les secrets, tokens et données sensibles ne doivent jamais entrer dans les prompts ni les logs. Toute mémoire persistante devra avoir une politique de rétention et une commande de suppression.

## Observabilité

Les logs structurés devront permettre de relier une requête Discord, un appel modèle et chaque tool call via un identifiant de corrélation, sans enregistrer les secrets ni le contenu sensible par défaut.
