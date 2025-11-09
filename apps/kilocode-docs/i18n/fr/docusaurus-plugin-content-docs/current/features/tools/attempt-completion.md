# attempt_completion

L'outil `attempt_completion` signale que Kilo Code croit qu'une tâche est terminée et présente les résultats à l'utilisateur. Il fournit un résumé de ce qui a été accompli, inclut optionnellement une commande pour démontrer le résultat, et supporte le raffinement continu à travers le retour utilisateur.

## Paramètres

L'outil accepte ces paramètres :

- `result` (requis) : La description du résultat final résumant ce qui a été accompli
- `command` (optionnel) : Une commande CLI à exécuter pour démontrer le résultat

## Ce qu'il fait

Cet outil marque la fin d'une tâche en présentant un résumé final de ce qui a été accompli. Il signale à la fois à l'utilisateur et au système que la tâche actuelle est terminée. Quand une commande est fournie, elle peut aussi démontrer le résultat à travers une exécution en direct.

## Quand est-il utilisé ?

- Quand Kilo Code croit que la tâche utilisateur a été complétée
- Quand résumer les changements ou améliorations qui ont été faits
- Quand démontrer le résultat actuel avec une exécution de commande
- Quand fournir un point de contrôle pour le retour utilisateur sur la solution
- Quand transitionner d'une phase de travail vers des raffinements potentiels

## Caractéristiques Clés

- Fournit un signal clair que Kilo Code croit que la tâche est terminée
- Résume les accomplissements dans un message concis
- Optionnellement démontre les résultats à travers l'exécution de commande
- Permet le retour utilisateur pour des raffinements additionnels
- Affiche les résultats dans un format UI spécial distinct des messages réguliers
- Capture la télémétrie d'achèvement de tâche pour l'analytique du système
- Maintient un flux de conversation structuré en fournissant des points de contrôle
- Supporte l'achèvement de sous-tâche dans des workflows plus larges
- S'assure que les utilisateurs reçoivent un résumé clair de ce qui a été fait
- Disponible dans tous les modes comme partie du groupe d'outils "toujours disponibles"

## Limitations

- Ne devrait pas être utilisé jusqu'à ce que les utilisations d'outils précédentes soient confirmées réussies (ligne directrice, pas appliquée)
- Limité à une seule commande pour démonstration de résultat
- Ne peut pas présenter plusieurs options de commande
- Les commandes nécessitent l'approbation utilisateur avant l'exécution
- Limité à démontrer les résultats qui peuvent être montrés via des commandes CLI
- Ne peut pas être utilisé pour l'achèvement partiel de tâche ou mises à jour de progrès
- Le formatage de résultat enlève les balises XML de fermeture à travers le traitement interne

## Comment ça fonctionne

Quand l'outil `attempt_completion` est invoqué, il suit ce processus :

1. **Considération de Sécurité** (ligne directrice, pas appliquée) :

    - L'IA est instruite de confirmer que les utilisations d'outils précédentes étaient réussies
    - C'est une bonne pratique plutôt qu'un mécanisme appliqué programmatiquement

2. **Présentation de Résultat** :

    - Affiche le message d'achèvement à l'utilisateur dans un format UI spécial "completion_result"
    - Enlève les balises XML de fermeture du texte de résultat en utilisant la fonction `removeClosingTag`
    - Présente le résultat différemment des messages réguliers pour distinction visuelle

3. **Exécution de Commande** (si fournie) :

    - Demande l'approbation utilisateur avant d'exécuter la commande
    - N'exécute que si l'utilisateur approuve
    - Exécute la commande en utilisant la fonctionnalité d'exécution de commande du système
    - Montre le résultat de la commande à l'utilisateur

4. **Collecte de Retour** :

    - Attend le retour utilisateur sur le résultat d'achèvement
    - Traite ce retour et le retourne à l'IA
    - Permet le raffinement continu basé sur la saisie utilisateur

5. **Achèvement de Tâche et Continuation** :

    - Signale la tâche comme terminée dans le système
    - Capture les données de télémétrie pour la tâche complétée
    - Pour les sous-tâches, offre de finir la sous-tâche et de reprendre la tâche parent
    - Supporte la conversation continue à travers le mécanisme de retour

6. **Intégration d'Implémentation** :
    - Les résultats d'outil sont parsés à travers le mécanisme de parsing du système dans `parse-assistant-message.ts`
    - L'outil fait partie de la constante "ALWAYS_AVAILABLE_TOOLS", le rendant disponible dans tous les modes

## Directives de Formatage de Résultat

Le message de résultat devrait suivre ces directives :

- Communiquer clairement ce qui a été accompli
- Être concis mais complet
- Se concentrer sur la valeur livrée à l'utilisateur
- Éviter les politesses ou texte de remplissage inutiles
- Maintenir un ton professionnel et direct
- Présenter l'information d'une manière facile à scanner et comprendre
- Reconnaître que l'utilisateur peut fournir du retour pour des raffinements additionnels

Note : Le système enlève automatiquement les balises XML de fermeture du texte de résultat à travers la fonction `removeClosingTag`.

## Directives de Sélection de Commande

Quand incluant une commande, suivez ces directives :

- Choisissez des commandes qui démontrent visuellement le résultat
- Préférez les commandes qui montrent à l'utilisateur ce qui a été créé ou modifié
- Les exemples incluent :
    - `open index.html` pour afficher un site web créé
    - `npm start` pour lancer un serveur de développement
    - `python app.py` pour exécuter une application créée
- Évitez les commandes qui impriment seulement du texte (comme `echo` ou `cat`)
- Rappelez-vous que les commandes nécessitent l'approbation utilisateur avant l'exécution
- Assurez-vous que la commande est valide pour le système d'exploitation de l'utilisateur

## Retour et Représentation UI

L'outil `attempt_completion` a un mécanisme de retour unique :

- Les résultats apparaissent dans un format UI spécial "completion_result" distinct des messages réguliers
- Le système attend le retour utilisateur après avoir présenté le résultat
- Le retour est traité et retourné à Kilo Code pour des raffinements additionnels
- Cela crée un cycle d'amélioration itératif plutôt que de terminer la conversation
- L'UI inclut des éléments spéciaux pour fournir du retour
- Les résultats servent de points de contrôle clairs dans le flux de conversation

Quand utilisé dans des sous-tâches :

- Le système offre de finir la sous-tâche et de reprendre la tâche parent
- Si approuvé, la sous-tâche est complétée avec un résumé
- La tâche parent reprend avec le contexte de la sous-tâche complétée
- Cela permet des workflows complexes et imbriqués tout en maintenant le contexte

## Exemples d'Utilisation

- En créant un site web, Kilo Code présente la solution et utilise `open index.html` pour montrer le résultat. L'utilisateur fournit du retour, et Kilo Code raffine le design.
- En implémentant une fonctionnalité, Kilo Code résume les changements et leur impact. L'utilisateur demande une couverture de test additionnelle, et Kilo Code continue la tâche.
- En corrigeant des bogues, Kilo Code explique ce qui a été corrigé et comment la solution s'adresse à la cause Kilo Code. L'utilisateur confirme que la correction fonctionne.
- En configurant un environnement de développement, Kilo Code confirme que tous les composants sont installés. L'utilisateur demande une configuration additionnelle, et Kilo Code continue.
- En créant un script de traitement de données, Kilo Code résume la fonctionnalité. L'utilisateur suggère des améliorations de performance, et Kilo Code optimise le code.

## Exemples d'Usage

Compléter une tâche avec seulement un résumé de résultat :

```
<attempt_completion>
<result>
J'ai mis à jour le CSS pour la barre de navigation pour correspondre au mockup de design. Les changements incluent :
1. Palette de couleurs mise à jour pour utiliser les nouvelles couleurs de marque
2. Comportement responsive ajouté pour les appareils mobiles
3. Problèmes d'alignement corrigés dans les menus déroulants
</result>
</attempt_completion>
```

Compléter une tâche avec un résultat et une commande de démonstration :

```
<attempt_completion>
<result>
J'ai créé une application React simple avec les fonctionnalités suivantes :
1. Une page d'accueil responsive avec la section héros demandée
2. Un formulaire de contact fonctionnel avec validation
3. Navigation entre toutes les trois pages demandées
4. Style qui correspond au mockup de design fourni
</result>
<command>npm start</command>
</attempt_completion>
```

Compléter une tâche de script Python avec exécution :

```
<attempt_completion>
<result>
J'ai créé un script de traitement de données qui :
1. Lit les fichiers CSV depuis le répertoire de données
2. Nettoie et normalise les données comme demandé
3. Génère les statistiques de résumé en format JSON
4. Sort les données traitées vers le répertoire de sortie
</result>
<command>python process_data.py</command>
</attempt_completion>
```
