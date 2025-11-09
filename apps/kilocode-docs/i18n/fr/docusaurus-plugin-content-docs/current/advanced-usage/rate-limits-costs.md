# Limites de Débit et Coûts

Comprendre et gérer l'utilisation de l'API est crucial pour une expérience fluide et rentable avec Kilo Code. Cette section explique comment suivre votre utilisation des tokens, les coûts, et comment configurer les limites de débit.

## Utilisation des Tokens

Kilo Code interagit avec les modèles d'IA en utilisant des tokens. Les tokens sont essentiellement des morceaux de mots. Le nombre de tokens utilisés dans une requête et une réponse affecte à la fois le temps de traitement et le coût.

- **Tokens d'Entrée :** Ce sont les tokens dans votre prompt, incluant le prompt système, vos instructions, et tout contexte fourni (ex: contenus de fichiers).
- **Tokens de Sortie :** Ce sont les tokens générés par le modèle d'IA dans sa réponse.

Vous pouvez voir le nombre de tokens d'entrée et de sortie utilisés pour chaque interaction dans l'historique de chat.

## Calcul des Coûts

La plupart des fournisseurs d'IA facturent en fonction du nombre de tokens utilisés. La tarification varie selon le fournisseur et le modèle spécifique.

Kilo Code calcule automatiquement le coût estimé de chaque requête API basé sur la tarification du modèle configuré. Ce coût est affiché dans l'historique de chat, à côté de l'utilisation des tokens.

**Note :**

- Le calcul du coût est une _estimation_. Le coût réel peut varier légèrement selon les pratiques de facturation du fournisseur.
- Certains fournisseurs peuvent offrir des paliers gratuits ou des crédits. Consultez la documentation de votre fournisseur pour plus de détails.
- Certains fournisseurs offrent le cache de prompts ce qui réduit considérablement les coûts.

## Configuration des Limites de Débit

Pour prévenir une surutilisation accidentelle de l'API et vous aider à gérer les coûts, Kilo Code vous permet de définir une limite de débit. La limite de débit spécifie le temps minimum (en secondes) entre les requêtes API.

**Comment configurer :**

1.  Ouvrez les paramètres de Kilo Code (icône <Codicon name="gear" /> dans le coin supérieur droit).
2.  Allez à la section "Paramètres Avancés".
3.  Trouvez le paramètre "Limite de Débit (secondes)".
4.  Entrez le délai souhaité en secondes. Une valeur de 0 désactive la limitation de débit.

**Exemple :**

Si vous définissez la limite de débit à 10 secondes, Kilo Code attendra au moins 10 secondes après qu'une requête API se termine avant d'envoyer la suivante.

## Conseils pour Optimiser l'Utilisation des Tokens

- **Soyez Concis :** Utilisez un langage clair et concis dans vos prompts. Évitez les mots ou détails inutiles.
- **Fournissez Seulement le Contexte Pertinent :** Utilisez les mentions de contexte (`@fichier.ts`, `@dossier/`) de manière sélective. N'incluez que les fichiers directement pertinents pour la tâche.
- **Décomposez les Tâches :** Divisez les tâches importantes en sous-tâches plus petites et plus concentrées.
- **Utilisez des Instructions Personnalisées :** Fournissez des instructions personnalisées pour guider le comportement de Kilo Code et réduire le besoin d'explications longues dans chaque prompt.
- **Choisissez le Bon Modèle :** Certains modèles sont plus rentables que d'autres. Envisagez d'utiliser un modèle plus petit et plus rapide pour les tâches qui ne nécessit pas toute la puissance d'un modèle plus grand.
- **Utilisez les Modes :** Différents modes peuvent accéder à différents outils, par exemple `Architect` ne peut pas modifier le code, ce qui en fait un choix sûr lors de l'analyse d'une base de code complexe, sans s'inquiéter d'autoriser accidentellement des opérations coûteuses.
- **Désactivez MCP Si Non Utilisé :** Si vous n'utilisez pas les fonctionnalités MCP (Model Context Protocol), envisagez de [le désactiver dans les paramètres MCP](/features/mcp/using-mcp-in-kilo-code) pour réduire considérablement la taille du prompt système et économiser des tokens.

En comprenant et en gérant votre utilisation de l'API, vous pouvez utiliser Kilo Code efficacement et efficacement.
