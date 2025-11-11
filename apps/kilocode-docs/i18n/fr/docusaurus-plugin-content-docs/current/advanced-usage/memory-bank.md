# Memory Bank

## Vue d'ensemble

<YouTubeEmbed
  url="https://youtu.be/FwAYGslfB6Y"
/>

<figure style={{ float: 'right', width: '40%', maxWidth: '350px', margin: '0 0 10px 20px' }}>
  <img src="/docs/img/memory-bank/at-work.png" alt="Exécution d'une tâche avec le Memory Bank" style={{ border: '1px solid grey', borderRadius: '5px', width: '100%' }} />
  <figcaption style={{ fontSize: '0.9rem', color: '#666', marginTop: '8px', textAlign: 'center' }}>
    Kilo Code fonctionne plus efficacement avec Memory Bank activé, comprenant instantanément le contexte du projet et les technologies utilisées.
  </figcaption>
</figure>

### Le problème : La perte de mémoire de l'IA

Les assistants IA comme Kilo Code sont confrontés à une limitation fondamentale : ils se réinitialisent complètement entre les sessions. Cette "perte de mémoire" signifie que chaque fois que vous commencez une nouvelle conversation, vous devez réexpliquer l'architecture, les objectifs, les technologies et l'état actuel de votre projet. Cela crée un dilemme d'efficacité critique : les modèles IA effectuent soit des modifications sans une compréhension appropriée du projet (ce qui entraîne des erreurs et des solutions inadaptées), soit doivent consacrer un temps et des ressources considérables à analyser l'ensemble de votre base de code à chaque session (ce qui est prohibitivement coûteux et lent pour les projets plus volumineux).

Sans solution à ce problème de mémoire, les assistants IA restent des outils puissants mais sans état qui ne peuvent pas véritablement fonctionner comme des partenaires de développement persistants.

### La solution : Memory Bank

Memory Bank est un système de documentation structuré qui permet à Kilo Code de **mieux comprendre votre projet** et de **maintenir le contexte entre les sessions de codage**. Il transforme votre assistant IA d'un outil sans état en un partenaire de développement persistant avec une mémoire parfaite des détails de votre projet. Kilo Code lit automatiquement vos fichiers Memory Bank pour reconstruire sa compréhension de votre projet chaque fois que vous commencez une nouvelle session.

Lorsque Memory Bank est actif, Kilo Code commence chaque tâche avec `[Memory Bank: Active]` et un bref résumé du contexte de votre projet, assurant une compréhension cohérente sans explications répétitives.

## Avantages clés

- **Agnostique au langage** : Fonctionne avec n'importe quel langage de programmation ou framework
- **Compréhension efficace du projet** : Aide Kilo Code à comprendre l'objectif et la pile technologique d'un projet
- **Préservation du contexte** : Maintient les connaissances du projet entre les sessions sans avoir besoin d'analyser les fichiers à chaque nouvelle session
- **Démarrage plus rapide** : Kilo Code comprend immédiatement le contexte de votre projet lorsque vous commencez une nouvelle session
- **Projets auto-documentés** : Crée une documentation précieuse comme sous-produit

## Fonctionnement de Memory Bank

Memory Bank est basé sur la fonctionnalité [Règles personnalisées](/advanced-usage/custom-rules) de Kilo Code, fournissant un cadre spécialisé pour la documentation de projet. Les fichiers Memory Bank sont des fichiers markdown standard stockés dans le dossier `.kilocode/rules/memory-bank` de votre dépôt de projet. Ils ne sont pas cachés ou propriétaires - ce sont des fichiers de documentation réguliers que vous et Kilo Code pouvez consulter.

Au début de chaque tâche, Kilo Code lit tous les fichiers Memory Bank pour construire une compréhension complète de votre projet. Cela se produit automatiquement sans nécessiter aucune action de votre part. Kilo Code indique ensuite l'activation réussie de Memory Bank avec `[Memory Bank: Active]` au début de sa réponse, suivi d'un bref résumé de sa compréhension de votre projet.

Les fichiers sont organisés dans une structure hiérarchique qui construit une image complète de votre projet :

## Fichiers principaux de Memory Bank

### brief.md

_Ce fichier est créé et maintenu manuellement par vous_

- La fondation de votre projet
- Vue d'ensemble de haut niveau de ce que vous construisez
- Exigences et objectifs principaux

Exemple : _"Construction d'une application web React pour la gestion des stocks avec scan de codes-barres. Le système doit prendre en charge plusieurs entrepôts et s'intégrer à notre système ERP existant."_

Note : Kilo Code ne modifiera pas directement ce fichier mais peut suggérer des améliorations s'il identifie des moyens d'améliorer votre briefing de projet.

### product.md

- Explique pourquoi le projet existe
- Décrit les problèmes résolus
- Décrit comment le produit devrait fonctionner
- Objectifs d'expérience utilisateur

Exemple : _"Le système de stocks doit prendre en charge plusieurs entrepôts et les mises à jour en temps réel. Il résout le problème des divergences de stocks en fournissant un scan de codes-barres pour des comptages de stocks précis."_

### context.md

- Le fichier le plus fréquemment mis à jour
- Contient le focus de travail actuel et les changements récents
- Suit les décisions actives et considérations
- Prochaines étapes de développement

Exemple : _"Implémentation actuelle du composant de scan de codes-barres ; la dernière session a terminé l'intégration API. Les prochaines étapes incluent l'ajout de la gestion des erreurs pour les pannes réseau."_

### architecture.md

- Documente l'architecture du système
- Enregistre les décisions techniques clés
- Liste les motifs de conception utilisés
- Explique les relations entre composants
- Chemins d'implémentation critiques

Exemple : _"Utilisation de Redux pour la gestion d'état avec une structure de magasin normalisée. L'application suit une architecture modulaire avec des services séparés pour la communication API, la gestion d'état et les composants UI."_

### tech.md

- Liste les technologies et frameworks utilisés
- Décrit la configuration de développement
- Note les contraintes techniques
- Enregistre les dépendances et configurations d'outils
- Modèles d'utilisation des outils

Exemple : _"React 18, TypeScript, Firebase, Jest pour les tests. Le développement nécessite Node.js 16+ et utilise Vite comme outil de build."_

## Fichiers de contexte additionnels

Créez des fichiers additionnels selon les besoins pour organiser :

- La documentation de fonctionnalités complexes
- Les spécifications d'intégration
- La documentation API
- Les stratégies de test
- Les procédures de déploiement

Ces fichiers additionnels aident à organiser des informations plus détaillées qui ne s'intègrent pas parfaitement dans les fichiers principaux.

### tasks.md

_Fichier optionnel pour documenter les tâches répétitives_

- Stocke les workflows pour les tâches qui suivent des modèles similaires
- Documente quels fichiers doivent être modifiés
- Capture les procédures étape par étape
- Enregistre les considérations importantes et pièges

Exemple : Ajout du support pour de nouveaux modèles IA, implémentation de points de terminaison API, ou toute tâche nécessitant de faire des travaux similaires répétitivement.

## Premiers pas avec Memory Bank

### Configuration initiale

1. Créez un dossier `.kilocode/rules/memory-bank/` dans votre projet
2. Écrivez un briefing de projet de base dans `.kilocode/rules/memory-bank/brief.md`
3. Créez un fichier `.kilocode/rules/memory-bank-instructions.md` et collez-y [ce document](pathname:///downloads/memory-bank.md)
4. Basculez en mode `Architect`
5. Vérifiez si un meilleur modèle IA disponible est sélectionné, n'utilisez pas de modèles "légers"
6. Demandez à Kilo Code d'"initialiser le memory bank"
7. Attendez que Kilo Code analyse votre projet et initialise les fichiers Memory Bank
8. Vérifiez le contenu des fichiers pour voir si le projet est décrit correctement. Mettez à jour les fichiers si nécessaire.

### Conseils pour le briefing de projet

- Commencez simplement - il peut être aussi détaillé ou de haut niveau que vous le souhaitez
- Concentrez-vous sur ce qui vous importe le plus
- Kilo Code aidera à combler les lacunes et posera des questions
- Vous pouvez le mettre à jour au fur et à mesure que votre projet évolue

Exemple de prompt qui fournit un briefing raisonnablement bon :

```
Fournissez une description concise et complète de ce projet, en mettant en évidence ses principaux objectifs, ses caractéristiques clés, les technologies utilisées et son importance. Ensuite, écrivez cette description dans un fichier texte nommé de manière appropriée pour refléter le contenu du projet, en assurant clarté et professionnalisme dans la rédaction. Restez bref et concis.
```

## Travail avec Memory Bank

### Workflows principaux

#### Initialisation de Memory Bank

L'étape d'initialisation est d'une importance critique car elle établit la fondation pour toutes les interactions futures avec votre projet. Lorsque vous demandez l'initialisation avec la commande `initialize memory bank`, Kilo Code va :

1. Effectuer une analyse exhaustive de votre projet, incluant :
    - Tous les fichiers de code source et leurs relations
    - Les fichiers de configuration et la configuration du système de build
    - La structure du projet et les modèles d'organisation
    - La documentation et les commentaires
    - Les dépendances et intégrations externes
    - Les frameworks de test et modèles
2. Créer des fichiers memory bank complets dans le dossier `.kilocode/rules/memory-bank`
3. Fournir un résumé détaillé de ce qu'il a compris de votre projet
4. Vous demander de vérifier l'exactitude des fichiers générés

:::warning Important
Prenez le temps de réviser attentivement et corriger les fichiers générés après l'initialisation. Tout malentendu ou information manquante à ce stade affectera toutes les interactions futures. Une initialisation approfondie améliore considérablement l'efficacité de Kilo Code, tandis qu'une initialisation précipitée ou incomplète limitera de façon permanente sa capacité à vous assister efficacement.
:::

#### Mises à jour de Memory Bank

Les mises à jour de Memory Bank se produisent lorsque :

1. Kilo Code découvre de nouveaux modèles de projet
2. Après implémentation de changements significatifs
3. Lorsque vous demandez explicitement avec `update memory bank`
4. Lorsque le contexte a besoin d'être clarifié

Pour exécuter une mise à jour de Memory Bank, Kilo Code va :

1. Réviser TOUS les fichiers du projet
2. Documenter l'état actuel
3. Documenter les informations et modèles
4. Mettre à jour tous les fichiers memory bank selon les besoins

Vous pouvez diriger Kilo Code à se concentrer sur des sources d'informations spécifiques en utilisant des commandes comme `update memory bank using information from @/Makefile`.

#### Exécution de tâches régulières

Au début de chaque tâche, Kilo Code :

1. Lit TOUS les fichiers memory bank
2. Inclut `[Memory Bank: Active]` au début de sa réponse
3. Fournit un bref résumé de sa compréhension de votre projet
4. Procède avec la tâche demandée

À la fin d'une tâche, Kilo Code peut suggérer de mettre à jour le memory bank si des changements significatifs ont été effectués, en utilisant la phrase : "Souhaitez-vous que je mette à jour le memory bank pour refléter ces changements ?"

#### Workflow d'ajout de tâche

Lorsque vous terminez une tâche répétitive qui suit un modèle similaire à chaque fois, vous pouvez la documenter pour référence future. Ceci est particulièrement utile pour des tâches comme l'ajout de fonctionnalités qui suivent des modèles existants

Pour documenter une tâche, utilisez la commande `add task` ou `store this as a task`. Kilo Code va :

1. Créer ou mettre à jour le fichier `tasks.md` dans le dossier memory bank
2. Documenter la tâche en utilisant le contexte actuel :
    - Nom et description de la tâche
    - Liste des fichiers qui doivent être modifiés
    - Workflow étape par étape
    - Considérations importantes
    - Exemple d'implémentation

Lorsqu'il commence une nouvelle tâche, Kilo Code vérifiera si elle correspond à des tâches documentées et suivra le workflow établi pour s'assurer qu'aucune étape n'est manquée.

### Commandes clés

- `initialize memory bank` - À utiliser lors du démarrage d'un nouveau projet
- `update memory bank` - Initie une réanalyse complète de la documentation contextuelle pour la tâche actuelle. **Attention :** Ceci est intensif en ressources et non recommandé pour les modèles "légers" en raison d'une efficacité potentiellement réduite. Peut être utilisé plusieurs fois, bien combinable avec des instructions spécifiques, ex. `update memory bank using information from @/Makefile`
- `add task` ou `store this as a task` - Documente une tâche répétitive pour référence future

### Indicateurs de statut

Kilo Code utilise des indicateurs de statut pour communiquer clairement le statut de Memory Bank :

- `[Memory Bank: Active]` - Indique que les fichiers Memory Bank ont été lus avec succès et sont utilisés
- `[Memory Bank: Missing]` - Indique que les fichiers Memory Bank n'ont pas pu être trouvés ou sont vides

Ces indicateurs apparaissent au début des réponses de Kilo Code, fournissant une confirmation immédiate du statut de Memory Bank.

### Mises à jour de documentation

Les mises à jour de Memory Bank devraient se produire automatiquement lorsque :

- Vous découvrez de nouveaux modèles dans votre projet
- Après implémentation de changements significatifs
- Lorsque vous demandez explicitement avec `update memory bank`
- Lorsque vous sentez que le contexte a besoin d'être clarifié

## Gestion de la fenêtre de contexte

Au fur et à mesure que vous travaillez avec Kilo Code, votre fenêtre de contexte finira par se remplir. Lorsque vous remarquez que les réponses ralentissent ou que les références deviennent moins précises :

1. Demandez à Kilo Code de "mettre à jour le memory bank" pour documenter l'état actuel
2. Commencez une nouvelle conversation/tâche
3. Kilo Code accédera automatiquement à votre Memory Bank dans la nouvelle conversation

Ce processus assure la continuité entre plusieurs sessions sans perdre de contexte important.

## Gestion des incohérences

Si Kilo Code détecte des incohérences entre les fichiers memory bank :

1. Il donnera la priorité aux informations de `brief.md` comme source de vérité
2. Notera toute divergence à votre attention
3. Continuera à travailler avec les informations les plus fiables disponibles

Ceci assure que même avec une documentation imparfaite, Kilo Code peut encore fonctionner efficacement.

## Questions fréquentes

### Où sont stockés les fichiers memory bank ?

Les fichiers Memory Bank sont des fichiers markdown réguliers stockés dans votre dépôt de projet, typiquement dans un dossier `.kilocode/rules/memory-bank/`. Ce ne sont pas des fichiers système cachés - ils sont conçus pour faire partie de la documentation de votre projet.

### À quelle fréquence dois-je mettre à jour le memory bank ?

Mettez à jour le Memory Bank après des jalons significatifs ou des changements de direction. Pour un développement actif, des mises à jour toutes les quelques sessions peuvent être utiles. Utilisez la commande "update memory bank" lorsque vous voulez vous assurer que tout le contexte est préservé.

### Puis-je modifier les fichiers memory bank manuellement ?

Oui ! Bien que Kilo Code gère la plupart des fichiers, vous pouvez modifier n'importe lequel d'entre eux manuellement. Le fichier `brief.md` est spécifiquement conçu pour être maintenu par vous. Les modifications manuelles d'autres fichiers seront respectées par Kilo Code.

### Que se passe-t-il si les fichiers memory bank sont manquants ?

Si les fichiers memory bank sont manquants, Kilo Code l'indiquera avec `[Memory Bank: Missing]` au début de sa réponse et suggérera d'initialiser le memory bank.

### Memory Bank fonctionne-t-il avec tous les modèles IA ?

Memory Bank fonctionne avec tous les modèles IA, mais les modèles plus puissants créeront des fichiers memory bank plus complets et précis. Les modèles légers peuvent avoir des difficultés avec le processus intensif en ressources d'analyse et de mise à jour des fichiers memory bank.

### Puis-je utiliser Memory Bank avec plusieurs projets ?

Oui ! Chaque projet a son propre Memory Bank dans son dossier `.kilocode/rules/memory-bank/`. Kilo Code utilisera automatiquement le Memory Bank correct pour chaque projet.

### Memory Bank n'utilise-t-il pas ma fenêtre de contexte ?

Oui, Memory Bank consomme une partie de votre fenêtre de contexte au début de chaque session car il charge tous les fichiers memory bank. Cependant, c'est un compromis stratégique qui améliore considérablement l'efficacité globale. En chargeant le contexte du projet en amont :

- Vous éliminez les explications répétitives qui consommeraient encore plus de contexte au fil du temps
- Vous atteignez des résultats productifs avec moins d'échanges aller-retour
- Vous maintenez une compréhension cohérente tout au long de votre session

Les tests montrent que bien que Memory Bank utilise plus de tokens initialement, il réduit considérablement le nombre total d'interactions nécessaires pour atteindre des résultats. Cela signifie moins de temps à expliquer et plus de temps à construire.

## Meilleures pratiques

### Premiers pas

- Commencez avec un briefing de projet de base et laissez la structure évoluer
- Laissez Kilo Code aider à créer la structure initiale
- Révisez et ajustez les fichiers selon les besoins pour correspondre à votre workflow
- Vérifiez l'exactitude des fichiers générés après l'initialisation

### Travail continu

- Laissez les modèles émerger naturellement au fur et à mesure que vous travaillez
- Ne forcez pas les mises à jour de documentation - elles devraient se produire organiquement
- Faites confiance au processus - la valeur se compose avec le temps
- Surveillez la confirmation du contexte au début des sessions
- Utilisez les indicateurs de statut pour confirmer que Memory Bank est actif

### Flux de documentation

- `brief.md` est votre fondation
- `context.md` change le plus fréquemment
- Tous les fichiers maintiennent collectivement l'intelligence du projet
- Mettez à jour après des jalons significatifs ou des changements de direction

### Optimisation des performances de Memory Bank

- Gardez les fichiers memory bank concis et concentrés
- Utilisez des fichiers additionnels pour la documentation détaillée
- Mettez à jour régulièrement mais pas excessivement
- Utilisez des commandes de mise à jour spécifiques lorsque vous vous concentrez sur des aspects particuliers

## À retenir

Le Memory Bank est le seul lien de Kilo Code avec le travail précédent. Son efficacité dépend entièrement du maintien d'une documentation claire et précise et de la confirmation de la préservation du contexte à chaque interaction. Lorsque vous voyez `[Memory Bank: Active]` au début d'une réponse, vous pouvez être confiant que Kilo Code a une compréhension complète de votre projet.
