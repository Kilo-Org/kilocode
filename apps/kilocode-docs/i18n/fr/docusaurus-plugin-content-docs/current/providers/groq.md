---
sidebar_label: Groq
---

# Utiliser Groq avec Kilo Code

Groq fournit une inférence ultra-rapide pour divers modèles d'IA via leur infrastructure haute performance. Kilo Code supporte l'accès aux modèles via l'API Groq.

**Site Web :** [https://groq.com/](https://groq.com/)

## Obtenir une Clé API

Pour utiliser Groq avec Kilo Code, vous aurez besoin d'une clé API depuis la [Console GroqCloud](https://console.groq.com/). Après vous être inscrit ou connecté, naviguez vers la section Clés API de votre tableau de bord pour créer et copier votre clé.

## Modèles Supportés

Kilo Code tentera de récupérer la liste des modèles disponibles depuis l'API Groq. Les modèles courants disponibles via Groq incluent :

- `llama3-8b-8192`
- `llama3-70b-8192`
- `mixtral-8x7b-32768`
- `gemma-7b-it`
- `moonshotai/kimi-k2-instruct` (Modèle Kimi K2)

**Note :** La disponibilité et les spécifications des modèles peuvent changer. Référez-vous à la [Documentation Groq](https://console.groq.com/docs/models) pour la liste la plus à jour des modèles supportés et leurs capacités.

## Configuration dans Kilo Code

1.  **Ouvrir les Paramètres Kilo Code :** Cliquez sur l'icône d'engrenage (<Codicon name="gear" />) dans le panneau Kilo Code.
2.  **Sélectionner le Fournisseur :** Choisissez "Groq" dans le menu déroulant "Fournisseur API".
3.  **Saisir la Clé API :** Collez votre clé API Groq dans le champ "Clé API Groq".
4.  **Sélectionner le Modèle :** Choisissez votre modèle désiré dans le menu déroulant "Modèle".

## Conseils et Notes

- **Inférence Haute Vitesse :** Les LPUs de Groq fournissent des temps de réponse exceptionnellement rapides, le rendant idéal pour les workflows de développement interactifs.
- **Limites de Tokens :** Certains modèles ont des limites `max_tokens` spécifiques qui sont automatiquement gérées par Kilo Code (par ex., le modèle `moonshotai/kimi-k2-instruct`).
- **Efficacité de Coût :** Groq offre souvent une tarification compétitive pour l'inférence haute vitesse comparé à d'autres fournisseurs.
- **Sélection de Modèle :** Choisissez les modèles basés sur vos besoins spécifiques - modèles plus larges comme `llama3-70b-8192` pour des tâches de raisonnement complexes, ou modèles plus petits comme `llama3-8b-8192` pour des opérations plus rapides et simples.

## Modèles Supportés

Kilo Code supporte les modèles suivants via Groq :

| ID de Modèle                  | Fournisseur | Fenêtre de Contexte | Notes                                  |
| ----------------------------- | ----------- | ------------------- | -------------------------------------- |
| `moonshotai/kimi-k2-instruct` | Moonshot AI | 128K tokens         | Limite max_tokens optimisée configurée |
| `llama-3.3-70b-versatile`     | Meta        | 128K tokens         | Modèle Llama haute performance         |
| `llama-3.1-70b-versatile`     | Meta        | 128K tokens         | Capacités de raisonnement polyvalentes |
| `llama-3.1-8b-instant`        | Meta        | 128K tokens         | Inférence rapide pour tâches rapides   |
| `mixtral-8x7b-32768`          | Mistral AI  | 32K tokens          | Architecture de mixture d'experts      |

**Note :** La disponibilité des modèles peut changer. Référez-vous à la [documentation Groq](https://console.groq.com/docs/models) pour la dernière liste de modèles et spécifications.

## Fonctionnalités Spécifiques aux Modèles

### Modèle Kimi K2

Le modèle `moonshotai/kimi-k2-instruct` inclut une configuration optimisée :

- **Limite Max Tokens :** Automatiquement configuré avec des limites appropriées pour des performances optimales
- **Compréhension de Contexte :** Excellent pour le raisonnement complexe et les tâches de contexte long
- **Support Multilingue :** Performances fortes à travers plusieurs langues

## Conseils et Notes

- **Inférence Ultra-Rapide :** L'accélération matérielle de Groq fournit des temps de réponse exceptionnellement rapides
- **Rentable :** Tarification compétitive pour l'inférence haute performance
- **Limites de Débit :** Soyez conscient des limites de débit API basées sur votre plan Groq
- **Sélection de Modèle :** Choisissez les modèles basés sur votre cas d'utilisation spécifique :
    - **Kimi K2** : Meilleur pour le raisonnement complexe et les tâches multilingues
    - **Llama 3.3 70B** : Excellentes performances générales
    - **Llama 3.1 8B Instant** : Réponses les plus rapides pour tâches simples
    - **Mixtral** : Bon équilibre de performance et d'efficacité

## Dépannage

- **"Clé API Invalide" :** Vérifiez que votre clé API est correcte et active dans la Console Groq
- **"Modèle Non Disponible" :** Vérifiez si le modèle sélectionné est disponible dans votre région
- **Erreurs de Limite de Débit :** Surveillez votre utilisation dans la Console Groq et considérez mettre à jour votre plan
- **Problèmes de Connexion :** Assurez-vous d'avoir une connexion internet stable et que les services Groq sont opérationnels

## Tarification

Groq offre une tarification compétitive basée sur les tokens d'entrée et de sortie. Visitez la [page de tarification Groq](https://groq.com/pricing/) pour les taux actuels et les options de plan.
