# update_todo_list

L'outil `update_todo_list` remplace la liste TODO entière avec une checklist mise à jour reflétant l'état actuel. Il fournit un suivi de tâches étape par étape, permettant la confirmation d'achèvement avant mise à jour et l'ajout dynamique de nouvelles tâches découvertes pendant les tâches complexes.

## Paramètres

L'outil accepte ces paramètres :

- `todos` (requis) : Une checklist markdown avec descriptions de tâches et indicateurs de statut

## Ce qu'il fait

Cet outil gère une liste TODO complète qui suit le progrès de tâche à travers différents états de statut. Il remplace la liste entière à chaque mise à jour, s'assurant que l'état actuel reflète précisément toutes les tâches en attente, en cours, et complétées. Le système affiche la liste TODO comme rappels dans les messages subséquents.

## Quand est-il utilisé ?

- Quand les tâches impliquent plusieurs étapes nécessitant un suivi systématique
- Quand de nouveaux éléments actionnables sont découverts pendant l'exécution de tâche
- Quand mettre à jour le statut de plusieurs tâches simultanément
- Quand les projets complexes bénéficient d'un suivi de progrès clair et étape par étape
- Quand organiser des workflows multi-phases avec des dépendances

## Caractéristiques Clés

- Maintient une checklist markdown à niveau unique avec trois états de statut
- Met à jour plusieurs statuts de tâche en une seule opération
- Ajoute dynamiquement de nouvelles tâches à mesure qu'elles sont découvertes pendant l'exécution
- Fournit un suivi de progrès visuel à travers des indicateurs de statut
- S'intègre avec le système de rappel pour une visibilité persistante de tâche
- Supporte la réorganisation de tâches basée sur la priorité d'exécution
- Conserve toutes les tâches non finies à moins qu'elles ne soient explicitement supprimées
- Permet des mises à jour de statut en lot efficaces

## Limitations

- Limité aux checklists à niveau unique (pas d'imbrication ou sous-tâches)
- Ne peut pas supprimer les tâches à moins qu'elles ne soient complétées ou plus pertinentes
- Nécessite un remplacement de liste complète plutôt que des mises à jour incrémentales
- Les changements de statut doivent être explicitement gérés à travers les appels d'outil
- Pas de suivi intégré de dépendances de tâches
- Ne peut pas planifier des tâches pour exécution future
- Limité à trois états de statut (en attente, en cours, complété)

## Indicateurs de Statut

L'outil utilise trois indicateurs de statut distincts :

- `[ ]` **En Attente** : Tâche pas encore démarrée
- `[-]` **En Cours** : Tâche présentement en cours de travail
- `[x]` **Complétée** : Tâche entièrement finie sans problèmes non résolus

## Comment ça fonctionne

Quand l'outil `update_todo_list` est invoqué, il suit ce processus :

1. **Validation de Statut** :

    - Parse le format de checklist markdown
    - Valide que les indicateurs de statut sont correctement formatés
    - S'assure que les descriptions de tâche sont claires et actionnables

2. **Remplacement de Liste** :

    - Remplace complètement la liste TODO existante
    - Conserve l'ordre de tâche comme spécifié dans la mise à jour
    - Maintient les descriptions de tâche et états de statut

3. **Intégration de Rappel** :

    - Intègre la liste mise à jour avec le système de rappel
    - Affiche les tâches actuelles dans les en-têtes de messages subséquents
    - Fournit une visibilité persistante du progrès de tâche

4. **Suivi de Progrès** :
    - Suit le statut d'achèvement à travers plusieurs mises à jour
    - Maintient l'historique de tâche pour référence
    - Supporte la continuation de workflow à travers les sessions

## Meilleures Pratiques

### Directives de Gestion de Tâche

- Marquer les tâches comme complétées immédiatement après que tout le travail soit fini
- Commencer la prochaine tâche en la marquant comme en cours
- Ajouter de nouvelles tâches dès qu'elles sont identifiées pendant l'exécution
- Utiliser des noms de tâche clairs et descriptifs qui indiquent des actions spécifiques
- Ordonner les tâches par séquence d'exécution logique ou priorité

### Motifs de Mise à jour de Statut

- Mettre à jour plusieurs statuts simultanément lors de la transition entre tâches
- Confirmer l'achèvement de tâche avant de la marquer comme finie
- Garder les tâches en cours concentrées sur le travail actuel
- Ajouter des tâches bloquantes quand des dépendances sont découvertes

### Quand Utiliser

Utilisez cet outil quand :

- La tâche implique plusieurs étapes ou nécessite un suivi continu
- De nouveaux éléments actionnables sont découverts pendant l'exécution de tâche
- Plusieurs tâches nécessitent des mises à jour de statut simultanément
- Les tâches complexes bénéficient d'une visualisation de progrès claire

Évitez d'utiliser quand :

- Il n'y a qu'une seule tâche triviale
- La tâche peut être complétée en une ou deux étapes simples
- La requête est purement conversationnelle ou informative

## Exemples d'Utilisation

- En implémentant une fonctionnalité multi-composants nécessitant des changements frontend, backend, et base de données
- En déboguant des problèmes qui révèlent plusieurs problèmes liés nécessitant des correctifs
- En configurant des environnements de développement avec plusieurs étapes de configuration
- En documentant des systèmes qui nécessitent des phases de recherche, écriture, et révision
- En refactorisant du code qui affecte plusieurs fichiers et nécessite des tests

## Exemples d'Usage

Répartition initiale de tâche :

```
<update_todo_list>
<todos>
[-] Analyser les exigences et créer une spécification technique
[ ] Concevoir le schéma de base de données et les points de terminaison API
[ ] Implémenter le service d'authentification backend
[ ] Créer les composants de connexion frontend
[ ] Écrire des tests complets
[ ] Mettre à jour la documentation
</todos>
</update_todo_list>
```

Mise à jour du progrès et ajout de tâches découvertes :

```
<update_todo_list>
<todos>
[x] Analyser les exigences et créer une spécification technique
[x] Concevoir le schéma de base de données et les points de terminaison API
[-] Implémenter le service d'authentification backend
[ ] Créer les composants de connexion frontend
[ ] Écrire des tests complets
[ ] Mettre à jour la documentation
[ ] Ajouter la fonctionnalité de réinitialisation de mot de passe
[ ] Implémenter la limitation de débit pour les tentatives de connexion
</todos>
</update_todo_list>
```

Compléter plusieurs tâches et transitionner le focus :

```
<update_todo_list>
<todos>
[x] Analyser les exigences et créer une spécification technique
[x] Concevoir le schéma de base de données et les points de terminaison API
[x] Implémenter le service d'authentification backend
[x] Créer les composants de connexion frontend
[-] Écrire des tests complets
[ ] Mettre à jour la documentation
[ ] Ajouter la fonctionnalité de réinitialisation de mot de passe
[ ] Implémenter la limitation de débit pour les tentatives de connexion
</todos>
</update_todo_list>
```
