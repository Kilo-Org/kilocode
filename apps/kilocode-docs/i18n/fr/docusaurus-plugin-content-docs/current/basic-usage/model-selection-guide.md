---
sidebar_label: "Guide de sélection de modèle"
---

# Guide de sélection de modèle Kilo Code

Dernière mise à jour : 3 septembre 2025.

Le paysage des modèles IA évolue rapidement, ce guide se concentre donc sur ce qui offre d'excellents résultats avec Kilo Code actuellement. Nous le mettons à jour régulièrement à mesure que de nouveaux modèles apparaissent et que les performances évoluent.

## Meilleurs performants Kilo Code

| Modèle               | Fenêtre de contexte | SWE-Bench Vérifié | Évaluation Humaine | LiveCodeBench | Prix d'entrée\* | Prix de sortie\* | Idéal pour                                           |
| -------------------- | ------------------- | ----------------- | ------------------ | ------------- | --------------- | ---------------- | ---------------------------------------------------- |
| **GPT-5**            | 400K tokens         | 74.9%             | 96.3%              | 68.2%         | $1.25           | $10              | Dernières fonctionnalités, codage multi-modal        |
| **Claude Sonnet 4**  | 1M tokens           | 72.7%             | 94.8%              | 65.9%         | $3-6            | $15-22.50        | Génération de code entreprise, systèmes complexes    |
| **Grok Code Fast 1** | 256K tokens         | 70.8%             | 92.1%              | 63.4%         | $0.20           | $1.50            | Développement rapide, équilibre coût-performance     |
| **Qwen3 Coder**      | 256K tokens         | 68.4%             | 91.7%              | 61.8%         | $0.20           | $0.80            | Tâches de codage pur, prototypage rapide             |
| **Gemini 2.5 Pro**   | 1M+ tokens          | 67.2%             | 89.9%              | 59.3%         | TBD             | TBD              | Bases de code massives, planification architecturale |

\*Par million de tokens

## Options économiques

| Modèle           | Fenêtre de contexte | SWE-Bench Vérifié | Évaluation Humaine | LiveCodeBench | Prix d'entrée\* | Prix de sortie\* | Notes                                          |
| ---------------- | ------------------- | ----------------- | ------------------ | ------------- | --------------- | ---------------- | ---------------------------------------------- |
| **DeepSeek V3**  | 128K tokens         | 64.1%             | 87.3%              | 56.7%         | $0.14           | $0.28            | Valeur exceptionnelle pour le codage quotidien |
| **DeepSeek R1**  | 128K tokens         | 62.8%             | 85.9%              | 54.2%         | $0.55           | $2.19            | Raisonnement avancé à prix budget              |
| **Qwen3 32B**    | 128K tokens         | 60.3%             | 83.4%              | 52.1%         | Variable        | Variable         | Flexibilité open source                        |
| **Z AI GLM 4.5** | 128K tokens         | 58.7%             | 81.2%              | 49.8%         | TBD             | TBD              | Licence MIT, système de raisonnement hybride   |

\*Par million de tokens

## Cadre d'évaluation complet

### Performance de latence

Les temps de réponse impactent considérablement le flux de développement et la productivité :

- **Ultra-rapide (< 2s)** : Grok Code Fast 1, Qwen3 Coder
- **Rapide (2-4s)** : DeepSeek V3, GPT-5
- **Modéré (4-8s)** : Claude Sonnet 4, DeepSeek R1
- **Plus lent (8-15s)** : Gemini 2.5 Pro, Z AI GLM 4.5

**Impact sur le développement** : Les modèles ultra-rapides permettent une assistance au codage en temps réel et des boucles de retour immédiates. Les modèles avec une latence de 8+ secondes peuvent perturber l'état de flux mais peuvent être acceptables pour les décisions architecturales complexes.

### Analyse de débit

Les taux de génération de tokens affectent le traitement des bases de code volumineuses :

- **Débit élevé (150+ tokens/s)** : GPT-5, Grok Code Fast 1
- **Débit moyen (100-150 tokens/s)** : Claude Sonnet 4, Qwen3 Coder
- **Débit standard (50-100 tokens/s)** : Modèles DeepSeek, Gemini 2.5 Pro
- **Débit variable** : Les modèles open source dépendent de l'infrastructure

**Facteurs d'évolution** : Les modèles à débit élevé excellent lors de la génération de documentation étendue, du refactoring de fichiers volumineux ou du traitement par lots de plusieurs composants.

### Fiabilité et disponibilité

Considérations entreprise pour les environnements de production :

- **Niveau entreprise (99.9%+ de disponibilité)** : Claude Sonnet 4, GPT-5, Gemini 2.5 Pro
- **Prêt pour la production (99%+ de disponibilité)** : Qwen3 Coder, Grok Code Fast 1
- **Fiabilité en développement** : Modèles DeepSeek, Z AI GLM 4.5
- **Auto-hébergé** : Qwen3 32B (la fiabilité dépend de votre infrastructure)

**Taux de succès** : Les modèles entreprise maintiennent une qualité de sortie cohérente et gèrent les cas limites plus gracieusement, tandis que les options budget peuvent nécessiter des étapes de validation supplémentaires.

### Stratégie de fenêtre de contexte

Optimisation pour différentes échelles de projet :

| Taille           | Nombre de mots | Cas d'usage typique                           | Modèles recommandés                       | Stratégie                                                      |
| ---------------- | -------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| **32K tokens**   | ~24,000 mots   | Composants individuels, scripts               | DeepSeek V3, Qwen3 Coder                  | Concentration sur l'optimisation de fichier unique             |
| **128K tokens**  | ~96,000 mots   | Applications standards, plupart des projets   | Tous les modèles budget, Grok Code Fast 1 | Contexte multi-fichiers, complexité modérée                    |
| **256K tokens**  | ~192,000 mots  | Applications volumineuses, services multiples | Qwen3 Coder, Grok Code Fast 1             | Contexte de fonctionnalités complètes, intégration de services |
| **400K+ tokens** | ~300,000+ mots | Systèmes entreprise, applications full stack  | GPT-5, Claude Sonnet 4, Gemini 2.5 Pro    | Aperçu architectural, refactoring à l'échelle du système       |

**Dégradation de performance** : L'efficacité du modèle diminue généralement considérablement au-delà de 400-500K tokens, quelles que soient les limites annoncées. Planifiez l'utilisation du contexte en conséquence.

## Choix de la communauté

Le paysage des modèles IA change rapidement pour rester à jour [**👉 consultez les favoris de la communauté Kilo Code sur OpenRouter**](https://openrouter.ai/apps?url=https%3A%2F%2Fkilocode.ai%2F)
