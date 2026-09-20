# Tools Discord

Les tools sont chargés automatiquement depuis `src/tools/` et utilisent
prioritairement l'API native de `discord.js` et les primitives Bun.

## Catégories

Les fichiers `discord-*.ts` constituent les catégories principales :

- `context` : contexte, serveurs, salons, membres, rôles et permissions ;
- `messages` : lecture, recherche, envoi, édition, suppression et réactions ;
- `channels` : salons, catégories et threads ;
- `interactions` : réactions et sondages ;
- `moderation` : membres, rôles et journal d'audit ;
- `events` : événements planifiés ;
- `media` : pièces jointes et fichiers ;
- `admin` : présence, statut et serveurs connectés ;
- `automation` : rappels temporisés en mémoire.

Le registre publie également une catégorie dérivée et des tags (`sector-scoped`,
`destructive`, `requires-approval`) dans son catalogue interne.

## Approbations

Les tools de lecture, les actions réversibles et les opérations usuelles ne
bloquent pas sur une approbation. Les opérations à impact très élevé gardent
une protection côté serveur : suppression de messages/salons/rôles/événements,
ban, kick, unban, suppression groupée et départ d'un serveur.

Pour les actions sensibles mais réversibles, le modèle peut appeler le tool
`approval` dans le code TypeScript généré lorsqu'il estime qu'une confirmation
utilisateur est nécessaire. Le prompt agentique lui demande explicitement de
ne pas demander d'approbation par défaut pour les lectures et actions courantes.

## Isolation

Les tools de serveur utilisent le `guildId` du contexte Discord courant. Un
identifiant de serveur différent est refusé, ce qui prépare la sectorisation
future. Les accès passent par `discord-runtime.ts`; aucun tool ne reçoit un
accès implicite au réseau ou au système de fichiers.

Les arguments `guildId` et `channelId` acceptent également la valeur
`"current"`. Elle résout automatiquement le serveur ou le salon du message
courant, y compris depuis le code exécuté dans Code Mode.

## Permissions Discord

Le bot doit disposer des intents privilégiés et permissions correspondant aux
tools réellement utilisés. Les intents membres, modération, réactions,
événements planifiés et contenu des messages sont activés dans le client ; ils
doivent également être activés dans le portail développeur Discord.

