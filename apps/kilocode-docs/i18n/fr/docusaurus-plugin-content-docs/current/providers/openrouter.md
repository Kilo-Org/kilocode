---
sidebar_label: OpenRouter
---

# Utiliser OpenRouter avec Kilo Code

OpenRouter est une plateforme d'IA qui fournit l'accès à une grande variété de modèles de langage de différents fournisseurs, tout à travers une API unique. Ceci peut simplifier la configuration et vous permettre d'expérimenter facilement avec différents modèles.

**Site Web :** [https://openrouter.ai/](https://openrouter.ai/)

## Obtenir une Clé API

1.  **S'inscrire/Se connecter :** Allez au [site web OpenRouter](https://openrouter.ai/). Connectez-vous avec votre compte Google ou GitHub.
2.  **Obtenir une Clé API :** Allez à la [page des clés](https://openrouter.ai/keys). Vous devriez voir une clé API listée. Si non, créez une nouvelle clé.
3.  **Copier la Clé :** Copiez la clé API.

## Modèles Supportés

OpenRouter supporte un grand nombre croissant de modèles. Kilo Code récupère automatiquement la liste des modèles disponibles. Référez-vous à la [Page des Modèles OpenRouter](https://openrouter.ai/models) pour la liste complète et à jour.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "OpenRouter" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API OpenRouter dans le champ "Clé API OpenRouter".
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".
5.  **(Optionnel) URL de Base Personnalisée :** Si vous avez besoin d'utiliser une URL de base personnalisée pour l'API OpenRouter, cochez "Utiliser l'URL de base personnalisée" et saisissez l'URL. Laissez cela vide pour la plupart des utilisateurs.

## Transformations Supportées

OpenRouter fournit une [transformation de message "middle-out" optionnelle](https://openrouter.ai/docs/features/message-transforms) pour aider avec les prompts qui dépassent la taille de contexte maximum d'un modèle. Vous pouvez l'activer en cochant la case "Compresser les prompts et chaînes de messages à la taille de contexte".

## Routage de Fournisseur

OpenRouter peut router vers plusieurs fournisseurs d'inférence différents et ceci peut être contrôlé dans les paramètres Fournisseur API sous Routage de Fournisseur.

### Tri de Fournisseur

- Tri de fournisseur par défaut : utiliser le paramètre dans votre compte OpenRouter
- Préférer les fournisseurs avec un prix plus bas
- Préférer les fournisseurs avec un débit plus élevé (c'est-à-dire plus de tokens par seconde)
- Préférer les fournisseurs avec une latence plus faible (c'est-à-dire un temps plus court au premier token)
- Un fournisseur spécifique peut aussi être choisi. Ceci n'est pas recommandé, car cela résultera en erreurs quand le fournisseur fait face à un temps d'arrêt ou applique des limites de débit.

### Politique de Données

- Aucune politique de données définie : utiliser les paramètres dans votre compte OpenRouter.
- Autoriser l'entraînement de prompt : les fournisseurs qui peuvent s'entraîner sur vos prompts ou complétions sont autorisés. Les modèles gratuits exigent généralement que cette option soit activée.
- Refuser l'entraînement de prompt : les fournisseurs qui peuvent s'entraîner sur vos prompts ou complétions ne sont pas autorisés.
- Zéro rétention de données : seuls les fournisseurs avec une politique stricte de zéro rétention de données sont autorisés. Cette option n'est pas recommandée, car elle désactivera plusieurs fournisseurs populaires, comme Anthropic et OpenAI.

## Conseils et Notes

- **Sélection de Modèle :** OpenRouter offre une large gamme de modèles. Expérimentez pour trouver le meilleur pour vos besoins.
- **Tarification :** OpenRouter facture basé sur la tarification du modèle sous-jacent. Consultez la [Page des Modèles OpenRouter](https://openrouter.ai/models) pour les détails.
- **Cache de Prompts :** Certains fournisseurs supportent le cache de prompts. Consultez la documentation OpenRouter pour les modèles supportés.
