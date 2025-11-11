# Nettoyage automatique

Le nettoyage automatique gère automatiquement votre historique de tâches en supprimant les anciennes tâches pour libérer de l'espace disque et améliorer les performances. Les tâches sont classées et conservées de manière intelligente en fonction de leur type et de leur âge, garantissant que le travail important est préservé tandis que les tâches temporaires ou expérimentales sont nettoyées.

:::warning Important
La suppression de tâches est permanente et ne peut être annulée. Les tâches supprimées sont complètement retirées du disque, y compris tout l'historique de conversation, les points de contrôle et les fichiers associés.
:::

## Vue d'ensemble

Au fur et à mesure que vous travaillez avec Kilo Code, chaque tâche crée des fichiers contenant l'historique de conversation, les points de contrôle et autres données. Avec le temps, cela s'accumule et peut consommer un espace disque considérable. Le nettoyage automatique résout ce problème en :

- **Supprimant automatiquement les anciennes tâches** en fonction des périodes de rétention configurables
- **Préservant les tâches importantes** en les classant en différents types
- **Protégeant les tâches favorites** de la suppression
- **Gérant l'utilisation du disque** sans intervention manuelle

:::info Avantages clés

- **Libérer de l'espace disque** : Supprimer automatiquement les anciennes données de tâches
- **Améliorer les performances** : Réduire la taille de l'historique des tâches
- **Contrôle flexible** : Configurer différentes périodes de rétention pour différents types de tâches
- **Sécurité d'abord** : Les tâches favorites peuvent être protégées de la suppression
- **Manuel possible** : Exécuter le nettoyage manuellement chaque fois que nécessaire
  :::

## Fonctionnement du nettoyage automatique

Le nettoyage automatique utilise un système de classification intelligent pour déterminer combien de temps chaque tâche doit être conservée :

### Classification des tâches

Chaque tâche est automatiquement classée dans l'une de ces catégories :

| Type de tâche   | Description                                      | Rétention par défaut                         |
| --------------- | ------------------------------------------------ | -------------------------------------------- |
| **Favoris**     | Tâches que vous avez marquées comme favorites    | Jamais supprimées (ou 90 jours si configuré) |
| **Terminées**   | Tâches qui se sont terminées avec succès         | 30 jours                                     |
| **Incomplètes** | Tâches qui ont été commencées mais pas terminées | 7 jours                                      |
| **Régulières**  | Classification par défaut pour les autres tâches | 30 jours                                     |

#### Compréhension de l'achèvement des tâches

Une tâche est considérée comme "terminée" lorsque Kilo Code utilise l'outil [`attempt_completion`](../features/tools/attempt-completion) pour la marquer formellement comme terminée. Les tâches sans ce marqueur d'achèvement sont classées comme incomplètes, même si vous les considérez comme terminées. Cette distinction aide à nettoyer plus agressivement les tâches abandonnées ou expérimentales.

### Processus de nettoyage

Lorsque le nettoyage automatique s'exécute, il :

1. **Analyse toutes les tâches** dans votre historique de tâches
2. **Classifie chaque tâche** en fonction de ses propriétés et de son statut d'achèvement
3. **Vérifie les périodes de rétention** pour déterminer l'éligibilité à la suppression
4. **Protège les tâches actives** actuellement utilisées
5. **Supprime les tâches éligibles** et leurs fichiers associés
6. **Rapporte les résultats** incluant l'espace disque libéré

## Configuration

Accédez aux paramètres de nettoyage automatique via le panneau de paramètres de Kilo Code :

1. Cliquez sur l'icône d'engrenage (<i class="codicon codicon-gear"></i>) dans Kilo Code
2. Naviguez vers la section **Nettoyage automatique** (sous Points de contrôle)

### Activer le nettoyage automatique

<img src="/docs/img/auto-cleanup/settings.png" alt="Panneau des paramètres de nettoyage automatique" width="600" />

Cochez l'option **"Activer le nettoyage automatique des tâches"** pour activer la fonctionnalité. Lorsqu'il est activé, les tâches seront automatiquement supprimées en fonction de vos paramètres de rétention.

### Paramètres de période de rétention

Configurez la durée de conservation des différents types de tâches avant le nettoyage :

#### Période de rétention par défaut

```
Par défaut : 30 jours
Minimum : 1 jour
```

Définit la période de rétention de base pour les tâches régulières qui ne tombent pas dans d'autres catégories.

#### Tâches favorites

**Ne jamais supprimer les tâches favorites** (recommandé)

Lorsqu'il est activé, les tâches favorites sont préservées indéfiniment quel que soit leur âge. C'est l'option la plus sûre pour prévenir la suppression accidentelle de travail important.

S'il est désactivé, vous pouvez définir une période de rétention personnalisée :

```
Par défaut : 90 jours
Minimum : 1 jour
```

Pour mettre une tâche en favori, utilisez l'icône étoile dans le panneau de l'historique des tâches.

#### Tâches terminées

```
Par défaut : 30 jours
Minimum : 1 jour
```

Les tâches terminées avec succès via l'outil [`attempt_completion`](../features/tools/attempt-completion) sont conservées pendant cette période. Ces tâches représentent typiquement un travail terminé qui peut encore être utile pour référence.

#### Tâches incomplètes

```
Par défaut : 7 jours
Minimum : 1 jour
```

Les tâches sans statut d'achèvement sont conservées pendant une période plus courte. Cela aide à nettoyer plus rapidement les tâches expérimentales ou abandonnées tout en vous donnant encore le temps de les examiner.

### Affichage du dernier nettoyage

Les paramètres indiquent quand la dernière opération de nettoyage s'est exécutée, vous aidant à comprendre le calendrier de nettoyage.

### Nettoyage manuel

Cliquez sur le bouton **"Exécuter le nettoyage maintenant"** pour déclencher immédiatement une opération de nettoyage en utilisant vos paramètres actuels. Ceci est utile lorsque :

- Vous devez libérer de l'espace disque urgemment
- Vous avez changé les paramètres de rétention et voulez qu'ils soient appliqués immédiatement
- Vous voulez prévisualiser ce qui serait nettoyé (vérifiez la sortie)

## Meilleures pratiques

### Périodes de rétention recommandées

**Pour les développeurs individuels :**

- Rétention par défaut : 30 jours
- Tâches terminées : 30 jours
- Tâches incomplètes : 7 jours
- Tâches favorites : Ne jamais supprimer

**Pour l'expérimentation :**

- Rétention par défaut : 14 jours
- Tâches terminées : 14 jours
- Tâches incomplètes : 3 jours
- Tâches favorites : Ne jamais supprimer

**Pour un espace disque limité :**

- Rétention par défaut : 14 jours
- Tâches terminées : 14 jours
- Tâches incomplètes : 3 jours
- Tâches favorites : 60 jours

### Protection du travail important

Pour assurer que les tâches importantes ne soient jamais supprimées :

1. **Marquez les tâches comme favorites** en utilisant l'icône étoile dans l'historique des tâches
2. **Activez "Ne jamais supprimer les tâches favorites"** dans les paramètres
3. **Révisez les résultats de nettoyage** périodiquement pour assurer que les périodes de rétention sont appropriées

### Équilibre entre espace disque et historique

Considérez ces facteurs lors du réglage des périodes de rétention :

- **Espace disque disponible** : Rétention plus courte si l'espace est limité
- **Fréquence des tâches** : Plus de tâches = rétention plus courte nécessaire
- **Besoins de référence** : Conservez les tâches terminées plus longtemps si vous y faites souvent référence
- **Expérimentation** : Rétention plus courte pour les tâches incomplètes lors d'expérimentation intensive

## Dépannage

### Les tâches ne sont pas nettoyées

**Problème** : Les anciennes tâches restent après l'exécution du nettoyage

**Solutions** :

1. Vérifiez que le nettoyage automatique est activé dans les paramètres
2. Vérifiez les périodes de rétention - elles peuvent être trop longues
3. Vérifiez que les tâches sont plus anciennes que la période de rétention
4. Vérifiez si les tâches sont en favori (elles ne seront pas supprimées si "Ne jamais supprimer" est activé)

### Une tâche importante a été supprimée

**Problème** : Une tâche dont vous aviez besoin a été retirée

**Prévention** :

1. Mettez toujours les tâches importantes en favori avant qu'elles n'expirent
2. Définissez des périodes de rétention plus longues pour les types de tâches que vous référencez fréquemment
3. Envisagez d'activer "Ne jamais supprimer les tâches favorites"
4. Exportez ou sauvegardez les données de tâches critiques avant qu'elles n'expirent

:::warning
Les tâches supprimées ne peuvent pas être récupérées. Mettez toujours les tâches importantes en favori ou ajustez les périodes de rétention pour prévenir la suppression accidentelle.
:::

### Le nettoyage utilise trop d'E/S disque

**Problème** : L'opération de nettoyage impacte les performances du système

**Solutions** :

1. Vérifiez la "Durée de l'opération" dans les résultats de nettoyage
2. Si c'est lent, envisagez de réduire les périodes de rétention pour nettoyer moins de tâches à la fois
3. Exécutez le nettoyage manuel pendant les heures non travaillées
4. Assurez des ressources système adéquates pendant le nettoyage

### Protection des tâches actives

Le nettoyage automatique protège automatiquement votre tâche actuellement active de la suppression, même si elle répond aux critères d'âge. Cela assure que vous ne perdez jamais le travail en cours pendant une opération de nettoyage.

## Détails techniques

### Ce qui est supprimé

Lorsqu'une tâche est supprimée, les éléments suivants sont définitivement retirés :

- Répertoire de la tâche et tout son contenu
- Historique de conversation et messages
- Points de contrôle (si activés)
- Journaux de requêtes API
- Métadonnées de la tâche
- Fichiers temporaires associés

### Emplacement de stockage

Les données des tâches sont stockées dans votre emplacement de stockage global VS Code :

- **macOS** : `~/Library/Application Support/Code/User/globalStorage/kilocode.kilo-code/`
- **Windows** : `%APPDATA%\Code\User\globalStorage\kilocode.kilo-code\`
- **Linux** : `~/.config/Code/User/globalStorage/kilocode.kilo-code/`

## Confidentialité et gestion des données

- **Opération locale** : Tout le nettoyage se produit localement sur votre machine
- **Aucune sauvegarde cloud** : Les tâches supprimées ne sont pas sauvegardées automatiquement
- **Télémétrie** : Des statistiques d'utilisation anonymes (tâches nettoyées, espace disque libéré) sont collectées si la télémétrie est activée
- **Aucun partage de contenu** : Le contenu des tâches, le code ou les informations personnelles ne sont jamais transmis

## Fonctionnalités connexes

- [**Points de contrôle**](../features/checkpoints) : Contrôle de version pour les tâches qui peuvent être restaurées
- [**Gestion des paramètres**](../features/settings-management) : Exporter/importer les paramètres incluant la configuration de nettoyage
- [**Historique des tâches**](../basic-usage/the-chat-interface) : Gérer et organiser votre historique de tâches

## Questions fréquentes

### Le nettoyage automatique s'exécute-t-il automatiquement ?

Oui, lorsqu'il est activé, le nettoyage automatique s'exécute automatiquement en fonction du calendrier configuré. Vous pouvez également le déclencher manuellement en utilisant le bouton "Exécuter le nettoyage maintenant".

### Puis-je récupérer les tâches supprimées ?

Non, la suppression de tâches est permanente. Mettez toujours les tâches importantes en favori ou ajustez les périodes de rétention pour prévenir la suppression accidentelle.

### Le nettoyage affecte-t-il ma tâche actuelle ?

Non, la tâche active sur laquelle vous travaillez actuellement est automatiquement protégée de la suppression.

### Que deviennent les points de contrôle lorsqu'une tâche est supprimée ?

Tous les points de contrôle associés à une tâche supprimée sont définitivement retirés avec les données de la tâche.

### Puis-je désactiver temporairement le nettoyage ?

Oui, décochez simplement l'option "Activer le nettoyage automatique des tâches" dans les paramètres. Votre configuration est préservée pour lorsque vous l'activerez à nouveau.

### Pourquoi certaines anciennes tâches ne sont-elles pas supprimées ?

Vérifiez si elles sont :

1. En favori avec "Ne jamais supprimer les tâches favorites" activé
2. Récemment modifiées (même visualiser une tâche peut mettre à jour son horodatage)
3. Protégées par une période de rétention plus longue en fonction de leur type
