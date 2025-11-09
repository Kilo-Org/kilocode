---
sidebar_label: AWS Bedrock
---

# Utiliser AWS Bedrock avec Kilo Code

Kilo Code supporte l'accès aux modèles via Amazon Bedrock, un service entièrement géré qui rend une sélection de modèles de fondation (FMs) performants de sociétés d'IA de premier plan disponibles via une API unique.

**Site Web :** [https://aws.amazon.com/bedrock/](https://aws.amazon.com/bedrock/)

## Prérequis

- **Compte AWS :** Vous avez besoin d'un compte AWS actif.
- **Accès Bedrock :** Vous devez demander et vous voir accorder l'accès à Amazon Bedrock. Consultez la [documentation AWS Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/getting-started.html) pour les détails sur la demande d'accès.
- **Accès Modèle :** Dans Bedrock, vous devez demander l'accès aux modèles spécifiques que vous voulez utiliser (par ex., Anthropic Claude).
- **Installer AWS CLI :** Utilisez AWS CLI pour configurer votre compte pour l'authentification
    ```bash
     aws configure
    ```

## Obtenir des Identifiants

Vous avez deux options principales pour configurer les identifiants AWS :

1.  **Clés d'Accès AWS (Recommandé pour le Développement) :**
    - Créez un utilisateur IAM avec les permissions nécessaires (au moins `bedrock:InvokeModel`).
    - Générez un ID de clé d'accès et une clé d'accès secrète pour cet utilisateur.
    - _(Optionnel)_ Créez un jeton de session si requis par votre configuration IAM.
2.  **Profil AWS :**
    - Configurez un profil AWS en utilisant AWS CLI ou en éditant manuellement votre fichier d'identifiants AWS. Consultez la [documentation AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html) pour les détails.

## Modèles Supportés

Kilo Code supporte les modèles suivants via Bedrock (basé sur le code source) :

- **Amazon :**
    - `amazon.nova-pro-v1:0`
    - `amazon.nova-pro-latency-optimized-v1:0`
    - `amazon.nova-lite-v1:0`
    - `amazon.nova-micro-v1:0`
    - `amazon.titan-text-lite-v1:0`
    - `amazon.titan-text-express-v1:0`
    - `amazon.titan-text-embeddings-v1:0`
    - `amazon.titan-text-embeddings-v2:0`
- **Anthropic :**
    - `anthropic.claude-3-7-sonnet-20250219-v1:0`
    - `anthropic.claude-3-5-sonnet-20241022-v2:0`
    - `anthropic.claude-3-5-haiku-20241022-v1:0`
    - `anthropic.claude-3-5-sonnet-20240620-v1:0`
    - `anthropic.claude-3-opus-20240229-v1:0`
    - `anthropic.claude-3-sonnet-20240229-v1:0`
    - `anthropic.claude-3-haiku-20240307-v1:0`
    - `anthropic.claude-2-1-v1:0`
    - `anthropic.claude-2-0-v1:0`
    - `anthropic.claude-instant-v1:0`
- **DeepSeek :**
    - `deepseek.r1-v1:0`
- **Meta :**
    - `meta.llama3-3-70b-instruct-v1:0`
    - `meta.llama3-2-90b-instruct-v1:0`
    - `meta.llama3-2-11b-instruct-v1:0`
    - `meta.llama3-2-3b-instruct-v1:0`
    - `meta.llama3-2-1b-instruct-v1:0`
    - `meta.llama3-1-405b-instruct-v1:0`
    - `meta.llama3-1-70b-instruct-v1:0`
    - `meta.llama3-1-70b-instruct-latency-optimized-v1:0`
    - `meta.llama3-1-8b-instruct-v1:0`
    - `meta.llama3-70b-instruct-v1:0`
    - `meta.llama3-8b-instruct-v1:0`

Référez-vous à la [documentation Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html) pour la liste la plus à jour des modèles disponibles et leurs IDs. Assurez-vous d'utiliser l'_ID de modèle_ lors de la configuration de Kilo Code, pas le nom de modèle.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Bedrock" dans le menu déroulant "Fournisseur API".
3.  **Sélectionner la Méthode d'Authentification :**
    - **Identifiants AWS :**
        - Saisissez votre "Clé d'Accès AWS" et "Clé Secrète AWS".
        - (Optionnel) Saisissez votre "Jeton de Session AWS" si vous utilisez des identifiants temporaires.
    - **Profil AWS :**
        - Saisissez le nom de votre "Profil AWS" (par ex., "default").
4.  **Sélectionner la Région :** Choisissez la région AWS où votre service Bedrock est disponible (par ex., "us-east-1").
5.  **(Optionnel) Inférence Inter-Région :** Cochez "Utiliser l'inférence inter-région" si vous voulez accéder aux modèles dans une région différente de votre région AWS configurée.
6.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Permissions :** Assurez-vous que votre utilisateur ou rôle IAM a les permissions nécessaires pour invoquer les modèles Bedrock. La permission `bedrock:InvokeModel` est requise.
- **Tarification :** Référez-vous à la page [tarification Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) pour les détails sur les coûts des modèles.
- **Inférence Inter-Région :** Utiliser l'inférence inter-région peut résulter en une latence plus élevée.
