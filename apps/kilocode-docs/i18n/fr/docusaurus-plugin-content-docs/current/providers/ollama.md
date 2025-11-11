---
sidebar_label: Ollama
---

# Utiliser Ollama avec Kilo Code

Kilo Code supporte l'exécution de modèles localement en utilisant Ollama. Ceci fournit de la confidentialité, un accès hors ligne, et potentiellement des coûts plus bas, mais demande plus de configuration et un ordinateur puissant.

**Site Web :** [https://ollama.com/](https://ollama.com/)

<img src="/docs/img/providers/ollama-devstral-snake.png" alt="Vibe coding un jeu Snake en utilisant devstral" width="500" />
*Vibe coding un jeu Snake en utilisant devstral*

## Gérer les Attentes

Les LLMs qui peuvent être exécutés localement sont généralement beaucoup plus petits que les LLMs hébergés dans le cloud comme Claude et GPT et les résultats seront beaucoup moins impressionnants.
Ils sont beaucoup plus susceptibles de se coincer dans des boucles, échouer à utiliser les outils correctement ou produire des erreurs de syntaxe dans le code.
Plus d'expérimentation sera requise pour trouver le bon prompt.
Exécuter des LLMs localement est souvent aussi pas très rapide.
Utiliser des prompts simples, garder les conversations courtes et désactiver les outils MCP peut résulter en une accélération.

## Exigences Matérielles

Vous aurez besoin d'un GPU avec une grande quantité de VRAM (24GB ou plus) ou un MacBook avec une grande quantité de RAM unifiée (32GB ou plus) pour exécuter les modèles discutés ci-dessous à une vitesse décente.

## Sélectionner un Modèle

Ollama supporte beaucoup de modèles différents.
Vous pouvez trouver une liste des modèles disponibles sur le [site web Ollama](https://ollama.com/library).

Pour l'agent Kilo Code la recommandation actuelle est `qwen3-coder:30b`. `qwen3-coder:30b` échoue parfois à appeler les outils correctement (il est beaucoup plus susceptible d'avoir ce problème que le modèle `qwen3-coder:480b` complet). Comme un modèle de mixture d'experts, ceci pourrait être parce qu'il a activé les mauvais experts. À chaque fois que cela arrive, essayez de changer votre prompt ou utilisez le bouton Enhance Prompt.

Une alternative à `qwen3-coder:30b` est `devstral:24b`. Pour d'autres fonctionnalités de Kilo Code comme Enhance Prompt ou Génération de Message de Commit des modèles plus petits peuvent suffire.

## Configuration d'Ollama

Pour configurer Ollama pour l'utilisation avec Kilo Code, suivez les instructions ci-dessous.

### Télécharger et Installer Ollama

Téléchargez l'installateur Ollama depuis le [site web Ollama](https://ollama.com/) (ou utilisez le gestionnaire de paquets pour votre système d'exploitation). Suivez les instructions d'installation, puis assurez-vous qu'Ollama fonctionne :

```bash
ollama serve
```

### Télécharger un Modèle

Pour télécharger un modèle, ouvrez un deuxième terminal (`ollama serve` doit être en cours) et exécutez :

```bash
ollama pull <model_name>
```

Par exemple :

```bash
ollama pull qwen3-coder:30b
```

### Configurer la Taille de Contexte

Par défaut Ollama tronque les prompts à une longueur très courte, [comme documenté ici](https://github.com/ollama/ollama/blob/4383a3ab7a075eff78b31f7dc84c747e2fcd22b8/docs/faq.md#how-can-i-specify-the-context-window-size).

Vous devez avoir au moins 32k pour obtenir des résultats décents, mais augmenter la taille de contexte augmente l'utilisation de mémoire et peut diminuer la performance, dépendant de votre matériel.

Pour configurer la fenêtre de contexte, définissez "Taille de Fenêtre de Contexte (num_ctx)" dans les paramètres Fournisseur API.

### Configurer le Délai d'Attente

Par défaut, les requêtes API expirent après 10 minutes. Les modèles locaux peuvent être lents, si vous atteignez ce délai d'attente vous pouvez considérer l'augmenter ici : Panneau Extensions VS Code > Menu d'engrenage Kilo Code > Paramètres > Délai d'Attente de Requête API.

### Configurer Kilo Code

- Ouvrez la barre latérale Kilo Code (<img src="/docs/img/kilo-v1.svg" width="12" /> icône).
- Cliquez sur l'icône d'engrenage Paramètres (<Codicon name="gear" />).
- Sélectionnez "Ollama" comme le Fournisseur API.
- Sélectionnez le modèle configuré à l'étape précédente.
- (Optionnel) Vous pouvez configurer l'URL de base si vous exécutez Ollama sur une machine différente. Le défaut est `http://localhost:11434`.

## Lectures Complémentaires

Référez-vous à la [documentation Ollama](https://ollama.com/docs) pour plus d'informations sur l'installation, la configuration et l'utilisation d'Ollama.
