---
sidebar_label: Claude Code
---

# Utiliser Claude Code avec Kilo Code

Claude Code est l'officiel CLI d'Anthropic qui fournit l'accès direct aux modèles Claude depuis votre terminal. Utiliser Claude Code avec Kilo Code vous permet de tirer parti de votre configuration CLI existante sans avoir besoin de clés API séparées.

**Site Web :** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## Installer et Configurer Claude Code

1. **Installer Claude Code :** Suivez les instructions d'installation dans la [documentation Claude Code d'Anthropic](https://docs.anthropic.com/en/docs/claude-code/setup).
2. **S'authentifier :** Exécutez `claude` dans votre terminal. Claude Code offre plusieurs options d'authentification incluant la Console Anthropic (défaut), l'App Claude avec les plans Pro/Max, et les plateformes d'entreprise comme Amazon Bedrock ou Google Vertex AI. Consultez la [documentation d'authentification d'Anthropic](https://docs.anthropic.com/en/docs/claude-code/setup) pour les détails complets.
3. **Vérifier l'Installation :** Testez que tout fonctionne en exécutant `claude --version` dans votre terminal.

:::warning Utilisation de Variable d'Environnement
L'outil en ligne de commande `claude`, comme autres SDKs Anthropic, peut utiliser la variable d'environnement `ANTHROPIC_API_KEY` pour l'authentification. C'est une méthode commune pour autoriser les outils CLI dans des environnements non-interactifs.

Si cette variable d'environnement est définie sur votre système, l'outil `claude` peut l'utiliser pour l'authentification au lieu de la méthode interactive `/login`. Quand Kilo Code exécute l'outil, il reflétera précisément qu'une clé API est utilisée, car c'est le comportement sous-jacent du CLI `claude` lui-même.
:::

**Site Web :** [https://docs.anthropic.com/en/docs/claude-code/setup](https://docs.anthropic.com/en/docs/claude-code/setup)

## Modèles Supportés

Kilo Code supporte les modèles Claude suivants via Claude Code :

- **Claude Opus 4.1** (Le plus capable)
- **Claude Opus 4**
- **Claude Sonnet 4** (Le plus récent, recommandé)
- **Claude 3.7 Sonnet**
- **Claude 3.5 Sonnet**
- **Claude 3.5 Haiku** (Réponses rapides)

Les modèles spécifiques disponibles dépendent de votre abonnement et plan Claude. Consultez la [Documentation des Modèles Anthropic](https://docs.anthropic.com/en/docs/about-claude/models) pour plus de détails sur les capacités de chaque modèle.

## Configuration dans Kilo Code

1. **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2. **Sélectionner le Fournisseur :** Choisissez "Claude Code" dans le menu déroulant "Fournisseur API".
3. **Sélectionner le Modèle :** Choisissez votre modèle Claude désiré dans le menu déroulant "Modèle".
4. **(Optionnel) Chemin CLI Personnalisé :** Si vous avez installé Claude Code à un emplacement autre que la commande `claude` par défaut, entrez le chemin complet vers votre exécutable Claude dans le champ "Chemin Claude Code". La plupart des utilisateurs n'auront pas besoin de changer cela.

## Conseils et Notes

- **Pas de Clés API Requises :** Claude Code utilise votre authentification CLI existante, donc vous n'avez pas besoin de gérer des clés API séparées.
- **Transparence des Coûts :** Les coûts d'utilisation sont rapportés directement par le CLI Claude, vous donnant une visibilité claire sur vos dépenses.
- **Raisonnement Avancé :** Support complet pour les modes de réflexion et capacités de raisonnement de Claude quand disponible.
- **Fenêtres de Contexte :** Les modèles Claude ont de grandes fenêtres de contexte, vous permettant d'inclure des quantités significatives de code et de contexte dans vos prompts.
- **Fonctionnalité Enhance Prompt :** Compatibilité complète avec la fonctionnalité Enhance Prompt de Kilo Code, vous permettant d'améliorer et d'affiner automatiquement vos prompts avant de les envoyer à Claude.
- **Chemins Personnalisés :** Si vous avez installé Claude Code dans un emplacement non-standard, vous pouvez spécifier le chemin complet dans les paramètres. Exemples :
    - Windows : `C:\tools\claude\claude.exe`
    - macOS/Linux : `/usr/local/bin/claude` ou `~/bin/claude`

## Dépannage

- **"Le processus Claude Code s'est terminé avec une erreur" :** Vérifiez que Claude Code est installé (`claude --version`) et authentifié (`claude auth login`). Assurez-vous que votre abonnement inclut le modèle sélectionné.
- **Le chemin personnalisé ne fonctionne pas :** Utilisez le chemin absolu complet vers l'exécutable Claude et vérifiez que le fichier existe et est exécutable. Sur Windows, incluez l'extension `.exe`.
