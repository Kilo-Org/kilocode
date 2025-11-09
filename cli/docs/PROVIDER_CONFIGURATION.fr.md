# Guide de Configuration des Fournisseurs

Ce guide fournit des informations détaillées sur la configuration de chaque fournisseur dans Kilo Code CLI. Chaque fournisseur a des exigences de configuration spécifiques et des paramètres optionnels qui peuvent être personnalisés selon vos besoins.

## Table des Matières

- [Introduction](#introduction)
- [Méthodes de Configuration](#méthodes-de-configuration)
- [Détails des Fournisseurs](#détails-des-fournisseurs)
    - [Kilo Code](#kilocode)
    - [Anthropic](#anthropic)
    - [OpenAI Natif](#openai-native)
    - [OpenRouter](#openrouter)
    - [AWS Bedrock](#bedrock)
    - [Google Gemini](#gemini)
    - [Google Vertex AI](#vertex)
    - [Claude Code](#claude-code)
    - [Mistral](#mistral)
    - [Groq](#groq)
    - [DeepSeek](#deepseek)
    - [xAI](#xai)
    - [Cerebras](#cerebras)
    - [Ollama](#ollama)
    - [LM Studio](#lmstudio)
    - [VSCode Language Model](#vscode-lm)
    - [OpenAI](#openai)
    - [Glama](#glama)
    - [HuggingFace](#huggingface)
    - [LiteLLM](#litellm)
    - [Moonshot](#moonshot)
    - [Doubao](#doubao)
    - [Chutes](#chutes)
    - [SambaNova](#sambanova)
    - [Fireworks](#fireworks)
    - [Featherless](#featherless)
    - [DeepInfra](#deepinfra)
    - [IO Intelligence](#io-intelligence)
    - [Qwen Code](#qwen-code)
    - [Gemini CLI](#gemini-cli)
    - [ZAI](#zai)
    - [Unbound](#unbound)
    - [Requesty](#requesty)
    - [Roo](#roo)
    - [Vercel AI Gateway](#vercel-ai-gateway)
    - [Virtual Quota Fallback](#virtual-quota-fallback)
    - [Human Relay](#human-relay)
    - [Fake AI](#fake-ai)

## Introduction

Kilo Code CLI prend en charge plusieurs fournisseurs d'IA, chacun ayant ses propres exigences de configuration. Ce document détaille les champs de configuration pour chaque fournisseur, y compris les paramètres requis et optionnels.

## Méthodes de Configuration

Vous pouvez configurer les fournisseurs en utilisant :

1. **CLI Interactif** : Exécutez `kilocode config` pour configurer les fournisseurs de manière interactive
2. **Fichier de Configuration** : Modifiez directement votre fichier de configuration (généralement situé dans votre répertoire de configuration utilisateur)
3. **Variables d'Environnement** : Certains fournisseurs prennent en charge la configuration par variables d'environnement

---

## Détails des Fournisseurs

### kilocode

Le fournisseur officiel Kilo Code pour accéder aux services d'IA gérés par Kilo Code.

**Description** : Accédez à l'infrastructure d'IA gérée par Kilo Code avec prise en charge de plusieurs modèles et organisations.

**Champs Requis** :

- `kilocodeToken` (password) : Votre token d'authentification Kilo Code
- `kilocodeModel` (text) : Le modèle à utiliser (par défaut : `anthropic/claude-sonnet-4.5`)

**Champs Optionnels** :

- `kilocodeOrganizationId` (text) : ID d'organisation pour les comptes d'équipe (laisser vide pour un usage personnel)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "kilocode",
	"kilocodeToken": "your-token-here",
	"kilocodeModel": "anthropic/claude-sonnet-4",
	"kilocodeOrganizationId": "org-123456"
}
```

**Modèle par Défaut** : `anthropic/claude-sonnet-4.5`

---

### anthropic

Intégration directe avec l'API Claude de Anthropic.

**Description** : Utilisez les modèles Claude directement depuis Anthropic avec votre propre clé API.

**Champs Requis** :

- `apiKey` (password) : Votre clé API Anthropic
- `apiModelId` (text) : Le modèle Claude à utiliser (par défaut : `claude-sonnet-4.5`)

**Champs Optionnels** :

- `anthropicBaseUrl` (text) : URL de base personnalisée pour les requêtes API (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "anthropic",
	"apiKey": "sk-ant-...",
	"apiModelId": "claude-sonnet-4.5",
	"anthropicBaseUrl": ""
}
```

**Modèle par Défaut** : `claude-sonnet-4.5`

**Notes** :

- Nécessite une clé API Anthropic depuis https://console.anthropic.com/
- Prend en charge tous les modèles Claude 3 et Claude 3.5

---

### openai-native

Intégration native de l'API OpenAI.

**Description** : Utilisez les modèles d'OpenAI avec prise en charge native de l'API.

**Champs Requis** :

- `openAiNativeApiKey` (password) : Votre clé API OpenAI
- `apiModelId` (text) : Le modèle OpenAI à utiliser (par défaut : `gpt-5-chat-latest`)

**Champs Optionnels** :

- `openAiNativeBaseUrl` (text) : URL de base personnalisée pour les requêtes API (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "openai-native",
	"openAiNativeApiKey": "sk-...",
	"apiModelId": "gpt-5-chat-latest",
	"openAiNativeBaseUrl": ""
}
```

**Modèle par Défaut** : `gpt-5-chat-latest`

**Notes** :

- Nécessite une clé API OpenAI depuis https://platform.openai.com/
- Prend en charge les modèles GPT-4, GPT-4 Turbo et GPT-3.5

---

### openrouter

Accédez à plusieurs modèles d'IA via l'API unifiée d'OpenRouter.

**Description** : Utilisez OpenRouter pour accéder à divers modèles d'IA de différents fournisseurs via une seule API.

**Champs Requis** :

- `openRouterApiKey` (password) : Votre clé API OpenRouter
- `openRouterModelId` (text) : L'identifiant du modèle (par défaut : `anthropic/claude-3-5-sonnet`)

**Champs Optionnels** :

- `openRouterBaseUrl` (text) : URL de base personnalisée (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "openrouter",
	"openRouterApiKey": "sk-or-...",
	"openRouterModelId": "anthropic/claude-3-5-sonnet",
	"openRouterBaseUrl": ""
}
```

**Modèle par Défaut** : `anthropic/claude-3-5-sonnet`

**Notes** :

- Obtenez votre clé API depuis https://openrouter.ai/
- Prend en charge les modèles d'Anthropic, OpenAI, Google, Meta et plus

---

### bedrock

AWS Bedrock pour accéder aux modèles fondamentaux sur l'infrastructure AWS.

**Description** : Utilisez AWS Bedrock pour accéder à divers modèles fondamentaux avec la sécurité et la conformité AWS.

**Champs Requis** :

- `awsAccessKey` (password) : Votre ID de clé d'accès AWS
- `awsSecretKey` (password) : Votre clé d'accès secrète AWS
- `awsRegion` (text) : Région AWS (par défaut : `us-east-1`)
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `anthropic.claude-sonnet-4.5-20250929-v1:0`)

**Champs Optionnels** :

- `awsSessionToken` (password) : Token de session AWS pour les identifiants temporaires
- `awsUseCrossRegionInference` (boolean) : Activer l'inférence inter-régions

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "bedrock",
	"awsAccessKey": "AKIA...",
	"awsSecretKey": "...",
	"awsRegion": "us-east-1",
	"apiModelId": "anthropic.claude-sonnet-4.5-20250929-v1:0",
	"awsSessionToken": "",
	"awsUseCrossRegionInference": false
}
```

**Modèle par Défaut** : `anthropic.claude-sonnet-4.5-20250929-v1:0`

**Notes** :

- Nécessite un compte AWS avec accès Bedrock
- Prend en charge Claude, Llama, Mistral et autres modèles fondamentaux
- L'inférence inter-régions permet d'accéder aux modèles dans différentes régions

---

### gemini

Modèles d'IA Gemini de Google via accès API direct.

**Description** : Accédez aux modèles Gemini de Google directement avec votre clé API.

**Champs Requis** :

- `geminiApiKey` (password) : Votre clé API Google AI
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `gemini-2.5-flash-preview-04-17`)

**Champs Optionnels** :

- `googleGeminiBaseUrl` (text) : URL de base personnalisée (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "gemini",
	"geminiApiKey": "AIza...",
	"apiModelId": "gemini-2.5-flash-preview-04-17",
	"googleGeminiBaseUrl": ""
}
```

**Modèle par Défaut** : `gemini-2.5-flash-preview-04-17`

**Notes** :

- Obtenez votre clé API depuis https://makersuite.google.com/app/apikey
- Prend en charge les modèles Gemini Pro et Gemini Ultra

---

### vertex

Google Cloud Vertex AI pour le déploiement d'IA de niveau entreprise.

**Description** : Utilisez la plateforme Vertex AI de Google Cloud pour accéder aux modèles d'IA avec fonctionnalités d'entreprise.

**Champs Requis** :

- `vertexProjectId` (text) : Votre ID de projet Google Cloud
- `vertexRegion` (text) : Région Google Cloud (par défaut : `us-central1`)
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `claude-4.5-sonnet`)

**Authentification** (choisissez-en une) :

- `vertexJsonCredentials` (password) : Identifiants de compte de service JSON
- `vertexKeyFile` (text) : Chemin vers le fichier de clé de compte de service

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "vertex",
	"vertexProjectId": "my-project-123",
	"vertexRegion": "us-central1",
	"apiModelId": "claude-4.5-sonnet",
	"vertexJsonCredentials": "{...}",
	"vertexKeyFile": ""
}
```

**Modèle par Défaut** : `claude-4.5-sonnet`

**Notes** :

- Nécessite un projet Google Cloud avec Vertex AI activé
- Prend en charge Claude, Gemini et autres modèles via Vertex AI
- Utilisez soit les identifiants JSON soit le chemin du fichier de clé, pas les deux

---

### claude-code

Intégration locale du CLI Claude Code.

**Description** : Utilisez l'outil CLI Claude Code pour les interactions d'IA locales.

**Champs Requis** :

- `claudeCodePath` (text) : Chemin vers l'exécutable Claude Code
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `claude-sonnet-4-5`)
- `claudeCodeMaxOutputTokens` (text) : Nombre maximum de tokens de sortie (par défaut : `8000`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "claude-code",
	"claudeCodePath": "/usr/local/bin/claude-code",
	"apiModelId": "claude-sonnet-4-5",
	"claudeCodeMaxOutputTokens": "8000"
}
```

**Modèle par Défaut** : `claude-sonnet-4-5`

**Notes** :

- Nécessite que le CLI Claude Code soit installé localement
- Utile pour les workflows hors ligne ou locaux en priorité

---

### mistral

Modèles de langage de Mistral AI.

**Description** : Accédez aux modèles de langage puissants de Mistral, y compris Codestral pour la génération de code.

**Champs Requis** :

- `mistralApiKey` (password) : Votre clé API Mistral
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `magistral-medium-latest`)

**Champs Optionnels** :

- `mistralCodestralUrl` (text) : URL de base Codestral personnalisée (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "mistral",
	"mistralApiKey": "...",
	"apiModelId": "magistral-medium-latest",
	"mistralCodestralUrl": ""
}
```

**Modèle par Défaut** : `magistral-medium-latest`

**Notes** :

- Obtenez votre clé API depuis https://console.mistral.ai/
- Prend en charge les modèles Mistral Large, Mistral Medium et Codestral

---

### groq

Inférence ultra-rapide LPU de Groq.

**Description** : Utilisez le Language Processing Unit (LPU) de Groq pour une inférence extrêmement rapide.

**Champs Requis** :

- `groqApiKey` (password) : Votre clé API Groq
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `llama-3.3-70b-versatile`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "groq",
	"groqApiKey": "gsk_...",
	"apiModelId": "llama-3.3-70b-versatile"
}
```

**Modèle par Défaut** : `llama-3.3-70b-versatile`

**Notes** :

- Obtenez votre clé API depuis https://console.groq.com/
- Réputé pour ses vitesses d'inférence extrêmement rapides
- Prend en charge les modèles Llama, Mixtral et Gemma

---

### deepseek

Modèles d'IA de DeepSeek.

**Description** : Accédez aux modèles de langage de DeepSeek optimisés pour le codage et le raisonnement.

**Champs Requis** :

- `deepSeekApiKey` (password) : Votre clé API DeepSeek
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `deepseek-chat`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "deepseek",
	"deepSeekApiKey": "...",
	"apiModelId": "deepseek-chat"
}
```

**Modèle par Défaut** : `deepseek-chat`

**Notes** :

- Obtenez votre clé API depuis https://platform.deepseek.com/
- Optimisé pour la génération de code et les tâches techniques

---

### xai

Modèles Grok de xAI.

**Description** : Accédez aux modèles de langage Grok de xAI.

**Champs Requis** :

- `xaiApiKey` (password) : Votre clé API xAI
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `grok-code-fast-1`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "xai",
	"xaiApiKey": "...",
	"apiModelId": "grok-code-fast-1"
}
```

**Modèle par Défaut** : `grok-code-fast-1`

**Notes** :

- Obtenez votre clé API depuis https://x.ai/
- Accès aux modèles Grok

---

### cerebras

Plateforme d'inférence IA de Cerebras.

**Description** : Utilisez la plateforme d'inférence IA à l'échelle de gaufres de Cerebras.

**Champs Requis** :

- `cerebrasApiKey` (password) : Votre clé API Cerebras
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `qwen-3-coder-480b-free`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "cerebras",
	"cerebrasApiKey": "...",
	"apiModelId": "qwen-3-coder-480b-free"
}
```

**Modèle par Défaut** : `qwen-3-coder-480b-free`

**Notes** :

- Obtenez votre clé API depuis https://cerebras.ai/
- Optimisé pour l'inférence à haut débit

---

### ollama

Instance Ollama locale pour exécuter des modèles localement.

**Description** : Exécutez des modèles d'IA localement en utilisant Ollama.

**Champs Requis** :

- `ollamaBaseUrl` (text) : URL du serveur Ollama (par défaut : `http://localhost:11434`)
- `ollamaModelId` (text) : Identifiant du modèle (par défaut : `llama3.2`)

**Champs Optionnels** :

- `ollamaApiKey` (password) : Clé API si l'authentification est activée

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "ollama",
	"ollamaBaseUrl": "http://localhost:11434",
	"ollamaModelId": "llama3.2",
	"ollamaApiKey": ""
}
```

**Modèle par Défaut** : `llama3.2`

**Notes** :

- Nécessite qu'Ollama soit installé et exécuté localement
- Téléchargez depuis https://ollama.ai/
- Prend en charge de nombreux modèles open source (Llama, Mistral, CodeLlama, etc.)
- Aucune clé API requise pour l'usage local

---

### lmstudio

LM Studio pour l'inférence de modèles locaux.

**Description** : Utilisez LM Studio pour exécuter des modèles localement avec une interface conviviale.

**Champs Requis** :

- `lmStudioBaseUrl` (text) : URL du serveur LM Studio (par défaut : `http://localhost:1234/v1`)
- `lmStudioModelId` (text) : Identifiant du modèle (par défaut : `local-model`)

**Champs Optionnels** :

- `lmStudioSpeculativeDecodingEnabled` (boolean) : Activer le décodage spéculatif pour une inférence plus rapide

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "lmstudio",
	"lmStudioBaseUrl": "http://localhost:1234/v1",
	"lmStudioModelId": "local-model",
	"lmStudioSpeculativeDecodingEnabled": false
}
```

**Modèle par Défaut** : `local-model`

**Notes** :

- Nécessite que LM Studio soit installé et en cours d'exécution
- Téléchargez depuis https://lmstudio.ai/
- Prend en charge divers modèles quantifiés
- Le décodage spéculatif peut améliorer la vitesse d'inférence

---

### vscode-lm

API de modèle de langage intégrée de VSCode.

**Description** : Utilisez les capacités natives de modèle de langage de VSCode (par exemple, GitHub Copilot).

**Champs Requis** :

- `vsCodeLmModelSelector` (text) : Sélecteur de modèle au format `vendor/family`

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "vscode-lm",
	"vsCodeLmModelSelector": {
		"vendor": "copilot",
		"family": "gpt-4o"
	}
}
```

**Modèle par Défaut** : `copilot-gpt-4o`

**Notes** :

- Nécessite VSCode avec prise en charge du modèle de langage
- Généralement utilisé avec un abonnement GitHub Copilot
- Aucune clé API séparée nécessaire

---

### openai

Intégration de l'API OpenAI (configuration alternative).

**Description** : Intégration OpenAI alternative avec configuration simplifiée.

**Champs Requis** :

- `openAiApiKey` (password) : Votre clé API OpenAI
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `gpt-4o`)

**Champs Optionnels** :

- `openAiBaseUrl` (text) : URL de base personnalisée (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "openai",
	"openAiApiKey": "sk-...",
	"apiModelId": "gpt-4o",
	"openAiBaseUrl": ""
}
```

**Modèle par Défaut** : `gpt-4o`

**Notes** :

- Similaire à openai-native mais avec une structure de configuration différente
- Prend en charge tous les modèles OpenAI

---

### glama

Plateforme IA Glama.

**Description** : Accédez aux modèles d'IA via la plateforme Glama.

**Champs Requis** :

- `glamaApiKey` (password) : Votre clé API Glama
- `glamaModelId` (text) : Identifiant du modèle (par défaut : `llama-3.1-70b-versatile`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "glama",
	"glamaApiKey": "...",
	"glamaModelId": "llama-3.1-70b-versatile"
}
```

**Modèle par Défaut** : `llama-3.1-70b-versatile`

---

### huggingface

API d'inférence HuggingFace.

**Description** : Accédez aux modèles hébergés sur l'infrastructure d'inférence de HuggingFace.

**Champs Requis** :

- `huggingFaceApiKey` (password) : Votre token API HuggingFace
- `huggingFaceModelId` (text) : Identifiant du modèle (par défaut : `meta-llama/Llama-2-70b-chat-hf`)
- `huggingFaceInferenceProvider` (text) : Fournisseur d'inférence (par défaut : `auto`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "huggingface",
	"huggingFaceApiKey": "hf_...",
	"huggingFaceModelId": "meta-llama/Llama-2-70b-chat-hf",
	"huggingFaceInferenceProvider": "auto"
}
```

**Modèle par Défaut** : `meta-llama/Llama-2-70b-chat-hf`

**Notes** :

- Obtenez votre token depuis https://huggingface.co/settings/tokens
- Prend en charge des milliers de modèles du HuggingFace Hub
- Le fournisseur d'inférence peut être `auto`, `hf-inference` ou des points de terminaison spécifiques

---

### litellm

Proxy LiteLLM pour un accès unifié aux modèles.

**Description** : Utilisez LiteLLM comme proxy pour accéder à plusieurs fournisseurs d'IA via une interface unifiée.

**Champs Requis** :

- `litellmBaseUrl` (text) : URL du proxy LiteLLM
- `litellmApiKey` (password) : Clé API pour le proxy
- `litellmModelId` (text) : Identifiant du modèle (par défaut : `gpt-4o`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "litellm",
	"litellmBaseUrl": "http://localhost:8000",
	"litellmApiKey": "...",
	"litellmModelId": "gpt-4o"
}
```

**Modèle par Défaut** : `gpt-4o`

**Notes** :

- Nécessite que le proxy LiteLLM soit en cours d'exécution
- Voir https://docs.litellm.ai/ pour la configuration
- Prend en charge 100+ fournisseurs LLM via une seule interface

---

### moonshot

Plateforme IA Moonshot.

**Description** : Accédez aux modèles de langage de Moonshot AI.

**Champs Requis** :

- `moonshotBaseUrl` (text) : URL de base de l'API Moonshot (par défaut : `https://api.moonshot.ai/v1`)
- `moonshotApiKey` (password) : Votre clé API Moonshot
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `kimi-k2-0711-preview`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "moonshot",
	"moonshotBaseUrl": "https://api.moonshot.ai/v1",
	"moonshotApiKey": "...",
	"apiModelId": "kimi-k2-0711-preview"
}
```

**Modèle par Défaut** : `kimi-k2-0711-preview`

---

### doubao

Plateforme IA Doubao.

**Description** : Accédez aux modèles d'IA de Doubao.

**Champs Requis** :

- `doubaoApiKey` (password) : Votre clé API Doubao
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `doubao-seed-1-6-250615`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "doubao",
	"doubaoApiKey": "...",
	"apiModelId": "doubao-seed-1-6-250615"
}
```

**Modèle par Défaut** : `doubao-seed-1-6-250615`

---

### chutes

Plateforme IA Chutes.

**Description** : Accédez aux modèles d'IA via la plateforme Chutes.

**Champs Requis** :

- `chutesApiKey` (password) : Votre clé API Chutes
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `deepseek-ai/DeepSeek-R1-0528`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "chutes",
	"chutesApiKey": "...",
	"apiModelId": "deepseek-ai/DeepSeek-R1-0528"
}
```

**Modèle par Défaut** : `deepseek-ai/DeepSeek-R1-0528`

---

### sambanova

Plateforme d'inférence IA SambaNova.

**Description** : Utilisez la plateforme d'inférence IA de SambaNova pour une exécution rapide de modèles.

**Champs Requis** :

- `sambaNovaApiKey` (password) : Votre clé API SambaNova
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `Meta-Llama-3.1-70B-Instruct`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "sambanova",
	"sambaNovaApiKey": "...",
	"apiModelId": "Meta-Llama-3.1-70B-Instruct"
}
```

**Modèle par Défaut** : `Meta-Llama-3.1-70B-Instruct`

---

### fireworks

Plateforme IA Fireworks.

**Description** : Accédez aux modèles via la plateforme d'inférence rapide de Fireworks AI.

**Champs Requis** :

- `fireworksApiKey` (password) : Votre clé API Fireworks
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `accounts/fireworks/models/kimi-k2-instruct-0905`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "fireworks",
	"fireworksApiKey": "...",
	"apiModelId": "accounts/fireworks/models/kimi-k2-instruct-0905"
}
```

**Modèle par Défaut** : `accounts/fireworks/models/kimi-k2-instruct-0905`

**Notes** :

- Obtenez votre clé API depuis https://fireworks.ai/
- Réputé pour ses vitesses d'inférence rapides

---

### featherless

Plateforme IA Featherless.

**Description** : Accédez aux modèles d'IA via la plateforme Featherless.

**Champs Requis** :

- `featherlessApiKey` (password) : Votre clé API Featherless
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `deepseek-ai/DeepSeek-V3-0324`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "featherless",
	"featherlessApiKey": "...",
	"apiModelId": "deepseek-ai/DeepSeek-V3-0324"
}
```

**Modèle par Défaut** : `deepseek-ai/DeepSeek-V3-0324`

---

### deepinfra

Inférence IA serverless de DeepInfra.

**Description** : Utilisez DeepInfra pour un accès serverless à divers modèles d'IA.

**Champs Requis** :

- `deepInfraApiKey` (password) : Votre clé API DeepInfra
- `deepInfraModelId` (text) : Identifiant du modèle (par défaut : `meta-llama/Meta-Llama-3.1-70B-Instruct`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "deepinfra",
	"deepInfraApiKey": "...",
	"deepInfraModelId": "meta-llama/Meta-Llama-3.1-70B-Instruct"
}
```

**Modèle par Défaut** : `meta-llama/Meta-Llama-3.1-70B-Instruct`

**Notes** :

- Obtenez votre clé API depuis https://deepinfra.com/
- Prend en charge de nombreux modèles open source

---

### io-intelligence

Plateforme IO Intelligence.

**Description** : Accédez aux modèles d'IA via la plateforme IO Intelligence.

**Champs Requis** :

- `ioIntelligenceApiKey` (password) : Votre clé API IO Intelligence
- `ioIntelligenceModelId` (text) : Identifiant du modèle (par défaut : `gpt-4o`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "io-intelligence",
	"ioIntelligenceApiKey": "...",
	"ioIntelligenceModelId": "gpt-4o"
}
```

**Modèle par Défaut** : `gpt-4o`

---

### qwen-code

Modèles d'IA Qwen Code.

**Description** : Accédez aux modèles spécialisés en code de Qwen en utilisant l'authentification OAuth.

**Champs Requis** :

- `qwenCodeOauthPath` (text) : Chemin vers le fichier d'identifiants OAuth (par défaut : `~/.qwen/oauth_creds.json`)
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `qwen3-coder-plus`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "qwen-code",
	"qwenCodeOauthPath": "~/.qwen/oauth_creds.json",
	"apiModelId": "qwen3-coder-plus"
}
```

**Modèle par Défaut** : `qwen3-coder-plus`

**Notes** :

- Nécessite un fichier d'identifiants OAuth
- Optimisé pour les tâches de génération de code

---

### gemini-cli

Intégration Gemini CLI.

**Description** : Utilisez les modèles Gemini de Google via CLI avec authentification OAuth.

**Champs Requis** :

- `geminiCliOAuthPath` (text) : Chemin vers le fichier d'identifiants OAuth (par défaut : `~/.gemini/oauth_creds.json`)
- `geminiCliProjectId` (text) : ID de projet Google Cloud
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `gemini-2.5-flash-preview-04-17`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "gemini-cli",
	"geminiCliOAuthPath": "~/.gemini/oauth_creds.json",
	"geminiCliProjectId": "my-project-123",
	"apiModelId": "gemini-2.5-flash-preview-04-17"
}
```

**Modèle par Défaut** : `gemini-2.5-flash-preview-04-17`

**Notes** :

- Nécessite un fichier d'identifiants OAuth
- Nécessite un projet Google Cloud

---

### zai

Plateforme IA ZAI.

**Description** : Accédez aux modèles d'IA via la plateforme ZAI avec prise en charge des points de terminaison API internationaux et basés en Chine.

**Champs Requis** :

- `zaiApiKey` (password) : Votre clé API ZAI
- `zaiApiLine` (text) : Identifiant de ligne API (par défaut : `international_coding`)
- `apiModelId` (text) : Le modèle à utiliser (par défaut : `glm-4.6`)

**Lignes API Disponibles** :

Le paramètre `zaiApiLine` détermine quel point de terminaison API et région utiliser :

- `international_coding` (par défaut) : Plan Codage International

    - URL de base : `https://api.z.ai/api/coding/paas/v4`
    - Région : Internationale
    - Optimisé pour les tâches de codage

- `international` : Standard International

    - URL de base : `https://api.z.ai/api/paas/v4`
    - Région : Internationale
    - API à usage général

- `china_coding` : Plan Codage Chine

    - URL de base : `https://open.bigmodel.cn/api/coding/paas/v4`
    - Région : Chine
    - Optimisé pour les tâches de codage

- `china` : Standard Chine

    - URL de base : `https://open.bigmodel.cn/api/paas/v4`
    - Région : Chine
    - API à usage général

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "zai",
	"zaiApiKey": "...",
	"zaiApiLine": "international_coding",
	"apiModelId": "glm-4.6"
}
```

**Modèle par Défaut** : `glm-4.6`

**Notes** :

- Choisissez la ligne API en fonction de votre situation géographique et de votre cas d'usage
- Les lignes optimisées pour le codage offrent de meilleures performances pour les tâches de génération de code
- Les lignes basées en Chine peuvent offrir une meilleure latence pour les utilisateurs en Chine continentale

---

### unbound

Plateforme IA Unbound.

**Description** : Accédez aux modèles d'IA via la plateforme Unbound.

**Champs Requis** :

- `unboundApiKey` (password) : Votre clé API Unbound
- `unboundModelId` (text) : Identifiant du modèle (par défaut : `gpt-4o`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "unbound",
	"unboundApiKey": "...",
	"unboundModelId": "gpt-4o"
}
```

**Modèle par Défaut** : `gpt-4o`

---

### requesty

Plateforme IA Requesty.

**Description** : Accédez aux modèles d'IA via la plateforme Requesty.

**Champs Requis** :

- `requestyApiKey` (password) : Votre clé API Requesty
- `requestyModelId` (text) : Identifiant du modèle (par défaut : `gpt-4o`)

**Champs Optionnels** :

- `requestyBaseUrl` (text) : URL de base personnalisée (laisser vide pour la valeur par défaut)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "requesty",
	"requestyApiKey": "...",
	"requestyBaseUrl": "",
	"requestyModelId": "gpt-4o"
}
```

**Modèle par Défaut** : `gpt-4o`

---

### roo

Plateforme IA Roo.

**Description** : Accédez aux modèles d'IA via la plateforme Roo.

**Champs Requis** :

- `apiModelId` (text) : Identifiant du modèle (par défaut : `deepseek-ai/DeepSeek-R1-0528`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "roo",
	"apiModelId": "deepseek-ai/DeepSeek-R1-0528"
}
```

**Modèle par Défaut** : `deepseek-ai/DeepSeek-R1-0528`

**Notes** :

- Aucune clé API requise
- La configuration peut varier en fonction de la configuration de la plateforme

---

### vercel-ai-gateway

Vercel AI Gateway pour un accès unifié aux modèles.

**Description** : Utilisez l'AI Gateway de Vercel pour accéder à plusieurs fournisseurs d'IA.

**Champs Requis** :

- `vercelAiGatewayApiKey` (password) : Votre clé API Vercel AI Gateway
- `vercelAiGatewayModelId` (text) : Identifiant du modèle (par défaut : `gpt-4o`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "vercel-ai-gateway",
	"vercelAiGatewayApiKey": "...",
	"vercelAiGatewayModelId": "gpt-4o"
}
```

**Modèle par Défaut** : `gpt-4o`

**Notes** :

- Nécessite un compte Vercel avec AI Gateway activé
- Fournit un accès unifié à plusieurs fournisseurs d'IA

---

### virtual-quota-fallback

Gestion de quota virtuel avec basculement automatique.

**Description** : Gérez plusieurs profils de fournisseurs avec basculement automatique lorsque les quotas sont dépassés.

**Champs Requis** :

- `profiles` (text) : Tableau de profils de fournisseurs avec configurations de quota

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "virtual-quota-fallback",
	"profiles": [
		{
			"provider": "anthropic",
			"quota": 1000000,
			"config": {
				"apiKey": "...",
				"apiModelId": "claude-3-5-sonnet-20241022"
			}
		},
		{
			"provider": "openai",
			"quota": 500000,
			"config": {
				"openAiApiKey": "...",
				"apiModelId": "gpt-4o"
			}
		}
	]
}
```

**Modèle par Défaut** : `gpt-4o`

**Notes** :

- Bascule automatiquement vers les fournisseurs de secours lorsque le quota est dépassé
- Utile pour gérer les coûts et assurer la disponibilité
- Chaque profil peut avoir son propre quota et configuration

---

### human-relay

Relais humain dans la boucle pour les réponses manuelles.

**Description** : Acheminez les requêtes vers un opérateur humain pour des réponses manuelles.

**Champs Requis** :

- `apiModelId` (text) : Identifiant du modèle (valeur fixe : `human`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "human-relay",
	"apiModelId": "human"
}
```

**Modèle par Défaut** : `human`

**Notes** :

- Utilisé pour les tests ou les scénarios nécessitant une intervention humaine
- Aucun modèle d'IA n'est réellement appelé

---

### fake-ai

Fournisseur IA factice pour les tests et le développement.

**Description** : Fournisseur IA factice pour les tests sans faire d'appels API réels.

**Champs Requis** :

- `apiModelId` (text) : Identifiant du modèle (valeur fixe : `fake-model`)

**Exemple de Configuration** :

```json
{
	"id": "default",
	"provider": "fake-ai",
	"apiModelId": "fake-model"
}
```

**Modèle par Défaut** : `fake-model`

**Notes** :

- Utilisé pour les tests et le développement
- Retourne des réponses simulées sans appeler aucun service d'IA réel
- Utile pour les tests d'intégration

---

## Ressources Supplémentaires

- [Documentation Kilo Code](https://docs.kilocode.com/)
- [Schéma de Configuration](../src/config/schema.json)

## Support

Pour les problèmes ou questions concernant la configuration des fournisseurs :

- Ouvrez une issue sur [GitHub](https://github.com/kilo-org/kilocode)
- Rejoignez notre [communauté Discord](https://discord.gg/kilocode)
- Consultez la [FAQ](https://docs.kilocode.com/faq)
