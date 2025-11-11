---
sidebar_label: Google Gemini
---

# Utiliser Google Gemini avec Kilo Code

Kilo Code supporte la famille de modèles Gemini de Google via l'API Google AI Gemini.

**Site Web :** [https://ai.google.dev/](https://ai.google.dev/)

## Obtenir une Clé API

1.  **Aller à Google AI Studio :** Naviguez vers [https://ai.google.dev/](https://ai.google.dev/).
2.  **Se connecter :** Connectez-vous avec votre compte Google.
3.  **Créer une Clé API :** Cliquez sur "Créer une clé API" dans le menu de gauche.
4.  **Copier la Clé API :** Copiez la clé API générée.

## Modèles Supportés

Kilo Code supporte les modèles Gemini suivants :

### Modèles de Chat

- `gemini-2.5-pro-exp-03-25`
- `gemini-2.0-flash-001`
- `gemini-2.0-flash-lite-preview-02-05`
- `gemini-2.0-pro-exp-02-05`
- `gemini-2.0-flash-thinking-exp-01-21`
- `gemini-2.0-flash-thinking-exp-1219`
- `gemini-2.0-flash-exp`
- `gemini-1.5-flash-002`
- `gemini-1.5-flash-exp-0827`
- `gemini-1.5-flash-8b-exp-0827`
- `gemini-1.5-pro-002`
- `gemini-1.5-pro-exp-0827`
- `gemini-exp-1206`

### Modèles d'Embeddings

- `gemini-embedding-001` - Optimisé pour l'indexation de base de code et la recherche sémantique

Référez-vous à la [documentation Gemini](https://ai.google.dev/models/gemini) pour plus de détails sur chaque modèle.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Google Gemini" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API Gemini dans le champ "Clé API Gemini".
4.  **Sélectionner le Modèle :** Choisissez votre modèle Gemini désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Tarification :** L'utilisation de l'API Gemini est tarifée basée sur les tokens d'entrée et de sortie. Référez-vous à la [page de tarification Gemini](https://ai.google.dev/pricing) pour des informations détaillées.
- **Indexation de Base de Code :** Le modèle `gemini-embedding-001` est spécifiquement supporté pour l'[indexation de base de code](/features/codebase-indexing), fournissant des embeddings de haute qualité pour la recherche sémantique de code.
