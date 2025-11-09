---
sidebar_label: GCP Vertex AI
---

# Utiliser GCP Vertex AI avec Kilo Code

Kilo Code supporte l'accès aux modèles via Vertex AI de Google Cloud Platform, une plateforme d'apprentissage automatique gérée qui fournit l'accès à divers modèles de fondation, incluant la famille Claude d'Anthropic.

**Site Web :** [https://cloud.google.com/vertex-ai](https://cloud.google.com/vertex-ai)

## Prérequis

- **Compte Google Cloud :** Vous avez besoin d'un compte Google Cloud Platform (GCP) actif.
- **Projet :** Vous avez besoin d'un projet GCP avec l'API Vertex AI activée.
- **Accès Modèle :** Vous devez demander et vous voir accorder l'accès aux modèles Claude spécifiques sur Vertex AI que vous voulez utiliser. Consultez la [documentation Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin) pour les instructions.
- **Identifiants par Défaut d'Application (ADC) :** Kilo Code utilise les Identifiants par Défaut d'Application pour s'authentifier avec Vertex AI. La façon la plus simple de configurer cela est :
    1.  Installer la CLI Google Cloud : [https://cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install)
    2.  S'authentifier en utilisant : `gcloud auth application-default login`
- **Clé de Compte de Service (Alternative) :** Alternativement, vous pouvez vous authentifier en utilisant un fichier de clé de Compte de Service Google Cloud. Vous aurez besoin de générer cette clé dans votre projet GCP. Consultez la [documentation Google Cloud sur la création de clés de compte de service](https://cloud.google.com/iam/docs/creating-managing-service-account-keys).

## Modèles Supportés

Kilo Code supporte les modèles suivants via Vertex AI (basé sur le code source) :

- **Modèles Google Gemini :**
    - `gemini-2.5-flash-preview-05-20`
    - `gemini-2.0-flash-001`
    - `gemini-2.5-pro-exp-03-25`
    - `gemini-2.0-pro-exp-02-05`
    - `gemini-2.0-flash-lite-001`
    - `gemini-2.0-flash-thinking-exp-01-21`
    - `gemini-1.5-flash-002`
    - `gemini-1.5-pro-002`
- **Modèles Anthropic Claude :**
    - `claude-opus-4@20250514:thinking`
    - `claude-opus-4@20250514`
    - `claude-sonnet-4@20250514:thinking`
    - `claude-sonnet-4@20250514`
    - `claude-3-7-sonnet@20250219:thinking`
    - `claude-3-7-sonnet@20250219`
    - `claude-3-5-sonnet-v2@20241022`
    - `claude-3-5-sonnet@20240620`
    - `claude-3-5-haiku@20241022`
    - `claude-3-opus@20240229`
    - `claude-3-haiku@20240307`

Référez-vous à la [documentation Google Cloud sur les Modèles Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models) pour la liste la plus à jour des modèles disponibles et leurs IDs.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "GCP Vertex AI" dans le menu déroulant "Fournisseur API".
3.  **Configurer l'Authentification :**
    - **Si vous utilisez les Identifiants par Défaut d'Application (ADC) :** Aucune action supplémentaire n'est nécessaire ici. ADC sera utilisé automatiquement si configuré correctement (voir Prérequis).
    - **Si vous n'utilisez _pas_ ADC (Clé de Compte de Service) :**
        - **Option A: Coller le Contenu JSON :** Collez tout le contenu de votre fichier de clé JSON de Compte de Service dans le champ **Identifiants Google Cloud**.
        - **Option B: Fournir le Chemin de Fichier :** Saisissez le chemin absolu vers votre fichier de clé JSON de Compte de Service téléchargé dans le champ **Chemin du Fichier de Clé Google Cloud**.
4.  **Saisir l'ID de Projet :** Saisissez votre ID de Projet Google Cloud.
5.  **Sélectionner la Région :** Choisissez la région où vos ressources Vertex AI sont situées (par ex., `us-east5`).
6.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Permissions :** Assurez-vous que votre compte Google Cloud a les permissions nécessaires pour accéder à Vertex AI et aux modèles spécifiques que vous voulez utiliser.
- **Tarification :** Référez-vous à la page [tarification Vertex AI](https://cloud.google.com/vertex-ai/pricing) pour les détails.
