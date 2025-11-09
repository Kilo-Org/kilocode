---
sidebar_label: xAI (Grok)
---

# Utiliser xAI (Grok) avec Kilo Code

xAI est l'entreprise derrière Grok, un modèle de langage volumineux connu pour ses capacités conversationnelles et sa grande fenêtre de contexte. Les modèles Grok sont conçus pour fournir des réponses utiles, informatives et contextuellement pertinentes.

**Site Web :** [https://x.ai/](https://x.ai/)

## Obtenir une Clé API

1.  **S'inscrire/Se connecter :** Allez à la [Console xAI](https://console.x.ai/). Créez un compte ou connectez-vous.
2.  **Naviguer vers les Clés API :** Allez à la section des clés API dans votre tableau de bord.
3.  **Créer une Clé :** Cliquez pour créer une nouvelle clé API. Donnez à votre clé un nom descriptif (par ex., "Kilo Code").
4.  **Copier la Clé :** **Important :** Copiez la clé API _immédiatement_. Vous ne pourrez plus la voir. Stockez-la de manière sécurisée.

## Modèles Supportés

Kilo Code supporte les modèles xAI Grok suivants :

### Modèles Grok-3

- `grok-3-beta` (Défaut) - Le modèle beta Grok-3 d'xAI avec fenêtre de contexte 131K
- `grok-3-fast-beta` - Le modèle beta rapide Grok-3 d'xAI avec fenêtre de contexte 131K
- `grok-3-mini-beta` - Le modèle mini beta Grok-3 d'xAI avec fenêtre de contexte 131K
- `grok-3-mini-fast-beta` - Le modèle mini rapide beta Grok-3 d'xAI avec fenêtre de contexte 131K

### Modèles Grok-2

- `grok-2-latest` - Le modèle Grok-2 d'xAI - dernière version avec fenêtre de contexte 131K
- `grok-2` - Le modèle Grok-2 d'xAI avec fenêtre de contexte 131K
- `grok-2-1212` - Le modèle Grok-2 d'xAI (version 1212) avec fenêtre de contexte 131K

### Modèles Vision Grok

- `grok-2-vision-latest` - Le modèle Grok-2 Vision d'xAI - dernière version avec support d'image et fenêtre de contexte 32K
- `grok-2-vision` - Le modèle Grok-2 Vision d'xAI avec support d'image et fenêtre de contexte 32K
- `grok-2-vision-1212` - Le modèle Grok-2 Vision d'xAI (version 1212) avec support d'image et fenêtre de contexte 32K
- `grok-vision-beta` - Le modèle Grok Vision Beta d'xAI avec support d'image et fenêtre de contexte 8K

### Modèles Hérités

- `grok-beta` - Le modèle Grok Beta d'xAI (hérité) avec fenêtre de contexte 131K

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "xAI" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API xAI dans le champ "Clé API xAI".
4.  **Sélectionner le Modèle :** Choisissez votre modèle Grok désiré dans le menu déroulant "Modèle".

## Capacités de Raisonnement

Les modèles Grok 3 Mini présentent des capacités de raisonnement spécialisées, leur permettant de "réfléchir avant de répondre" - particulièrement utile pour des tâches complexes de résolution de problèmes.

### Modèles avec Raisonnement Activé

Le raisonnement n'est supporté que par :

- `grok-3-mini-beta`
- `grok-3-mini-fast-beta`

Les modèles Grok 3 `grok-3-beta` et `grok-3-fast-beta` ne supportent pas le raisonnement.

### Contrôler l'Effort de Raisonnement

Quand vous utilisez des modèles avec raisonnement activé, vous pouvez contrôler à quel point le modèle réfléchit avec le paramètre `reasoning_effort` :

- `faible` : Temps de réflexion minimal, utilisant moins de tokens pour des réponses rapides
- `élevé` : Temps de réflexion maximum, exploitant plus de tokens pour des problèmes complexes

Choisissez `faible` pour des requêtes simples qui devraient se compléter rapidement, et `élevé` pour des problèmes plus difficiles où la latence de réponse est moins importante.

### Fonctionnalités Clés

- **Résolution de Problème Étape par Étape** : Le modèle réfléchit aux problèmes méthodiquement avant de fournir une réponse
- **Force Math & Quantitative** : Excelle aux défis numériques et aux puzzles logiques
- **Accès à la Trace de Raisonnement** : Le processus de réflexion du modèle est disponible via le champ `reasoning_content` dans l'objet de complétion de réponse

## Conseils et Notes

- **Fenêtre de Contexte :** La plupart des modèles Grok présentent de grandes fenêtres de contexte (jusqu'à 131K tokens), vous permettant d'inclure des quantités substantielles de code et de contexte dans vos prompts.
- **Capacités Vision :** Sélectionnez les modèles avec vision activée (`grok-2-vision-latest`, `grok-2-vision`, etc.) quand vous avez besoin de traiter ou analyser des images.
- **Tarification :** La tarification varie par modèle, avec des coûts d'entrée allant de 0,3$ à 5,0$ par million de tokens et des coûts de sortie de 0,5$ à 25,0$ par million de tokens. Référez-vous à la documentation xAI pour les informations de tarification les plus actuelles.
- **Compromis de Performance :** Les variantes "rapides" offrent généralement des temps de réponse plus rapides mais peuvent avoir des coûts plus élevés, tandis que les variantes "mini" sont plus économiques mais peuvent avoir des capacités réduites.
