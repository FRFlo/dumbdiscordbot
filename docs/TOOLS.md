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
- `automation` : rappels temporisés en mémoire ;
- `members` : profils, recherche et gestion des membres ;
- `channel-settings` : paramètres et overwrites des salons ;
- `threads` : membres, adhésion et gestion des threads ;
- `forums` : publications et tags des forums ;
- `invites` : création, consultation et suppression des invitations ;
- `webhooks` : cycle de vie des webhooks ;
- `roles` : rôles et membres associés ;
- `moderation-bulk` : bannissements, timeouts groupés et pruning ;
- `automod` : règles AutoMod ;
- `expressions` : emojis et stickers ;
- `voice` : salons vocaux et instances Stage ;
- `publishing` : publication, embeds et sondages ;
- `ecosystem` : heure, tâches persistantes, envois planifiés et crons ;
- `operations` : planification persistante, opérations longues, recherche,
  permissions, audit, simulation et état des limites.

Le registre publie également une catégorie dérivée et des tags (`sector-scoped`,
`destructive`, `requires-approval`) dans son catalogue interne.

## Approbations

Les tools de lecture, les actions réversibles et les opérations usuelles ne
bloquent pas sur une approbation. Les opérations à impact très élevé gardent
une protection côté serveur : suppression de messages/salons/rôles/événements,
ban, kick, unban, suppression groupée et départ d'un serveur.

Pour les actions sensibles mais réversibles, le modèle peut appeler le tool
`approval` dans le code TypeScript généré lorsqu'il estime qu'une confirmation
utilisateur est nécessaire. Une approbation renvoie un jeton éphémère limité à
plusieurs actions et à la liste exacte des cibles de chacune. Le même
`approvalToken` peut donc être transmis à plusieurs tools différents sans
afficher une nouvelle demande Discord. Chaque tool vérifie et consomme sa
propre cible individuellement.
Le prompt agentique lui demande explicitement de ne pas demander d'approbation
par défaut pour les lectures et actions courantes.

## Isolation

Les tools de serveur utilisent le `guildId` du contexte Discord courant. Un
identifiant de serveur différent est refusé, ce qui prépare la sectorisation
future. Les accès passent par `discord-runtime.ts`; aucun tool ne reçoit un
accès implicite au réseau ou au système de fichiers.

Les arguments `guildId` et `channelId` acceptent également la valeur
`"current"`. Elle résout automatiquement le serveur ou le salon du message
courant, y compris depuis le code exécuté dans Code Mode.

Les catégories disposent de tools dédiés pour les lister, les récupérer, les
créer, les modifier, les déplacer et les supprimer. La suppression d'une
catégorie reste protégée par une approbation ciblée.

Les tools avancés n'exposent jamais les tokens de webhook. La création ou
l'envoi d'un webhook doit utiliser un secret fourni explicitement et ne doit
pas être recopié dans une réponse, un prompt ou un journal.

## Écosystème et planification

Les tools `ecosystem` persistent leurs tâches dans SQLite et les restaurent au
redémarrage du bot. `schedule_discord_message` accepte une date ISO avec
fuseau et vise l'exécution exacte à cette date. `create_cron_job` utilise une
expression cron à cinq champs (`minute heure jour mois semaine`), un fuseau IANA
et peut ajouter un délai avant l'envoi. Ce délai permet par exemple de
déclencher le cron à 17:30 puis de programmer automatiquement l'envoi à 18:00.

Un cron peut aussi exécuter directement un prompt avec `actionType:
"invoke_agent"`, ou exécuter un script QuickJS isolé avec `actionType:
"execute_script"`. Le script ne dispose ni du filesystem ni du réseau : il
reçoit uniquement `send_message`, `get_current_time` et `invoke_agent`. Le
nombre d'invocations de l'agent est plafonné par `maxAgentCalls` (maximum 3),
ce qui permet de conditionner un appel dans le script sans créer de boucle
agentique illimitée.

Toutes les planifications (`schedule_action`, `schedule_persistent_action` et
les nouveaux tools écosystème) passent par l'API native `Bun.cron`. Les tâches
à exécution unique sont représentées par un cron Bun arrêté après son premier
déclenchement.

Les scripts cron restent volontairement limités aux bindings explicitement
exposés ; les tâches arbitraires ne sont pas exécutées depuis SQLite.

## Permissions Discord

Le bot doit disposer des intents privilégiés et permissions correspondant aux
tools réellement utilisés. Les intents membres, modération, réactions,
événements planifiés et contenu des messages sont activés dans le client ; ils
doivent également être activés dans le portail développeur Discord.
