---
sidebar_label: Connexion à un fournisseur
---

# Connexion d'un fournisseur IA

Kilo Code nécessite une clé API d'un fournisseur de modèles IA pour fonctionner.

Nous recommandons ces options pour accéder au puissant modèle **Claude 4 Sonnet** :

- **Kilo Gateway (Recommandé) :** Fournit l'accès à tous les modèles disponibles via OpenRouter avec des tarifs compétitifs et des crédits gratuits pour commencer. [Voir les tarifs](https://kilocode.ai/pricing)
- **OpenRouter :** Fournit l'accès à plusieurs modèles IA via une seule clé API. [Voir les tarifs](https://openrouter.ai/models?order=pricing-low-to-high).
- **Anthropic :** Accès direct aux modèles Claude. Nécessite une approbation d'accès API et peut avoir des [limites de débit selon votre niveau](https://docs.anthropic.com/en/api/rate-limits#requirements-to-advance-tier). Consultez la [page des tarifs d'Anthropic](https://www.anthropic.com/pricing#anthropic-api) pour plus de détails.

## Utilisation du fournisseur Kilo Code

Par défaut, lorsque vous installez l'extension Kilo Code, vous serez invité à vous connecter ou à créer un compte dans le [Fournisseur Kilo Code](/providers/kilocode).

Cela vous guidera à travers la configuration du compte et configurera _automatiquement_ Kilo Code correctement pour vous permettre de commencer. Si vous préférez utiliser un autre fournisseur, vous devrez obtenir manuellement votre clé API comme décrit ci-dessous.

## Utilisation d'un autre fournisseur API

_Bientôt disponible dans Kilo Code Teams et Enterprise !_

### Obtenir votre clé API

#### Option 1 : Routeurs LLM

Les routeurs LLM vous permettent d'accéder à plusieurs modèles IA avec une seule clé API, simplifiant la gestion des coûts et le changement entre les modèles. Ils offrent souvent des [tarifs compétitifs](https://openrouter.ai/models?order=pricing-low-to-high) par rapport aux fournisseurs directs.

##### OpenRouter

1. Allez sur [openrouter.ai](https://openrouter.ai/)
2. Connectez-vous avec votre compte Google ou GitHub
3. Accédez à la [page des clés API](https://openrouter.ai/keys) et créez une nouvelle clé
4. Copiez votre clé API - vous en aurez besoin pour la configuration de Kilo Code

<img src="/docs/img/connecting-api-provider/connecting-api-provider-4.png" alt="Page des clés API OpenRouter" width="600" />

_Tableau de bord OpenRouter avec le bouton "Create key". Nommez votre clé et copiez-la après création._

##### Requesty

1. Allez sur [requesty.ai](https://requesty.ai/)
2. Connectez-vous avec votre compte Google ou votre e-mail
3. Accédez à la [page de gestion API](https://app.requesty.ai/manage-api) et créez une nouvelle clé
4. **Important :** Copiez votre clé API immédiatement car elle ne sera plus affichée

<img src="/docs/img/connecting-api-provider/connecting-api-provider-7.png" alt="Page de gestion API Requesty" width="600" />

_Page de gestion API Requesty avec le bouton "Create API Key". Copiez votre clé immédiatement - elle n'est affichée qu'une seule fois._

#### Option 2 : Fournisseurs directs

Pour un accès direct à des modèles spécifiques depuis leurs fournisseurs d'origine, avec un accès complet à leurs fonctionnalités et capacités :

##### Anthropic

1. Allez sur [console.anthropic.com](https://console.anthropic.com/)
2. Inscrivez-vous à un compte ou connectez-vous
3. Accédez à la [section des clés API](https://console.anthropic.com/settings/keys) et créez une nouvelle clé
4. **Important :** Copiez votre clé API immédiatement car elle ne sera plus affichée

<img src="/docs/img/connecting-api-provider/connecting-api-provider-5.png" alt="Section des clés API de la console Anthropic" width="600" />

_Section des clés API de la console Anthropic avec le bouton "Create key". Nommez votre clé, définissez une expiration et copiez-la immédiatement._

##### OpenAI

1. Allez sur [platform.openai.com](https://platform.openai.com/)
2. Inscrivez-vous à un compte ou connectez-vous
3. Accédez à la [section des clés API](https://platform.openai.com/api-keys) et créez une nouvelle clé
4. **Important :** Copiez votre clé API immédiatement car elle ne sera plus affichée

<img src="/docs/img/connecting-api-provider/connecting-api-provider-6.png" alt="Page des clés API OpenAI" width="600" />

_Plateforme OpenAI avec le bouton "Create new secret key". Nommez votre clé et copiez-la immédiatement après création._

### Configuration du fournisseur dans Kilo Code

Une fois que vous avez votre clé API :

1. Ouvrez la barre latérale Kilo Code en cliquant sur l'icône Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" />) dans la barre latérale VS Code
2. Dans l'écran de bienvenue, sélectionnez votre fournisseur API dans le menu déroulant
3. Collez votre clé API dans le champ approprié
4. Sélectionnez votre modèle :
    - Pour **OpenRouter** : sélectionnez `anthropic/claude-3.7-sonnet` ([détails du modèle](https://openrouter.ai/anthropic/claude-3.7-sonnet))
    - Pour **Anthropic** : sélectionnez `claude-3-7-sonnet-20250219` ([détails du modèle](https://www.anthropic.com/pricing#anthropic-api))
5. Cliquez sur "Let's go!" pour enregistrer vos paramètres et commencer à utiliser Kilo Code
