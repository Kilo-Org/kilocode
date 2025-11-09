# Température du Modèle

La température contrôle l'aléa des sorties des modèles IA. Ajuster ce paramètre optimise les résultats pour différentes tâches - de la génération de code précise au brainstorming créatif. La température est l'un des paramètres les plus puissants pour contrôler le comportement IA. Un paramètre de température bien réglé peut améliorer dramatiquement la qualité et l'appropriation des réponses pour des tâches spécifiques.

<img src="/docs/img/model-temperature/model-temperature.gif" alt="Animation montrant l'ajustement du curseur de température" width="100%" />

## Qu'est-ce que la Température ?

La température est un paramètre (habituellement entre 0.0 et 2.0) qui contrôle à quel point la sortie de l'IA est aléatoire ou prévisible. Trouver le bon équilibre est la clé : les valeurs plus faibles rendent la sortie plus focalisée et consistante, tandis que les valeurs plus élevées encouragent plus de créativité et de variation. Pour de nombreuses tâches de codage, une température modérée (autour de 0.3 à 0.7) fonctionne souvent bien, mais le meilleur paramètre dépend de ce que vous essayez d'accomplir.

:::info Température et Code : Idées Reçues Communes
La température contrôle l'aléa de sortie, pas directement la qualité ou précision du code. Points clés :

- **Température Faible (près de 0.0) :** Produit du code prévisible et consistant. Bon pour les tâches simples, mais peut être répétitif et manquer de créativité. Il ne garantit pas du code _meilleur_.
- **Température Élevée :** Augmente l'aléa, menant potentiellement à des solutions créatives mais aussi plus d'erreurs ou de code absurde. Il ne garantit pas du code de _plus haute qualité_.
- **Précision :** La précision du code dépend de l'entraînement du modèle et de la clarté du prompt, pas de la température.
- **Température 0.0 :** Utile pour la consistance, mais limite l'exploration nécessaire pour des problèmes complexes.
  :::

## Valeurs par Défaut dans Kilo Code

Kilo Code utilise une température par défaut de 0.0 pour la plupart des modèles, optimisant pour le déterminisme maximum et la précision dans la génération de code. Cela s'applique aux modèles OpenAI, modèles Anthropic (variantes non-réflexives), modèles LM Studio, et la plupart des autres fournisseurs.

Certains modèles utilisent des températures par défaut plus élevées - les modèles DeepSeek R1 et certains modèles focalisés sur le raisonnement ont par défaut 0.6, fournissant un équilibre entre déterminisme et exploration créative.

Les modèles avec capacités de raisonnement (où l'IA montre son processus de raisonnement) nécessitent une température fixe de 1.0 qui ne peut pas être changée, car ce paramètre assure la performance optimale du mécanisme de raisonnement. Cela s'applique à n'importe quel modèle avec l'indicateur ":thinking" activé.

Certains modèles spécialisés ne supportent pas du tout les ajustements de température, dans ce cas Kilo Code respecte automatiquement ces limitations.

## Quand Ajuster la Température

Voici quelques exemples de paramètres de température qui pourraient bien fonctionner pour différentes tâches :

- **Mode Code (0.0-0.3) :** Pour écrire du code précis et correct avec des résultats consistants et déterministes
- **Mode Architect (0.4-0.7) :** Pour brainstormer des solutions d'architecture ou de design avec créativité et structure équilibrées
- **Mode Ask (0.7-1.0) :** Pour des explications ou questions ouvertes nécessitant des réponses diverses et perspicaces
- **Mode Debug (0.0-0.3) :** Pour déboguer des bogues avec précision consistante

Ce sont des points de départ - il est important d'[expérimenter avec différents paramètres](#experimentation) pour trouver ce qui fonctionne le mieux pour vos besoins et préférences spécifiques.

## Comment Ajuster la Température

1.  **Ouvrez le Panneau Kilo Code :** Cliquez sur l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la Barre Latérale VS Code
2.  **Ouvrez les Paramètres :** Cliquez sur l'icône <Codicon name="gear" /> dans le coin supérieur droit
3.  **Trouvez le Contrôle de Température :** Naviguez vers la section Fournisseurs
4.  **Activez la Température Personnalisée :** Cochez la case "Utiliser la température personnalisée"
5.  **Définissez Votre Valeur :** Ajustez le curseur à votre valeur préférée

    <img src="/docs/img/model-temperature/model-temperature.png" alt="Paramètre de température dans le panneau des paramètres Kilo Code" width="550" />
    *Curseur de température dans le panneau des paramètres Kilo Code*

## Utiliser les Profils de Configuration API pour la Température

Créez plusieurs [profils de configuration API](/features/api-configuration-profiles) avec différents paramètres de température :

**Comment configurer des profils de température spécifiques aux tâches :**

1. Créez des profils spécialisés comme "Code - Temp Faible" (0.1) et "Ask - Temp Élevée" (0.8)
2. Configurez chaque profil avec les paramètres de température appropriés
3. Basculez entre les profils en utilisant le menu déroulant dans les paramètres ou l'interface de chat
4. Définissez différents profils comme par défaut pour chaque mode pour le basculement automatique en changeant de modes

Cette approche optimise le comportement du modèle pour des tâches spécifiques sans ajustements manuels.

## Implémentation Technique

Kilo Code implémente la gestion de la température avec ces considérations :

- Les paramètres définis par l'utilisateur ont priorité sur les valeurs par défaut
- Les comportements spécifiques au fournisseur sont respectés
- Les limitations spécifiques au modèle sont appliquées :
    - Les modèles avec raisonnement activé nécessitent une température fixe de 1.0
    - Certains modèles ne supportent pas les ajustements de température

## Expérimentation

Expérimenter avec différents paramètres de température est le moyen le plus efficace de découvrir ce qui fonctionne le mieux pour vos besoins spécifiques :

### Test de Température Efficace

1. **Commencez avec les valeurs par défaut** - Commencez avec les valeurs prédéfinies de Kilo Code (0.0 pour la plupart des tâches) comme votre base de référence
2. **Faites des ajustements incrémentaux** - Changez les valeurs en petites étapes (±0.1) pour observer les différences subtiles
3. **Testez de manière consistante** - Utilisez le même prompt à travers différents paramètres de température pour des comparaisons valides
4. **Documentez les résultats** - Notez quelles valeurs produisent les meilleurs résultats pour des types spécifiques de tâches
5. **Créez des profils** - Sauvegardez les paramètres efficaces comme [profils de configuration API](/features/api-configuration-profiles) pour un accès rapide

Rappelez-vous que différents modèles peuvent répondre différemment aux mêmes valeurs de température, et les modèles avec raisonnement activé utilisent toujours une température fixe de 1.0 indépendamment de vos paramètres.

## Fonctionnalités Connexes

- Fonctionne avec tous les [fournisseurs API](/providers/openai) supportés par Kilo Code
- Complémente les [instructions personnalisées](/advanced-usage/custom-instructions) pour affiner les réponses
- Fonctionne avec les [modes personnalisés](/features/custom-modes) que vous créez
