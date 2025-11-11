# ask_followup_question

L'outil `ask_followup_question` permet la communication interactive en posant des questions spécifiques pour rassembler des informations additionnelles nécessaires pour compléter efficacement les tâches.

## Paramètres

L'outil accepte ces paramètres :

- `question` (requis) : La question spécifique à poser à l'utilisateur
- `follow_up` (optionnel) : Une liste de 2-4 réponses suggérées qui aident à guider les réponses utilisateur, chacune dans des balises `<suggest>`

## Ce qu'il fait

Cet outil crée une interface conversationnelle entre Kilo Code et l'utilisateur, permettant de rassembler des clarifications, détails additionnels, ou préférences utilisateur face aux ambiguïtés ou points de décision. Chaque question peut inclure des réponses suggérées pour rationaliser l'interaction.

## Quand est-il utilisé ?

- Quand des informations critiques manquent de la requête originale
- Quand Kilo Code a besoin de choisir entre plusieurs approches d'implémentation valides
- Quand des détails techniques ou préférences sont requis pour continuer
- Quand Kilo Code rencontre des ambiguïtés qui nécessitent une résolution
- Quand du contexte additionnel améliorerait significativement la qualité de la solution

## Caractéristiques Clés

- Fournit un moyen structuré de rassembler des informations spécifiques sans casser le flux de travail
- Inclut des réponses suggérées pour réduire la saisie utilisateur et guider les réponses
- Maintient l'historique de conversation et le contexte à travers les interactions
- Supporte les réponses contenant des images et extraits de code
- Disponible dans tous les modes comme partie de l'ensemble d'outils "toujours disponibles"
- Permet une guidance utilisateur directe sur les décisions d'implémentation
- Formate les réponses avec des balises `<answer>` pour les distinguer de la conversation régulière
- Remet à zéro le compteur d'erreurs consécutives quand utilisé avec succès

## Limitations

- Limité à poser une question spécifique par utilisation d'outil
- Présente les suggestions comme options sélectionnables dans l'UI
- Ne peut pas forcer des réponses structurées – les utilisateurs peuvent toujours répondre librement
- L'usage excessif peut ralentir l'achèvement de tâche et créer une expérience fragmentée
- Les réponses suggérées doivent être complètes, sans placeholders nécessitant des éditions utilisateur
- Pas de validation intégrée pour les réponses utilisateur
- Ne contient aucun mécanisme pour appliquer des formats de réponse spécifiques

## Comment ça fonctionne

Quand l'outil `ask_followup_question` est invoqué, il suit ce processus :

1. **Validation de Paramètres** : Valide le paramètre `question` requis et vérifie les suggestions optionnelles

    - S'assure que le texte de question est fourni
    - Parse toute réponse suggérée depuis le paramètre `follow_up` en utilisant la bibliothèque `fast-xml-parser`
    - Normalise les suggestions en format tableau même s'il n'y a qu'une seule suggestion

2. **Transformation JSON** : Convertit la structure XML en format JSON standardisé pour affichage UI

    ```typescript
    {
      question: "Question de l'utilisateur ici",
      suggest: [
        { answer: "Suggestion 1" },
        { answer: "Suggestion 2" }
      ]
    }
    ```

3. **Intégration UI** :

    - Passe la structure JSON à la couche UI via la méthode `ask("followup", ...)`
    - Affiche des boutons de suggestion sélectionnables à l'utilisateur dans l'interface
    - Crée une expérience interactive pour sélectionner ou taper une réponse

4. **Collecte et Traitement de Réponse** :

    - Capture la saisie de texte utilisateur et toute image incluse dans la réponse
    - Enveloppe les réponses utilisateur dans des balises `<answer>` quand retournées à l'assistant
    - Préserve toute image incluse dans la réponse utilisateur
    - Maintient le contexte conversationnel en ajoutant la réponse à l'historique
    - Remet à zéro le compteur d'erreurs consécutives quand l'outil est utilisé avec succès

5. **Gestion d'Erreur** :
    - Suit les erreurs consécutives en utilisant un compteur
    - Remet le compteur à zéro quand l'outil est utilisé avec succès
    - Fournit des messages d'erreur spécifiques :
        - Pour les paramètres manquants : "Paramètre requis manquant 'question'"
        - Pour le parsing XML : "Échec du parsing des opérations : [message d'erreur]"
        - Pour le format invalide : "Format d'opérations XML invalide"
    - Contient des garde-fous pour empêcher l'exécution d'outil quand les paramètres requis manquent
    - Incrémente le nombre d'erreurs consécutives quand des erreurs se produisent

## Séquence de Workflow de Workflow

Le cycle question-réponse suit cette séquence :

1. **Reconnaissance d'Écart d'Information** : Kilo Code identifie les informations manquantes nécessaires pour continuer
2. **Création de Question Spécifique** : Kilo Code formule une question claire et ciblée
3. **Développement de Suggestion** : Kilo Code crée des réponses suggérées pertinentes (optionnel mais recommandé)
4. **Invocation d'Outil** : L'assistant invoque l'outil avec la question et suggestions optionnelles
5. **Présentation UI** : La question et suggestions sont affichées à l'utilisateur comme éléments interactifs
6. **Réponse Utilisateur** : L'utilisateur sélectionne une suggestion ou fournit une réponse personnalisée
7. **Gestion de Message** : Le système gère les messages partiels et complets
    - Pour les réponses en streaming, traite les chunks alors qu'ils arrivent
    - Pour les messages complets, traite la réponse entière d'un coup
    - Maintient la consistance d'état indépendamment du chunking de message
8. **Traitement de Réponse** : Le système enveloppe la réponse dans des balises `<answer>` et préserve les images
9. **Intégration de Contexte** : La réponse est ajoutée à l'historique de conversation
10. **Continuation de Tâche** : Kilo Code continue avec la tâche en utilisant les nouvelles informations

## Exemples d'Utilisation

- En développant une application web, Kilo Code pourrait demander à propos des frameworks de style préférés (Bootstrap, Tailwind, CSS personnalisé)
- En créant une API, Kilo Code pourrait demander à propos des méthodes d'authentification (JWT, OAuth, clés API)
- En refactorisant du code, Kilo Code pourrait demander à propos de la priorisation de performance vs. lisibilité
- En configurant une base de données, Kilo Code pourrait demander à propos des préférences de conception de schéma spécifiques
- En créant une fonctionnalité personnalisée, Kilo Code pourrait demander à propos des attentes de comportement spécifiques
- En déboguant des erreurs, Kilo Code pourrait demander à propos des détails d'environnement spécifiques

## Format de Réponse

Quand un utilisateur répond à une question, la réponse est formatée avec des balises `<answer>` pour clarté et consistance. Ce format aide à clairement séparer la réponse de l'utilisateur des autres éléments de conversation.

Exemple de format de réponse :

```
<answer>
Utiliser Tailwind CSS pour le style utility-first avec une flexibilité maximale
</answer>
```

Caractéristiques clés du format de réponse :

- Entouré par des balises `<answer>`
- Préserve le formatage de la réponse originale
- Maintient les images si incluses dans la réponse
- Retourne le texte complet, même pour les réponses longues

## Exemples d'Usage

Demander à propos des préférences d'implémentation :

```
<ask_followup_question>
<question>Quelle approche de style préféreriez-vous pour cette application web ?</question>
<follow_up>
<suggest>Utiliser Bootstrap pour un développement rapide avec des composants cohérents</suggest>
<suggest>Utiliser Tailwind CSS pour le style utility-first avec une flexibilité maximale</suggest>
<suggest>Utiliser du CSS vanilla avec style personnalisé pour un contrôle complet et des dépendances minimales</suggest>
</follow_up>
</ask_followup_question>
```

Demander une clarification technique :

```
<ask_followup_question>
<question>Quelle base de données cette application devrait-elle utiliser pour stocker les données utilisateur ?</question>
<follow_up>
<suggest>MongoDB pour le schéma flexible et le stockage basé sur document</suggest>
<suggest>PostgreSQL pour les données relationnelles avec des garanties de cohérence fortes</suggest>
<suggest>Firebase pour les mises à jour temps réel et la gestion backend simplifiée</suggest>
<suggest>SQLite pour le stockage local léger sans dépendances externes</suggest>
</follow_up>
</ask_followup_question>
```

Adresser l'ambiguïté dans les exigences :

```
<ask_followup_question>
<question>Comment l'application devrait-elle gérer l'authentification utilisateur ?</question>
<follow_up>
<suggest>Implémenter l'authentification email/mot de passe avec vérification de compte</suggest>
<suggest>Utiliser les fournisseurs de connexion sociale (Google, GitHub, etc.) pour une inscription rapide</suggest>
<suggest>Implémenter à la fois les options email/mot de passe et connexion sociale</suggest>
</follow_up>
</ask_followup_question>
```
