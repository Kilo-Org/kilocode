---
sidebar_label: API de Modèle de Langage VS Code
---

# Utiliser l'API de Modèle de Langage VS Code avec Kilo Code

Kilo Code inclut un support _expérimental_ pour l'[API de Modèle de Langage VS Code](https://code.visualstudio.com/api/language-extensions/language-model-access). Cette API permet aux extensions de fournir l'accès aux modèles de langage directement dans VS Code. Ceci signifie que vous pouvez potentiellement utiliser des modèles de :

- **GitHub Copilot :** Si vous avez un abonnement Copilot et l'extension installée.
- **Autres Extensions VS Code :** Toute extension qui implémente l'API de Modèle de Langage.

**Important :** Cette intégration est hautement expérimentale et peut ne pas fonctionner comme attendu. Elle dépend d'autres extensions implémentant correctement l'API de Modèle de Langage VS Code.

## Prérequis

- **VS Code :** L'API de Modèle de Langage est disponible à travers VS Code (et n'est actuellement pas supportée par Cursor).
- **Une Extension Fournisseur de Modèle de Langage :** Vous avez besoin d'une extension qui fournit un modèle de langage. Les exemples incluent :
    - **GitHub Copilot :** Si vous avez un abonnement Copilot, les extensions GitHub Copilot et GitHub Copilot Chat peuvent fournir des modèles.
    - **Autres Extensions :** Recherchez dans le Marketplace VS Code les extensions qui mentionnent "Language Model API" ou "lm". Il pourrait y avoir d'autres extensions expérimentales disponibles.

## Configuration

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "VS Code LM API" dans le menu déroulant "Fournisseur API".
3.  **Sélectionner le Modèle :** Le menu déroulant "Modèle de Langage" listera (éventuellement) les modèles disponibles. Le format est `vendor/family`. Par exemple, si vous avez Copilot, vous pourriez voir des options comme :
    - `copilot - claude-3.5-sonnet`
    - `copilot - o3-mini`
    - `copilot - o1-ga`
    - `copilot - gemini-2.0-flash`

## Limitations

- **API Expérimentale :** L'API de Modèle de Langage VS Code est encore en développement. Attendez-vous à des changements et une instabilité potentielle.
- **Dépendant des Extensions :** Cette fonctionnalité s'appuie entièrement sur d'autres extensions fournissant des modèles. Kilo Code ne peut pas contrôler directement quels modèles sont disponibles.
- **Fonctionnalité Limitée :** L'API de Modèle de Langage VS Code peut ne pas supporter toutes les fonctionnalités d'autres fournisseurs API (par ex., entrée d'image, streaming, informations d'utilisation détaillées).
- **Pas de Contrôle de Coût Direct :** Vous êtes sujet à la tarification et aux termes de l'extension fournissant le modèle. Kilo Code ne peut pas directement suivre ou limiter les coûts.
- **Limites de Débit GitHub Copilot :** Quand vous utilisez l'API VS Code LM avec GitHub Copilot, soyez conscient que GitHub peut imposer des limites de débit sur l'utilisation Copilot. Ces limites sont contrôlées par GitHub, pas par Kilo Code.

## Dépannage

- **Aucun Modèle n'Apparaît :**
    - Assurez-vous d'avoir VS Code installé.
    - Assurez-vous d'avoir une extension fournisseur de modèle de langage installée et activée (par ex., GitHub Copilot, GitHub Copilot Chat).
    - Si vous utilisez Copilot, assurez-vous d'avoir envoyé un message Copilot Chat en utilisant le modèle que vous aimeriez utiliser.
- **Comportement Inattendu :** Si vous rencontrez un comportement inattendu, c'est probablement un problème avec l'API de Modèle de Langage sous-jacente ou l'extension fournisseur. Considérez signaler le problème aux développeurs de l'extension fournisseur.
