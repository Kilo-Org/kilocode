---
sidebar_label: OpenAI
---

# Utiliser OpenAI avec Kilo Code

Kilo Code supporte l'accès aux modèles directement via l'API OpenAI officielle.

**Site Web :** [https://openai.com/](https://openai.com/)

## Obtenir une Clé API

1.  **S'inscrire/Se connecter :** Allez à la [Plateforme OpenAI](https://platform.openai.com/). Créez un compte ou connectez-vous.
2.  **Naviguer vers les Clés API :** Allez à la page [Clés API](https://platform.openai.com/api-keys).
3.  **Créer une Clé :** Cliquez "Créer une nouvelle clé secrète". Donnez à votre clé un nom descriptif (par ex., "Kilo Code").
4.  **Copier la Clé :** **Important :** Copiez la clé API _immédiatement_. Vous ne pourrez plus la voir. Stockez-la de manière sécurisée.

## Modèles Supportés

Kilo Code supporte une variété de modèles OpenAI, incluant :

- `o3-mini` (effort de raisonnement moyen)
- `o3-mini-high` (effort de raisonnement élevé)
- `o3-mini-low` (effort de raisonnement faible)
- `o1`
- `o1-preview`
- `o1-mini`
- `gpt-4.5-preview`
- `gpt-4o`
- `gpt-4o-mini`

Référez-vous à la [Documentation des Modèles OpenAI](https://platform.openai.com/docs/models) pour la liste la plus à jour des modèles et capacités.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "OpenAI" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API OpenAI dans le champ "Clé API OpenAI".
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Tarification :** Référez-vous à la page [Tarification OpenAI](https://openai.com/pricing) pour les détails sur les coûts des modèles.
- **Service Azure OpenAI :** Si vous souhaitez utiliser le service Azure OpenAI, consultez notre section sur les fournisseurs [OpenAI-compatible](/providers/openai-compatible).
