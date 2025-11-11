# switch_mode

L'outil `switch_mode` permet à Kilo Code de changer entre différents Modes opérationnels, chacun avec des capacités spécialisées pour des types spécifiques de tâches. Cela permet des transitions fluides entre les Modes comme Code, Architect, Ask, ou Debug quand la tâche actuelle nécessite une expertise différente.

## Paramètres

L'outil accepte ces paramètres :

- `mode_slug` (requis) : Le slug du Mode vers lequel basculer (par ex., "code", "ask", "architect")
- `reason` (optionnel) : La raison de changer de Mode, fournissant du contexte pour l'utilisateur

## Ce qu'il fait

Cet outil demande un changement de Mode quand la tâche actuelle serait mieux gérée par les capacités d'un autre Mode. Il maintient le contexte tout en shiftant le focus de Kilo Code et les ensembles d'outils disponibles pour correspondre aux exigences de la nouvelle phase de tâche.

## Quand est-il utilisé ?

- Quand transitionner de la collecte d'informations vers l'implémentation de code
- Quand passer du codage vers l'architecture ou le design
- Quand la tâche actuelle nécessite des capacités seulement disponibles dans un Mode différent
- Quand une expertise spécialisée est nécessaire pour une phase particulière d'un projet complexe

## Caractéristiques Clés

- Maintient la continuité de contexte à travers les transitions de Mode
- Fournit un raisonnement clair pour les recommandations de changement de Mode
- Nécessite l'approbation utilisateur pour tous les changements de Mode
- Applique les restrictions de groupe d'outils spécifiques à chaque Mode
- Adapte parfaitement la disponibilité d'outils basée sur le Mode sélectionné
- Fonctionne avec les Modes standard et personnalisés
- Affiche le changement de Mode et le raisonnement dans l'UI
- Utilise le formatage de style XML pour la spécification de paramètres
- Gère les restrictions de type de fichier spécifiques à certains Modes

## Limitations

- Ne peut pas basculer vers des Modes qui n'existent pas dans le système
- Nécessite l'approbation utilisateur explicite pour chaque transition de Mode
- Ne peut pas utiliser les outils spécifiques à un Mode jusqu'à ce que le basculement soit complet
- Applique un délai de 500ms après le changement de Mode pour permettre au changement de prendre effet
- Certains Modes ont des restrictions de type de fichier (par ex., le Mode Architect peut seulement éditer les fichiers markdown)
- La préservation de Mode pour la reprise s'applique seulement à la fonctionnalité `new_task`, pas au changement de Mode général

## Comment ça fonctionne

Quand l'outil `switch_mode` est invoqué, il suit ce processus :

1. **Validation de Requête** :

    - Valide que le Mode demandé existe dans le système
    - Vérifie que le paramètre `mode_slug` est fourni et valide
    - Vérifie que l'utilisateur n'est pas déjà dans le Mode demandé
    - S'assure que le paramètre `reason` (si fourni) est correctement formaté

2. **Préparation de Transition de Mode** :

    - Empaquette la requête de changement de Mode avec la raison fournie
    - Présente la requête de changement à l'utilisateur pour approbation

3. **Activation de Mode (Upon Approbation Utilisateur)** :

    - Met à jour l'UI pour refléter le nouveau Mode
    - Ajuste les outils disponibles basés sur la configuration de groupe d'outils du Mode
    - Applique le prompt et comportement spécifiques au Mode
    - Applique un délai de 500ms pour permettre au changement de prendre effet avant d'exécuter le prochain outil
    - Applique toute restriction de fichier spécifique au Mode

4. **Continuation** :
    - Continue avec la tâche en utilisant les capacités du nouveau Mode
    - Conserve le contexte pertinent de l'interaction précédente

## Association de Groupe d'Outils

L'outil `switch_mode` appartient au groupe d'outils "modes" mais est aussi inclus dans la liste d'outils "toujours disponibles". Cela signifie :

- Il peut être utilisé dans n'importe quel Mode indépendamment des groupes d'outils configurés du Mode
- Il est disponible alongside d'autres outils de base comme `ask_followup_question` et `attempt_completion`
- Il permet des transitions de Mode à n'importe quel point dans un workflow quand les exigences de tâche changent

## Structure de Mode

Chaque Mode dans le système a une structure spécifique :

- `slug` : Identifiant unique pour le Mode (par ex., "code", "ask")
- `name` : Nom d'affichage pour le Mode (par ex., "Code", "Ask")
- `roleDefinition` : Le rôle spécialisé et les capacités du Mode
- `customInstructions` : Instructions optionnelles spécifiques au Mode qui guident le comportement
- `groups` : Groupes d'outils disponibles pour le Mode avec restrictions optionnelles

## Capacités de Mode

Les Modes de base fournissent ces capacités spécialisées :

- **Mode Code** : Concentré sur les tâches de codage avec accès complet aux outils d'édition de code
- **Mode Architect** : Spécialisé pour la conception système et la planification d'architecture, limité à l'édition de fichiers markdown seulement
- **Mode Ask** : Optimisé pour répondre aux questions et fournir des informations
- **Mode Debug** : Équipé pour le diagnostic systématique de problèmes et la résolution

## Modes Personnalisés

Au-delà des Modes de base, le système supporte des Modes personnalisés spécifiques au projet :

- Les Modes personnalisés peuvent être définis avec des groupes d'outils spécifiques activés
- Ils peuvent spécifier des définitions de rôle et instructions personnalisées
- Le système vérifie d'abord les Modes personnalisés avant de retomber sur les Modes de base
- Les définitions de Mode personnalisé prennent priorité sur les Modes de base avec le même slug

## Restrictions de Fichier

Différents Modes peuvent avoir des restrictions de type de fichier spécifiques :

- **Mode Architect** : Peut seulement éditer les fichiers correspondant à l'extension `.md`
- Essayer d'éditer des types de fichier restreints résulte en une `FileRestrictionError`
- Ces restrictions aident à appliquer une séparation appropriée des préoccupations entre Modes

## Exemples d'Utilisation

- En discutant d'une nouvelle fonctionnalité, Kilo Code passe du Mode Ask au Mode Architect pour aider à concevoir la structure système.
- Après avoir complété la planification d'architecture en Mode Architect, Kilo Code passe au Mode Code pour implémenter les fonctionnalités conçues.
- En rencontrant des bogues pendant le développement, Kilo Code passe du Mode Code au Mode Debug pour un dépannage systématique.

## Exemples d'Usage

Basculer vers le Mode Code pour l'implémentation :

```
<switch_mode>
<mode_slug>code</mode_slug>
<reason>Avoir besoin d'implémenter la fonctionnalité de connexion basée sur l'architecture dont nous avons discuté</reason>
</switch_mode>
```

Basculer vers le Mode Architect pour le design :

```
<switch_mode>
<mode_slug>architect</mode_slug>
<reason>Avoir besoin de concevoir l'architecture système avant l'implémentation</reason>
</switch_mode>
```

Basculer vers le Mode Debug pour le dépannage :

```
<switch_mode>
<mode_slug>debug</mode_slug>
<reason>Avoir besoin de diagnostiquer systématiquement l'erreur d'authentification</reason>
</switch_mode>
```

Basculer vers le Mode Ask pour les informations :

```
<switch_mode>
<mode_slug>ask</mode_slug>
<reason>Avoir besoin de répondre aux questions sur la fonctionnalité implémentée</reason>
</switch_mode>
```
