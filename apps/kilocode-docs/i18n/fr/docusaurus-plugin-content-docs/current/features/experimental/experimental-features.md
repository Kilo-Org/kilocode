# Fonctionnalités Expérimentales

Kilo Code inclut des fonctionnalités expérimentales qui sont encore en développement. Ces fonctionnalités peuvent être instables, changer significativement, ou être supprimées dans les versions futures. Utilisez-les avec prudence et soyez conscient qu'elles peuvent ne pas fonctionner comme attendu.

**Avertissement :** Les fonctionnalités expérimentales peuvent avoir un comportement inattendu, incluant une potentielle perte de données ou vulnérabilités de sécurité. Activez-les à vos propres risques.

## Activer les Fonctionnalités Expérimentales

Pour activer ou désactiver les fonctionnalités expérimentales :

1.  Ouvrez les paramètres Kilo Code (icône <Codicon name="gear" /> dans le coin supérieur droit).
2.  Allez à la section "Paramètres Avancés".
3.  Trouvez la section "Fonctionnalités Expérimentales".
4.  Cochez ou décochez les cases pour les fonctionnalités que vous voulez activer ou désactiver.
5.  Cliquez "Terminé" pour sauvegarder vos changements.

## Fonctionnalités Expérimentales Actuelles

Les fonctionnalités expérimentales suivantes sont actuellement disponibles :

## Appels de Fonction Natif

Quand activés, les appels de fonction JSON natifs améliorent la fiabilité via des signatures explicites, une validation de schéma de première classe, et de meilleurs taux de succès de cache dû aux arguments structurés normalisés.

Il remplace les prompts de style XML fragiles qui risquent de mélanger prose/markup, champs manquants, et nettoyage lourd en regex, produisant une utilisation d'outil plus déterministe et une gestion d'erreurs plus claire.

[Plus de détails sont disponibles](native-function-calling)

## Autocomplétion

Quand activé, Kilo Code fournira des suggestions de code en ligne pendant que vous tapez. Actuellement cela nécessite le Fournisseur Kilo Gateway pour l'utiliser.

## Éditions de fichiers concurrentes

Quand activé, Kilo Code peut éditer plusieurs fichiers dans une seule requête. Quand désactivé, Kilo Code doit éditer un fichier à la fois. Désactiver cela peut aider quand on travaille avec des modèles moins capables ou quand vous voulez plus de contrôle sur les modifications de fichiers.

### Direction Assistée

Quand activé, Kilo Code rappellera au modèle les détails de sa définition de mode actuelle plus fréquemment. Cela mènera à une adhésion plus forte aux définitions de rôle et instructions personnalisées, mais utilisera plus de tokens par message.

## Fournir des Retours

Si vous rencontrez des problèmes avec les fonctionnalités expérimentales, ou si vous avez des suggestions d'améliorations, veuillez les signaler sur la [page des Issues GitHub Kilo Code](https://github.com/Kilo-Org/kilocode) ou rejoignez notre [serveur Discord](https://kilo.love/discord) où nous avons des canaux dédiés à de nombreuses fonctionnalités expérimentales.

Vos retours sont précieux et nous aident à améliorer Kilo Code !
