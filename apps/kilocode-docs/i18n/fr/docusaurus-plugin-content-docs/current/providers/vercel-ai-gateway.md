---
description: Configurer la Passerelle AI de Vercel dans Kilo Code pour accéder de manière robuste à plus de 100 modèles de langage de divers fournisseurs à travers une interface centralisée.
keywords:
    - kilo code
    - vercel ai gateway
    - ai provider
    - language models
    - api configuration
    - model selection
    - prompt caching
    - usage tracking
    - byok
sidebar_label: Vercel AI Gateway
---

# Utiliser Vercel AI Gateway avec Kilo Code

La Passerelle AI fournit une API unifiée pour accéder à des centaines de modèles à travers un point de terminaison unique. Elle vous donne la capacité de définir des budgets, surveiller l'utilisation, équilibrer la charge des requêtes, et gérer les fallbacks.

Liens utiles :

- Tableau de bord d'équipe : https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai
- Catalogue de modèles : https://vercel.com/ai-gateway/models
- Docs : https://vercel.com/docs/ai-gateway

---

## Obtenir une Clé API

Une clé API est requise pour l'authentification.

1.  **S'inscrire/Se connecter :** Allez au [Site Web Vercel](https://vercel.com/) et connectez-vous.
2.  **Obtenir une Clé API :** Allez à la [page Clé API](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys&title=AI+Gateway+API+Key) dans l'onglet AI Gateway. Créez une nouvelle clé.
3.  **Copier la Clé :** Copiez la clé API.

---

## Modèles Supportés

La Passerelle AI Vercel supporte un grand nombre croissant de modèles. Kilo Code récupère automatiquement la liste des modèles disponibles depuis le point de terminaison `https://ai-gateway.vercel.sh/v1/models`. Seuls les modèles de langage sont montrés.

Le modèle par défaut est `anthropic/claude-sonnet-4` si aucun modèle n'est sélectionné.

Référez-vous à la [Page des Modèles Vercel AI Gateway](https://vercel.com/ai-gateway/models) pour la liste complète et à jour.

### Capacités de Modèle

- **Support Vision**: Beaucoup de modèles supportent les entrées d'image.
- **Outil/Utilisation d'Ordinateur**: Des modèles sélectionnés supportent les appels de fonction et l'utilisation d'ordinateur.

Consultez la description du modèle dans le menu déroulant pour les capacités spécifiques.

---

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Vercel AI Gateway" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API Vercel AI Gateway dans le champ "Clé API Vercel AI Gateway".
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

---

## Cache de Prompts

Vercel AI Gateway supporte le cache de prompts automatique pour des modèles sélectionnés incluant les modèles Anthropic Claude et OpenAI GPT. Ceci réduit les coûts en mettant en cache les prompts fréquemment utilisés.

---

## Conseils et Notes

- **Sélection de Modèle :** Vercel AI Gateway offre une large gamme de modèles. Expérimentez pour trouver le meilleur pour vos besoins.
- **Tarification :** Vercel AI Gateway facture basé sur la tarification du modèle sous-jacent, incluant les coûts pour les prompts mis en cache. Consultez la [Page des Modèles Vercel AI Gateway](https://vercel.com/ai-gateway/models) pour les détails.
- **Température :** La température par défaut est `0.7` et est configurable par modèle.
- **Apportez Votre Propre Clé (BYOK) :** Vercel AI Gateway n'a **aucune majoration** si vous décidez d'utiliser votre propre clé pour le service sous-jacent.
- **Plus d'info :** Vercel n'ajoute pas de limites de débit. Les fournisseurs amont peuvent en ajouter. Les nouveaux comptes reçoivent 5$ de crédits tous les 30 jours jusqu'au premier paiement.
