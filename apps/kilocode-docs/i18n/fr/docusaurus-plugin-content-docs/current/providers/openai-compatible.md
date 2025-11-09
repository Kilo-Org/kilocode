---
sidebar_label: OpenAI Compatible
---

# Utiliser les Fournisseurs Compatibles OpenAI avec Kilo Code

Kilo Code supporte une large gamme de fournisseurs de modèles d'IA qui offrent des APIs compatibles avec le standard d'API OpenAI. Ceci signifie que vous pouvez utiliser des modèles de fournisseurs _autres que_ OpenAI, tout en utilisant une interface d'API familière. Ceci inclut les fournisseurs comme :

- **Modèles locaux** exécutés à travers des outils comme Ollama et LM Studio (couverts dans des sections séparées).
- **Fournisseurs cloud** comme Perplexity, Together AI, Anyscale, et d'autres.
- **Tout autre fournisseur** offrant un point de terminaison API compatible OpenAI.

Ce document se concentre sur la configuration des fournisseurs _autres que_ l'API OpenAI officielle (qui a sa [page de configuration dédiée](/providers/openai)).

## Configuration Générale

La clé pour utiliser un fournisseur compatible OpenAI est de configurer deux paramètres principaux :

1.  **URL de Base :** C'est le point de terminaison API pour le fournisseur. Il ne sera _pas_ `https://api.openai.com/v1` (c'est pour l'API OpenAI officielle).
2.  **Clé API :** C'est la clé secrète que vous obtenez du fournisseur.
3.  **ID de Modèle :** C'est le nom de modèle du modèle spécifique.

Vous trouverez ces paramètres dans le panneau de paramètres Kilo Code (cliquez sur l'icône <Codicon name="gear" />) :

- **Fournisseur API :** Sélectionnez "OpenAI Compatible".
- **URL de Base :** Saisissez l'URL de base fournie par votre fournisseur choisi. **Ceci est crucial.**
- **Clé API :** Saisissez votre clé API.
- **Modèle :** Choisissez un modèle.
- **Configuration de Modèle :** Ceci vous permet de personnaliser la configuration avancée pour le modèle
    - Max Tokens de Sortie
    - Fenêtre de Contexte
    - Support d'Image
    - Utilisation d'Ordinateur
    - Prix d'Entrée
    - Prix de Sortie

### Support d'URL de Point de Terminaison Complet

Kilo Code supporte les URLs de point de terminaison complètes dans le champ URL de Base, fournissant une plus grande flexibilité pour la configuration de fournisseur :

**Format d'URL de Base Standard :**

```
https://api.provider.com/v1
```

**Format d'URL de Point de Terminaison Complet :**

```
https://api.provider.com/v1/chat/completions
https://custom-endpoint.provider.com/api/v2/models/chat
```

Cette amélioration vous permet de :

- Vous connecter à des fournisseurs avec des structures de point de terminaison non-standard
- Utiliser des passerelles API personnalisées ou des services proxy
- Travailler avec des fournisseurs qui requièrent des chemins de point de terminaison spécifiques
- S'intégrer avec des déploiements API d'entreprise ou auto-hébergés

**Note :** Quand vous utilisez des URLs de point de terminaison complètes, assurez-vous que l'URL pointe vers le point de terminaison de complétions de chat correct pour votre fournisseur.

## Modèles Supportés (pour le Point de Terminaison OpenAI Natif)

Bien que ce type de fournisseur permette de se connecter à divers points de terminaison, si vous vous connectez directement à l'API OpenAI officielle (ou un point de terminaison qui la reflète exactement), Kilo Code reconnaît les IDs de modèles suivants basés sur la définition `openAiNativeModels` dans son code source :

- `o3-mini`
- `o3-mini-high`
- `o3-mini-low`
- `o1`
- `o1-preview`
- `o1-mini`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`

**Note :** Si vous utilisez un fournisseur compatible OpenAI différent (comme Together AI, Anyscale, etc.), les IDs de modèles disponibles varieront. Référez-vous toujours à la documentation de votre fournisseur spécifique pour leurs noms de modèles supportés.

## Dépannage

- **"Clé API Invalide" :** Vérifiez deux fois que vous avez saisi la clé API correctement.
- **"Modèle Non Trouvé" :** Assurez-vous que vous utilisez un ID de modèle valide pour votre fournisseur choisi.
- **Erreurs de Connexion :** Vérifiez que l'URL de Base est correcte et que l'API de votre fournisseur est accessible.
- **Résultats Inattendus :** Si vous obtenez des résultats inattendus, essayez un modèle différent.

En utilisant un fournisseur compatible OpenAI, vous pouvez exploiter la flexibilité de Kilo Code avec une plus large gamme de modèles d'IA. Référez-vous toujours à la documentation de votre fournisseur pour les informations les plus précises et à jour.
