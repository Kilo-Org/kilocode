---
sidebar_label: Anthropic
---

# Utiliser Anthropic avec Kilo Code

Anthropic est une société de sécurité et de recherche en IA qui construit des systèmes d'IA fiables, interprétables et pilotables. Leurs modèles Claude sont connus pour leurs fortes capacités de raisonnement, leur utilité et leur honnêteté.

**Site Web :** [https://www.anthropic.com/](https://www.anthropic.com/)

## Obtenir une Clé API

1. **S'inscrire/Se connecter :** Allez à la [Console Anthropic](https://console.anthropic.com/). Créez un compte ou connectez-vous.
2. **Naviguer vers les Clés API :** Allez à la section [Clés API](https://console.anthropic.com/settings/keys).
3. **Créer une Clé :** Cliquez sur "Créer une Clé". Donnez à votre clé un nom descriptif (par ex., "Kilo Code").
4. **Copier la Clé :** **Important :** Copiez la clé API _immédiatement_. Vous ne pourrez plus la voir. Stockez-la de manière sécurisée.

## Modèles Supportés

Kilo Code supporte les modèles Anthropic Claude suivants :

- `claude-3-7-sonnet-20250219` (Recommandé)
- `claude-3-7-sonnet-20250219:thinking` (Variante de réflexion étendue)
- `claude-3-5-sonnet-20241022`
- `claude-3-5-haiku-20241022`
- `claude-3-opus-20240229`
- `claude-3-haiku-20240307`

Consultez la [Documentation des Modèles Anthropic](https://docs.anthropic.com/en/docs/about-claude/models) pour plus de détails sur les capacités de chaque modèle.

## Configuration dans Kilo Code

1. **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2. **Sélectionner le Fournisseur :** Choisissez "Anthropic" dans le menu déroulant "Fournisseur API".
3. **Saisir la Clé API :** Collez votre clé API Anthropic dans le champ "Clé API Anthropic".
4. **Sélectionner le Modèle :** Choisissez votre modèle Claude désiré dans le menu déroulant "Modèle".
5. **(Optionnel) URL de Base Personnalisée :** Si vous avez besoin d'utiliser une URL de base personnalisée pour l'API Anthropic, cochez "Utiliser l'URL de base personnalisée" et saisissez l'URL. La plupart des gens n'auront pas besoin d'ajuster cela.

## Conseils et Notes

- **Cache de Prompts :** Les modèles Claude 3 supportent le [cache de prompts](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching), qui peut réduire significativement les coûts et la latence pour les prompts répétés.
- **Fenêtre de Contexte :** Les modèles Claude ont de grandes fenêtres de contexte (200 000 tokens), vous permettant d'inclure une quantité significative de code et de contexte dans vos prompts.
- **Tarification :** Référez-vous à la page [Tarification Anthropic](https://www.anthropic.com/pricing) pour les informations de tarification les plus récentes.
- **Limites de Débit :** Anthropic a des limites de débit strictes basées sur les [niveaux d'utilisation](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier). Si vous atteignez répétitivement les limites de débit, considérez contacter les ventes Anthropic ou accéder à Claude à travers un fournisseur différent comme [OpenRouter](/providers/openrouter) ou [Requesty](/providers/requesty).
