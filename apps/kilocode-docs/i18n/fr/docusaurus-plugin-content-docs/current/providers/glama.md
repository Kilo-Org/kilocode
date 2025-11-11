---
sidebar_label: Glama
---

# Utiliser Glama avec Kilo Code

Glama fournit l'accès à une variété de modèles de langage via une API unifiée, incluant les modèles d'Anthropic, OpenAI, et d'autres. Il offre des fonctionnalités comme le cache de prompts et le suivi de coûts.

**Site Web :** [https://glama.ai/](https://glama.ai/)

## Obtenir une Clé API

1.  **S'inscrire/Se connecter :** Allez à la [page d'inscription Glama](https://glama.ai/sign-up). Inscrivez-vous en utilisant votre compte Google ou nom/email/mot de passe.
2.  **Obtenir une Clé API :** Après l'inscription, naviguez vers la page [Clés API](https://glama.ai/settings/gateway/api-keys) pour obtenir une clé API.
3.  **Copier la Clé :** Copiez la clé API affichée.

## Modèles Supportés

Kilo Code tentera automatiquement de récupérer une liste des modèles disponibles depuis l'API Glama. Certains modèles couramment disponibles via Glama incluent :

- **Modèles Anthropic Claude :** (par ex., `anthropic/claude-3-5-sonnet`) Ces sont généralement recommandés pour les meilleures performances avec Kilo Code.
- **Modèles OpenAI :** (par ex., `openai/o3-mini-high`)
- **Autres fournisseurs et modèles open-source**

Référez-vous à la [documentation Glama](https://glama.ai/models) pour la liste la plus à jour des modèles supportés.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Glama" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API Glama dans le champ "Clé API Glama".
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Tarification :** Glama opère sur une base de paiement par utilisation. La tarification varie selon le modèle que vous choisissez.
- **Cache de Prompts :** Glama supporte le cache de prompts, qui peut réduire significativement les coûts et améliorer la performance pour les prompts répétés.
