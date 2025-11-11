---
sidebar_label: Votre première tâche
---

# Démarrer votre première tâche avec Kilo Code

<YouTubeEmbed
  url="https://www.youtube.com/watch?v=pO7zRLQS-p0"
/>

Ce guide rapide montre comment Kilo Code gère une simple demande du début à la fin.

Après avoir [configuré Kilo Code](/getting-started/setting-up), suivez ces étapes :

## Étape 1 : Ouvrir le panneau Kilo Code

Cliquez sur l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la barre latérale principale de VS Code (barre verticale sur le côté de la fenêtre) pour ouvrir l'interface de chat. Si vous ne voyez pas l'icône, vérifiez que l'extension est [installée](/getting-started/installing) et activée.

<img src="/docs/img/your-first-task/your-first-task.png" alt="Icône Kilo Code dans la barre latérale principale de VS Code" width="800" />

_L'icône Kilo Code dans la barre latérale principale ouvre l'interface de chat._

## Étape 2 : Saisir votre tâche

Saisissez une description claire et concise de ce que vous voulez que Kilo Code fasse dans la zone de chat en bas du panneau. Exemples de tâches efficaces :

- "Créer un fichier nommé `hello.txt` contenant 'Hello, world!'."
- "Écrire une fonction Python qui additionne deux nombres."
- "Créer un fichier HTML pour un site web simple avec le titre 'Test Kilo'"

Aucune commande ou syntaxe spéciale nécessaire — utilisez simplement l'anglais simple.

<img src="/docs/img/your-first-task/your-first-task-6.png" alt="Saisie d'une tâche dans l'interface de chat Kilo Code" width="500" />
*Saisissez votre tâche en langage naturel - aucune syntaxe spéciale requise.*

## Étape 3 : Envoyer votre tâche

Appuyez sur Entrée ou cliquez sur l'icône Envoyer (<Codicon name="send" />) à droite de la zone de saisie.

## Étape 4 : Examiner et approuver les actions

Kilo Code analyse votre demande et propose des actions spécifiques. Celles-ci peuvent inclure :

- **Lecture de fichiers :** Affiche le contenu des fichiers auxquels il doit accéder
- **Écriture dans les fichiers :** Affiche un diff avec les changements proposés (lignes ajoutées en vert, supprimées en rouge)
- **Exécution de commandes :** Affiche la commande exacte à exécuter dans votre terminal
- **Utilisation du navigateur :** Décrit les actions du navigateur (clic, saisie, etc.)
- **Poser des questions :** Demande des clarifications lorsque nécessaire pour procéder

<img src="/docs/img/your-first-task/your-first-task-7.png" alt="Examen d'une action de création de fichier proposée" width="400" />
*Kilo Code montre exactement quelle action il veut effectuer et attend votre approbation.*

- En mode **Code**, les capacités d'écriture sont activées par défaut.
- En modes **Architecte** et **Ask**, Kilo Code n'écrira pas de code.

:::tip

Le niveau d'autonomie est configurable, vous permettant de rendre l'agent plus ou moins autonome.

Vous pouvez en savoir plus sur [l'utilisation des modes](/basic-usage/using-modes) et [l'auto-approbation des actions](/features/auto-approving-actions).

:::

## Étape 5 : Itérer

Kilo Code fonctionne de manière itérative. Après chaque action, il attend votre retour avant de proposer l'étape suivante. Continuez ce cycle d'examen-approbation jusqu'à ce que votre tâche soit terminée.

<img src="/docs/img/your-first-task/your-first-task-8.png" alt="Résultat final d'une tâche terminée montrant le processus d'itération" width="500" />
*Après avoir terminé la tâche, Kilo Code affiche le résultat final et attend votre prochaine instruction.*

## Conclusion

Vous avez terminé votre première tâche. Au cours du processus, vous avez appris :

- Comment interagir avec Kilo Code en utilisant le langage naturel
- Pourquoi l'approbation vous maintient le contrôle
- Comment l'itération permet à l'IA d'affiner son travail

Prêt pour plus ? Explorez différents [modes](/basic-usage/using-modes) ou essayez [l'auto-approbation](/features/auto-approving-actions) pour accélérer les tâches répétitives.
