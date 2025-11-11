# Profils de Configuration API

Les Profils de Configuration API vous permettent de créer et de basculer entre différents ensembles de paramètres d'IA. Chaque profil peut avoir différentes configurations pour chaque Mode, vous permettant d'optimiser votre expérience en fonction de la tâche en cours.

:::info
Avoir plusieurs profils de configuration vous permet de basculer rapidement entre différents fournisseurs d'IA, modèles et paramètres sans tout reconfigurer chaque fois que vous souhaitez modifier votre configuration.
:::

## Comment ça fonctionne

Les profils de configuration peuvent avoir leurs propres :

- Fournisseurs API (OpenAI, Anthropic, OpenRouter, Glama, etc.)
- Clés API et détails d'authentification
- Sélections de modèles (o3-mini-high, Claude 3.7 Sonnet, DeepSeek R1, etc.)
- Paramètres de [température](/features/model-temperature) pour contrôler l'aléa des réponses
- Budgets de réflexion
- Paramètres spécifiques au fournisseur

Notez que les paramètres disponibles varient selon le fournisseur et le modèle. Chaque fournisseur offre différentes options de configuration, et même au sein du même fournisseur, différents modèles peuvent supporter différentes plages de paramètres ou fonctionnalités.

## Créer et Gérer les Profils

### Créer un Profil

1. Ouvrez les Paramètres en cliquant sur l'icône d'engrenage <Codicon name="gear" /> → Fournisseurs
2. Cliquez sur le bouton "+" à côté du sélecteur de profil

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-1.png" alt="Sélecteur de profil avec bouton plus" width="550" />

3. Saisissez un nom pour votre nouveau profil

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles.png" alt="Boîte de dialogue de création de nouveau profil" width="550" />

4. Configurez les paramètres du profil :

    - Sélectionnez votre fournisseur API
         <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-2.png" alt="Menu déroulant de sélection de fournisseur" width="550" />
    - Saisissez la clé API

         <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-3.png" alt="Champ de saisie de clé API" width="550" />

    - Choisissez un modèle

         <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-8.png" alt="Interface de sélection de modèle" width="550" />

    - Ajustez les paramètres du modèle

         <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-5.png" alt="Contrôles d'ajustement des paramètres du modèle" width="550" />

### Basculer les Profils

Basculez de profils de deux façons :

1. Depuis le panneau Paramètres : Sélectionnez un profil différent dans le menu déroulant

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-7.png" alt="Menu déroulant de sélection de profil dans les Paramètres" width="550" />

2. Pendant le chat : Accédez au menu déroulant Configuration API dans l'interface de chat

    <img src="/docs/img/api-configuration-profiles/api-configuration-profiles-6.png" alt="Menu déroulant Configuration API dans l'interface de chat" width="550" />

### Épingler et Trier les Profils

Le menu déroulant de configuration API supporte maintenant l'épinglage de vos profils favoris pour un accès plus rapide :

1. Survolez n'importe quel profil dans le menu déroulant pour révéler l'icône d'épingle
2. Cliquez sur l'icône d'épingle pour ajouter le profil à votre liste épinglée
3. Les profils épinglés apparaissent en haut du menu déroulant, triés alphabétiquement
4. Les profils non épinglés apparaissent en dessous d'un séparateur, également triés alphabétiquement
5. Vous pouvez désépingler un profil en cliquant sur la même icône

<img src="/docs/img/api-configuration-profiles/api-configuration-profiles-4.png" alt="Épingler les profils de configuration API" width="550" />

Cette fonctionnalité facilite la navigation entre les profils couramment utilisés, surtout quand vous avez de nombreuses configurations.

### Éditer et Supprimer les Profils

<img src="/docs/img/api-configuration-profiles/api-configuration-profiles-10.png" alt="Interface d'édition de profil" width="550" />
- Sélectionnez le profil dans les Paramètres pour modifier n'importe quel paramètre
- Cliquez sur l'icône crayon pour renommer un profil
- Cliquez sur l'icône poubelle pour supprimer un profil (vous ne pouvez pas supprimer le dernier profil restant)

## Lier les Profils aux Modes

Dans l'onglet <Codicon name="notebook" /> Prompts, vous pouvez associer explicitement un Profil de Configuration spécifique à chaque Mode. Le système se souvient également automatiquement du dernier profil que vous avez utilisé avec chaque mode, rendant votre flux de travail plus efficace.

Regardez cette démonstration de comment connecter les profils de configuration avec des modes spécifiques pour des flux de travail optimisés :

<video width="600" controls>
  <source src="/docs/img/api-configuration-profiles/provider-modes.mp4" type="video/mp4" />
  Votre navigateur ne supporte pas la balise vidéo.
</video>

## Note de Sécurité

Les clés API sont stockées de manière sécurisée dans le Stockage Secret de VSCode et ne sont jamais exposées en texte clair.

## Fonctionnalités Connexes

- Fonctionne avec les [modes personnalisés](/features/custom-modes) que vous créez
- S'intègre avec les [modèles locaux](/advanced-usage/local-models) pour le travail hors ligne
- Supporte les [paramètres de température](/features/model-temperature) par mode
- Améliore la gestion des coûts avec les [limites de débit et le suivi d'utilisation](/advanced-usage/rate-limits-costs)
