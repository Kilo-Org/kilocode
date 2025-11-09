# Liste de tâches

**Vue d'ensemble** : Ne perdez plus jamais de vue les tâches de développement complexes. Les listes de tâches créent des listes de vérification interactives et persistantes qui vivent directement dans votre interface de chat.

**Pourquoi c'est important** : Les workflows complexes ont de nombreuses parties mobiles. Sans structure, il est facile de manquer des étapes, de dupliquer le travail ou d'oublier ce qui suit.

<img src="/docs/img/task-todo-list/task-todo-list-1.png" alt="Aperçu de la liste de tâches montrant une liste de vérification interactive dans Kilo Code" width="500" />

## Comment déclencher les listes de tâches

**Déclencheurs automatiques** :

- Tâches complexes avec plusieurs étapes
- Travail en mode Architecte
- Workflows multiphases avec dépendances

**Déclencheurs manuels** :

- Demandez à Kilo d'"utiliser l'[outil update_todo_list](/features/tools/update-todo-list)"
- Dites "créer une liste de tâches"

**En résumé** : Kilo décide ce qui va dans la liste, mais vous pouvez fournir des commentaires pendant les dialogues d'approbation.

---

## L'ancienne méthode vs la nouvelle méthode

**Avant** : Vous jongliez avec les étapes des tâches dans votre tête ou des notes dispersées, vous demandant constamment "quoi ensuite ?"

**Maintenant** : Kilo crée des listes de vérification structurées qui se mettent à jour automatiquement au fur et à mesure que le travail progresse. Vous voyez exactement où vous en êtes et ce qui va suivre.

---

## Où apparaissent les listes de tâches

**1. Résumé de l'en-tête de tâche**
Aperçu rapide des progrès avec votre prochain élément important

<img src="/docs/img/task-todo-list/task-header.png" alt="Résumé de l'en-tête de tâche montrant les progrès de la liste de tâches" width="500" />

**2. Bloc d'outil interactif**
Interface complète des tâches dans le chat où vous pouvez :

- Voir tous les éléments et leur statut
- Modifier les descriptions lorsque Kilo demande une approbation
- Préparer les modifications en utilisant le bouton "Modifier"

**3. Détails de l'environnement**
Tableau "RAPPELS" en arrière-plan qui maintient Kilo informé des progrès actuels

## Statuts de tâche décodés

**En attente** → Case à cocher vide (non démarré)

<img src="/docs/img/task-todo-list/not-started.png" alt="Élément de tâche en attente avec case à cocher vide" width="300" />

---

**En cours** → Point jaune (travail en cours)

<img src="/docs/img/task-todo-list/in-progress.png" alt="Élément de tâche en cours avec indicateur de point jaune" width="300" />

---

**Terminé** → Coche verte (fini)

<img src="/docs/img/task-todo-list/complete.png" alt="Élément de tâche terminé avec coche verte" width="300" />

---

## Questions fréquentes

**"Puis-je créer mes propres listes de tâches ?"**
Oui, demandez simplement à Kilo d'utiliser l'outil update_todo_list. Mais Kilo garde le contrôle du contenu et du workflow.

**"Que faire avec les tâches simples ?"**
Kilo ignore généralement les listes de tâches pour les tâches simples. La surcharge n'en vaut pas la peine.

**"Pourquoi ne puis-je pas modifier directement la liste ?"**
Choix de conception. Kilo maintient l'autorité sur la gestion des tâches pour assurer un suivi cohérent des progrès. Vous fournissez l'entrée, Kilo exécute.

---

:::tip

## Astuce de pro : Auto-approbation

**Ce qu'il fait** : Approuve automatiquement les mises à jour de la liste de tâches sans invites de confirmation.

**Quand l'utiliser** : Workflows longs où les interruptions constantes vous ralentissent.

**Comment l'activer** : Cochez les [paramètres d'auto-approbation de la mise à jour de la liste de tâches](/features/auto-approving-actions#update-todo-list).

**L'inconvénient** : Moins de contrôle, mais exécution plus rapide.

:::
