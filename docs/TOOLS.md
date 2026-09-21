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

## Diffusion

Les tools d'envoi Discord utilisent une destination normalisée et unique dans
leur champ `channelId` :

- `discord:channel:<channelId>` : salon textuel ;
- `discord:channel:<channelId>:thread:<threadId>` : thread rattaché à ce salon (public, privé, annonce ou post de forum) ;
- `discord:dm:<userId>` : message privé à un membre du serveur courant (ou à
  l'auteur du message courant en contexte DM).
- `discord:group:<channelId>` : message privé de groupe déjà accessible au bot.

La valeur `current` représente le canal réellement utilisé par le déclencheur,
y compris un DM. Un identifiant brut reste accepté pour compatibilité. Les
identifiants doivent être des snowflakes Discord. Le serveur vérifie le type
envoyable du canal, la portée du serveur, la correspondance parent/thread et la
portée de l'utilisateur avant l'envoi. Les catégories, salons vocaux/stage et
racines de forums ne sont pas des cibles de messages directes. Les mentions
automatiques sont désactivées.

Les tools `send_message`, `reply_to_message` et `edit_message` acceptent les
options de contenu Discord en JSON : `content`, jusqu'à 10 `embeds`,
`components`, des `files` sous forme d'URL, `allowedMentions`, `poll` et
`tts`. Un message doit fournir au moins un de ces contenus. Les embeds suivent
le format Discord (`title`, `description`, `color`, `fields`, `author`, etc.).

## Questions et approbations

Le tool `question` permet quatre interactions Discord :

- `closed` : deux choix, avec bouton positif vert et bouton négatif/destructif rouge ;
- `single` : un menu de sélection avec un choix parmi des options décrites, avec une réponse `Autre` facultative ;
- `multiple` : un menu de sélection avec plusieurs choix parmi des options décrites, avec `Autre` facultatif ;
- `free` : réponse libre via une modale Discord.

La réponse est limitée à l'auteur et au salon du contexte courant. Les questions expirées,
annulées ou fermées au redémarrage renvoient `answered: false`.

Les tools de lecture, les actions réversibles et les opérations usuelles ne
bloquent pas sur une approbation. Les opérations à impact très élevé gardent
une protection côté serveur : suppression de messages/salons/rôles/événements,
ban, kick, unban, suppression groupée et départ d'un serveur.

Le tool `approval` utilise une question fermée Approuver/Refuser. Une approbation
renvoie un jeton éphémère limité à
plusieurs actions et à la liste exacte des cibles de chacune. Le même
`approvalToken` peut donc être transmis à plusieurs tools différents sans
afficher une nouvelle demande Discord. Chaque tool vérifie et consomme sa
propre cible individuellement.
Le prompt agentique lui demande explicitement de ne pas demander d'approbation
par défaut pour les lectures et actions courantes. Les actions sensibles peuvent
également déclencher automatiquement une approbation si aucun jeton n'est fourni.

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

## Addons d'événements Discord

`create_discord_event_addon` branche durablement une action sur un événement
`discord.js`, par exemple `messageCreate`, `guildMemberAdd` ou
`interactionCreate`. L'addon cible un salon du serveur courant et peut soit
invoquer l'agent avec un prompt, soit exécuter un script QuickJS isolé. Le
payload JSON de l'événement est ajouté au prompt de l'agent et est accessible
dans un script via `get_event_payload`.

Les scripts disposent aussi de `send_message`, `invoke_agent` et
`get_current_time`. `maxAgentCalls` borne les appels agent d'un script. Le
champ `once` retire l'addon après sa première occurrence. Les addons sont
persistés dans SQLite et peuvent être listés, mis en pause ou supprimés avec
`list_discord_event_addons` et `update_discord_event_addon_status`.

## Permissions Discord

Le bot doit disposer des intents privilégiés et permissions correspondant aux
tools réellement utilisés. Les intents membres, modération, réactions,
événements planifiés et contenu des messages sont activés dans le client ; ils
doivent également être activés dans le portail développeur Discord.
