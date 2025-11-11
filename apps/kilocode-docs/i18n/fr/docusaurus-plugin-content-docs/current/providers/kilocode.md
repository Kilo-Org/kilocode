---
sidebar_label: Fournisseur Kilo Code
---

# Utiliser le Fournisseur Intégré de Kilo Code

Kilo Code fournit son propre fournisseur API intégré qui vous donne accès aux derniers modèles de codage de pointe via un processus d'inscription simple. Pas besoin de gérer des clés API de plusieurs fournisseurs - inscrivez-vous et commencez à coder.

**Site Web :** [https://kilocode.ai/](https://kilocode.ai/)

## Commencer

Quand vous vous inscrivez à Kilo Code, vous pouvez commencer immédiatement avec des modèles gratuits, ou créditer votre compte pour la première fois pour obtenir des crédits bonus.

Pour réclamer vos crédits bonus :

1. **S'inscrire :** Complétez le processus d'inscription
2. **Premier crédit :** Ajoutez des fonds à votre compte et obtenez 20$ de crédits bonus
3. **Commencer à Coder :** Profitez de vos 20$ en crédits gratuits

## Processus d'Inscription

Kilo Code offre une inscription rationalisée qui vous connecte directement aux modèles de codage de pointe :

1. **Commencer l'Inscription :** Cliquez "Essayer Kilo Code Gratuitement" dans l'extension
2. **Se Connecter :** Utilisez votre compte Google pour vous connecter sur kilocode.ai
3. **Autoriser VS Code :**
    - kilocode.ai vous invitera à ouvrir Visual Studio Code
    - Pour les IDEs basés sur le web, vous copierez la clé API manuellement à la place
4. **Compléter la Configuration :** Permettez à VS Code d'ouvrir l'URL d'autorisation quand invité

<!-- <img src="/img/setting-up/signupflow.gif" alt="Sign up and registration flow with Kilo Code" width="600" /> -->

## Modèles Supportés

Kilo Code fournit l'accès aux derniers modèles de codage de pointe via son fournisseur intégré. Les modèles spécifiques disponibles sont automatiquement mis à jour et gérés par le service Kilo Code, s'assurant que vous avez toujours accès aux modèles les plus capables pour les tâches de codage.

## Configuration dans Kilo Code

Une fois que vous avez complété le processus d'inscription, Kilo Code est automatiquement configuré :

1. **Configuration Automatique :** Après l'inscription réussie, Kilo Code est prêt à utiliser immédiatement
2. **Pas de Gestion de Clé API :** Votre authentification est gérée sans problème à travers le processus d'inscription
3. **Sélection de Modèle :** L'accès aux modèles de pointe est fourni automatiquement à travers votre compte Kilo Code

### Routage de Fournisseur

Kilo Code peut router vers plusieurs fournisseurs d'inférence différents. Pour les comptes personnels, le comportement de routage de fournisseur peut être contrôlé dans les paramètres Fournisseur API sous Routage de Fournisseur.

#### Tri de Fournisseur

- Tri de fournisseur par défaut : au moment de l'écriture équivalent à préférer les fournisseurs avec une latence plus faible
- Préférer les fournisseurs avec un prix plus bas
- Préférer les fournisseurs avec un débit plus élevé (c'est-à-dire plus de tokens par seconde)
- Préférer les fournisseurs avec une latence plus faible (c'est-à-dire un temps plus court au premier token)
- Un fournisseur spécifique peut aussi être choisi. Ceci n'est pas recommandé, car cela résultera en erreurs quand le fournisseur fait face à un temps d'arrêt ou applique des limites de débit.

#### Politique de Données

- Autoriser l'entraînement de prompt (gratuit seulement) : les fournisseurs qui peuvent s'entraîner sur vos prompts ou complétions ne sont autorisés que pour les modèles gratuits.
- Autoriser l'entraînement de prompt : les fournisseurs qui peuvent s'entraîner sur vos prompts ou complétions sont autorisés.
- Refuser l'entraînement de prompt : les fournisseurs qui peuvent s'entraîner sur vos prompts ou complétions ne sont pas autorisés.
- Zéro rétention de données : seuls les fournisseurs avec une politique stricte de zéro rétention de données sont autorisés. Cette option n'est pas recommandée, car elle désactivera plusieurs fournisseurs populaires, comme Anthropic et OpenAI.

## Comptes Connectés

Avec le fournisseur Kilo Code, si vous vous inscrivez avec Google vous pouvez aussi connecter d'autres comptes de connexion - comme GitHub - en :

1. Allant à votre profil
2. Sélectionnant [**Comptes Connectés**](https://app.kilocode.ai/connected-accounts)
3. Sous "Lier un Nouveau Compte" sélectionnant le type de compte à lier
4. Complétant l'autorisation OAuth, et vous verrez vos comptes connectés !

<img src="/docs/img/kilo-provider/connected-accounts.png" alt="Écran de connexion de compte" width="600" />

## Conseils et Notes

- **Crédits Gratuits :** Les nouveaux utilisateurs reçoivent des crédits gratuits pour explorer les capacités de Kilo Code
- **Vérification d'Identité :** Le système de blocage temporaire assure la fiabilité du service tout en prévenant la mauvaise utilisation
- **Intégration Transparente :** Pas besoin de gérer plusieurs clés API ou configurations de fournisseur
- **Derniers Modèles :** Accès automatique aux modèles de codage de pointe les plus actuels
- **Support Disponible :** Contactez [hi@kilocode.ai](mailto:hi@kilocode.ai) pour des questions sur la tarification ou les tokens

Pour les instructions de configuration détaillées, consultez [Configuration de Kilo Code](/getting-started/setting-up).
