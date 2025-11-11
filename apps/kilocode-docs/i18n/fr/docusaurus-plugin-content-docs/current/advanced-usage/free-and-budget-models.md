---
sidebar_label: Modèles gratuits et économiques
---

# Utiliser Kilo Code gratuitement et avec un budget limité

**Pourquoi c'est important :** Les coûts des modèles IA peuvent s'accumuler rapidement pendant le développement. Ce guide vous montre comment utiliser Kilo Code efficacement tout en minimisant ou éliminant les coûts grâce aux modèles gratuits, aux alternatives économiques et aux stratégies d'utilisation intelligentes.

## Options entièrement gratuites

### Grok Code Fast 1

Ce modèle IA de pointe est 100% gratuit dans Kilo Code pour une durée limitée. [Voir l'article de blog pour plus de détails](https://blog.kilocode.ai/p/grok-code-fast-get-this-frontier-ai-model-free).

### Modèles gratuits d'OpenRouter

OpenRouter propose plusieurs modèles avec des paliers gratuits généreux. **Note :** Vous devrez créer un compte OpenRouter gratuit pour accéder à ces modèles.

**Configuration :**

1. Créez un compte [OpenRouter gratuit](https://openrouter.ai)
2. Obtenez votre clé API depuis le tableau de bord
3. Configurez Kilo Code avec le fournisseur OpenRouter

**Modèles gratuits disponibles :**

- **Qwen3 Coder (gratuit)** - Optimisé pour les tâches de codage agentique telles que l'appel de fonctions, l'utilisation d'outils et le raisonnement sur contexte long de dépôts.
- **Z.AI: GLM 4.5 Air (gratuit)** - Variante légère de la famille GLM-4.5, conçue spécifiquement pour les applications centrées sur les agents.
- **DeepSeek: R1 0528 (gratuit)** - Performance comparable à OpenAI o1, mais open-source avec des tokens de raisonnement entièrement ouverts.
- **MoonshotAI: Kimi K2 (gratuit)** - Optimisé pour les capacités agentiques, incluant l'utilisation avancée d'outils, le raisonnement et la synthèse de code.

## Modèles premium rentables

Lorsque vous avez besoin de plus de capacités que ce que les modèles gratuits fournissent, ces options offrent une excellente valeur :

### Champions ultra-économiques (Moins de 0,50$ par million de tokens)

**Mistral Devstral Small**

- **Coût :** ~0,20$ par million de tokens d'entrée
- **Idéal pour :** Génération de code, débogage, refactoring
- **Performance :** 85% des capacités des modèles premium à 10% du coût

**Llama 4 Maverick**

- **Coût :** ~0,30$ par million de tokens d'entrée
- **Idéal pour :** Raisonnement complexe, planification d'architecture
- **Performance :** Excellent pour la plupart des tâches de développement

**DeepSeek v3**

- **Coût :** ~0,27$ par million de tokens d'entrée
- **Idéal pour :** Analyse de code, compréhension de grandes bases de code
- **Performance :** Raisonnement technique solide

### Modèles de valeur de gamme moyenne (0,50$-2,00$ par million de tokens)

**Qwen3 235B**

- **Coût :** ~1,20$ par million de tokens d'entrée
- **Idéal pour :** Projets complexes nécessitant une haute précision
- **Performance :** Qualité quasi-premium à 40% du coût

## Stratégies d'utilisation intelligente

### La règle des 50%

**Principe :** Utilisez des modèles économiques pour 50% de vos tâches, des modèles premium pour les 50% restants.

**Tâches pour modèles économiques :**

- Révisions de code et analyse
- Rédaction de documentation
- Corrections de bugs simples
- Génération de code standard
- Refactoring de code existant

**Tâches pour modèles premium :**

- Décisions d'architecture complexes
- Débogage de problèmes difficiles
- Optimisation des performances
- Conception de nouvelles fonctionnalités
- Code de production critique

### Gestion du contexte pour économiser les coûts

**Minimiser la taille du contexte :**

```typescript
// Au lieu de mentionner des fichiers entiers
@src/components/UserProfile.tsx

// Mentionner des fonctions ou sections spécifiques
@src/components/UserProfile.tsx:45-67
```

**Utiliser efficacement le Memory Bank :**

- Stocker le contexte du projet une fois dans le [Memory Bank](/advanced-usage/memory-bank)
- Réduit le besoin de réexpliquer les détails du projet
- Économise 200-500 tokens par conversation

**Mentions de fichiers stratégiques :**

- Inclure uniquement les fichiers directement pertinents pour la tâche
- Utiliser [`@dossier/`](/basic-usage/context-mentions) pour un contexte large, des fichiers spécifiques pour un travail ciblé

### Stratégies de changement de modèle

**Commencer économique, escalader si nécessaire :**

1. **Commencer avec des modèles gratuits** (Qwen3 Coder, GLM-4.5-Air)
2. **Passer aux modèles économiques** si les modèles gratuits ont des difficultés
3. **Escalader vers les modèles premium** uniquement pour les tâches complexes

**Utiliser les profils de configuration API :**

- Configurer [plusieurs profils](/features/api-configuration-profiles) pour différentes gammes de coûts
- Changement rapide entre modèles gratuits, économiques et premium
- Adapter la capacité du modèle à la complexité de la tâche

### Optimisation des coûts basée sur les modes

**Utiliser les modes appropriés pour limiter les opérations coûteuses :**

- **[Mode Ask](/basic-usage/using-modes#ask-mode) :** Collecte d'informations sans modifications de code
- **[Mode Architect](/basic-usage/using-modes#architect-mode) :** Planification sans opérations de fichier coûteuses
- **[Mode Debug](/basic-usage/using-modes#debug-mode) :** Dépannage ciblé

**Modes personnalisés pour le contrôle budgétaire :**

- Créer des modes qui restreignent les outils coûteux
- Limiter l'accès aux fichiers à des répertoires spécifiques
- Contrôler quelles opérations sont auto-approuvées

## Comparaisons de performance réelles

### Tâches de génération de code

**Création de fonction simple :**

- **Mistral Devstral Small :** Taux de succès de 95%
- **GPT-4 :** Taux de succès de 98%
- **Différence de coût :** Gratuit vs 0,20$ vs 30$ par million de tokens

**Refactoring complexe :**

- **Modèles économiques :** Taux de succès de 70-80%
- **Modèles premium :** Taux de succès de 90-95%
- **Recommandation :** Commencer avec les modèles économiques, escalader si nécessaire

### Performance de débogage

**Bugs simples :**

- **Modèles gratuits :** Généralement suffisants
- **Modèles économiques :** Performance excellente
- **Modèles premium :** Surdimensionné pour la plupart des cas

**Problèmes système complexes :**

- **Modèles gratuits :** Taux de succès de 40-60%
- **Modèles économiques :** Taux de succès de 60-80%
- **Modèles premium :** Taux de succès de 85-95%

## Recommandations d'approche hybride

### Workflow de développement quotidien

**Session de planification matinale :**

- Utiliser le **mode Architect** avec **DeepSeek R1**
- Planifier les fonctionnalités et l'architecture
- Créer des décompositions de tâches

**Phase d'implémentation :**

- Utiliser le **mode Code** avec des **modèles économiques**
- Générer et modifier le code
- Gérer les tâches de développement de routine

**Résolution de problèmes complexes :**

- Passer aux **modèles premium** lorsque bloqué
- Utiliser pour le débogage critique
- Décisions d'architecture affectant plusieurs systèmes

### Stratégie de phase de projet

**Début de développement :**

- Modèles gratuits et économiques pour le prototypage
- Itération rapide sans soucis de coût
- Établir des modèles et une structure

**Préparation production :**

- Modèles premium pour la révision de code critique
- Optimisation des performances
- Considérations de sécurité

## Surveillance et contrôle des coûts

### Suivre votre utilisation

**Surveiller la consommation de crédits :**

- Vérifier les estimations de coût dans l'historique de chat
- Examiner les modèles d'utilisation mensuels
- Identifier les opérations à coût élevé

**Définir des limites de dépenses :**

- Utiliser les alertes de facturation des fournisseurs
- Configurer des [limites de débit](/advanced-usage/rate-limits-costs) pour contrôler l'utilisation
- Définir des budgets quotidiens/mensuels

### Conseils d'économie

**Réduire la taille du prompt système :**

- [Désactiver MCP](/features/mcp/using-mcp-in-kilo-code) si vous n'utilisez pas d'outils externes
- Utiliser des modes personnalisés ciblés
- Minimiser le contexte inutile

**Optimiser la longueur des conversations :**

- Utiliser les [Points de contrôle](/features/checkpoints) pour réinitialiser le contexte
- Commencer des conversations fraîches pour des tâches non liées
- Archiver le travail terminé

**Regrouper des tâches similaires :**

- Grouper les modifications de code connexes
- Gérer plusieurs fichiers dans des requêtes uniques
- Réduire les frais généraux de conversation

## Premiers pas avec les modèles économiques

### Guide de configuration rapide

1. **Créer un compte OpenRouter** pour les modèles gratuits
2. **Configurer plusieurs fournisseurs** dans Kilo Code
3. **Configurer les profils de configuration API** pour un changement facile
4. **Escalader vers les modèles économiques** lorsque nécessaire
5. **Réserver les modèles premium** pour le travail complexe

### Mix de fournisseurs recommandé

**Base de palier gratuit :**

- [OpenRouter](/providers/openrouter) - Modèles gratuits
- [Groq](/providers/groq) - Inférence rapide pour les modèles pris en charge
- [Z.ai](https://z.ai/model-api) - Fournit un modèle gratuit GLM-4.5-Flash

**Options de palier économique :**

- [DeepSeek](/providers/deepseek) - Modèles d'excellente valeur
- [Mistral](/providers/mistral) - Modèles de codage spécialisés

**Sauvegarde de palier premium :**

- [Anthropic](/providers/anthropic) - Claude pour le raisonnement complexe
- [OpenAI](/providers/openai) - GPT-4 pour les tâches critiques

## Mesure du succès

**Suivre ces métriques :**

- Coûts IA mensuels vs productivité de développement
- Taux d'achèvement des tâches par gamme de modèles
- Temps économisé vs argent dépensé
- Améliorations de la qualité du code

**Indicateurs de succès :**

- 70%+ des tâches terminées avec des modèles gratuits/économiques
- Coûts mensuels sous votre budget cible
- Qualité de code maintenue ou améliorée
- Cycles de développement plus rapides

En combinant des modèles gratuits, l'utilisation stratégique de modèles économiques et des techniques d'optimisation intelligentes, vous pouvez exploiter toute la puissance du développement assisté par IA tout en gardant les coûts minimaux. Commencez avec les options gratuites et incorporez progressivement des modèles économiques à mesure que vos besoins et votre confort avec les coûts grandissent.
