# Architecture cible

## Vue d’ensemble

Le bot sera organisé autour de cinq frontières :

1. **Discord adapter** : transforme les messages et événements Discord en entrées normalisées ;
2. **Agent loop** : construit le contexte, appelle le modèle et orchestre les tool calls ;
3. **Model provider** : client OpenAI-compatible configurable par variables d’environnement ;
4. **Tool registry** : expose des tools typés, validés et documentés au modèle ;
5. **Policies and observability** : permissions, confirmations, journaux, métriques et traçabilité.

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

## Providers

Le code dépend d’une interface OpenAI-compatible, pas d’un fournisseur concret. `OPENAI_BASE_URL` et `OPENAI_MODEL` permettent de passer d’Ollama en local à un endpoint hébergé sans modifier la logique métier.

## Tools et permissions

Chaque tool devra déclarer : nom, description, schéma d’entrée, schéma de sortie, niveau de risque, permissions Discord requises et besoin de confirmation. Les tools de lecture peuvent être automatiques ; les actions irréversibles (suppression, bannissement, modification de rôles, messages en masse) exigent une confirmation explicite et une journalisation.

## Mémoire et confidentialité

Le contexte doit être limité au serveur, au salon et à la conversation nécessaires. Les secrets, tokens et données sensibles ne doivent jamais entrer dans les prompts ni les logs. Toute mémoire persistante devra avoir une politique de rétention et une commande de suppression.

## Observabilité

Les logs structurés devront permettre de relier une requête Discord, un appel modèle et chaque tool call via un identifiant de corrélation, sans enregistrer les secrets ni le contenu sensible par défaut.
