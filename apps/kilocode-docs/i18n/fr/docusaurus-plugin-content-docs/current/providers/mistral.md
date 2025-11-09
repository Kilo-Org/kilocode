---
sidebar_label: Mistral AI
---

# Utiliser Mistral AI avec Kilo Code

Kilo Code supporte l'accès aux modèles via l'API Mistral AI, incluant à la fois les modèles Mistral standard et le modèle spécialisé en code Codestral.

**Site Web :** [https://mistral.ai/](https://mistral.ai/)

## Obtenir une Clé API

1.  **S'inscrire/Se connecter :** Allez à la [Plateforme Mistral](https://console.mistral.ai/). Créez un compte ou connectez-vous. Vous pourriez avoir besoin de passer par un processus de vérification.
2.  **Créer une Clé API :**
    - [La Plateforme Clé API](https://console.mistral.ai/api-keys/) et/ou
    - [Codestral Clé API](https://console.mistral.ai/codestral)

## Modèles Supportés

Kilo Code supporte les modèles Mistral suivants :

| ID de Modèle         | Température par Défaut du Modèle | Appels de Fonction | Support Vision / Image |
| -------------------- | -------------------------------- | ------------------ | ---------------------- |
| codestral-latest     | 0.3                              | ✅                 | ❌                     |
| devstral             | 0.3                              | ✅                 | ❌                     |
| mistral-large-latest | 0.7                              | ✅                 | ❌                     |
| ministral-8b-latest  | 0.3                              | ✅                 | ❌                     |
| ministral-3b-latest  | 0.3                              | ✅                 | ❌                     |
| mistral-small-latest | 0.3                              | ✅                 | ❌                     |
| pixtral-large-latest | 0.7                              | ✅                 | ✅                     |

La température de modèle par défaut dans Kilo Code est 0.0, donc vous devriez considérer expérimenter avec les [ajustements de température](/features/model-temperature) !

**Note :** La disponibilité et les spécifications des modèles peuvent changer.
Référez-vous à la [documentation Mistral AI](https://docs.mistral.ai/api/) et [Aperçu des Modèles Mistral](https://docs.mistral.ai/getting-started/models/models_overview/) pour les dernières informations.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Mistral" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API Mistral dans le champ "Clé API Mistral" si vous utilisez un modèle `mistral`. Si vous avez l'intention d'utiliser `codestral-latest`, consultez la section "Codestral" ci-dessous.
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Utiliser Codestral

[Codestral](https://docs.mistral.ai/capabilities/code_generation/) est un modèle spécifiquement conçu pour la génération de code et l'interaction.
Seulement pour Codestral vous pourriez utiliser différents points de terminaison (Défaut : codestral.mistral.ai).
Pour la Clé API La Plateforme changez l'**URL de Base Codestral** à: https://api.mistral.ai

Pour utiliser Codestral :

1.  **Sélectionner "Mistral" comme le Fournisseur API.**
2.  **Sélectionner un Modèle Codestral**
3.  **Saisir votre Clé API Codestral (codestral.mistral.ai) ou La Plateforme (api.mistral.ai).**
