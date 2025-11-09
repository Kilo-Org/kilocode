# Appels de Fonction Natif

## Contexte

Historiquement, Kilo Code s'est appuyé sur des définitions de fonction et outil de style XML intégrées dans le prompt système pour informer le modèle sur les outils disponibles pour accomplir les tâches. Le modèle recevait des instructions et des exemples sur comment utiliser ces outils :

```xml
<attempt_completion>
<reason>Put your reason here</reason>
</attempt_completion>

Use this tool to signal to the user you are complete.
```

Cette technique a été développée vers 2023 et utilisée d'abord par Anthropic à grande échelle. Elle était efficace et précieuse, car elle permettait aux développeurs de spécifier des outils arbitraires à l'exécution, plutôt que de s'appuyer sur des options préconfigurées depuis les laboratoires de modèles.

Cependant, elle souffre aussi de nombreux inconvénients. Son remplacement effectif est les appels de fonction natifs de style JSON qui sont envoyés au modèle dans un champ dédié et avec un schéma fort, facilement validable.

## Qu'est-ce que c'est

Kilo Code a récemment implémenté un support _expérimental_ pour les appels de fonction natifs dans 4.106.0.

## Pourquoi ?

1. Les appels de fonction natifs offrent une plus grande fiabilité que les anciens motifs de style XML car le modèle est explicitement entraîné à décider quand appeler une fonction et à retourner seulement les arguments structurés qui correspondent à une signature déclarée. Cela réduit les modes d'échec classiques des prompts XML, où le modèle pourrait entrelacer prose avec markup, abandonner des champs requis, ou halluciner des structures de balises. Avec les appels natifs, la signature de fonction agit comme un contrat ; le modèle retourne des arguments pour ce contrat plutôt qu'un texte libre, ce qui matériellement améliore les taux de succès d'appel et le déterminisme en aval.

2. La validation de schéma devient de première classe avec les appels de fonction natifs. Au lieu d'intégrer des schémas dans des prompts et d'espérer que le modèle adhère, nous enregistrons une définition de paramètre similaire à JSON-schema avec la fonction. La sortie du modèle est contrainte à ces types et enums, permettant une validation côté serveur directe et une gestion d'erreurs et des relances plus claires. En pratique, cela élimine beaucoup du nettoyage fragile de regex et heuristique commun avec les prompts XML, et nous permet d'implémenter des boucles robustes "valider → corriger → relancer" liées à des contraintes de paramètre explicites.

3. Finalement, les appels de fonction natifs peuvent améliorer l'efficacité de cache et le débit. Parce que les arguments sont structurés et validés, les appels équivalents se normalisent vers la même charge utile plus souvent que des blobs XML sémantiquement similaires mais syntaxiquement différents. Cette normalisation augmente les taux de succès de cache à travers des invocations d'outils identiques, réduisant la latence et le coût, et rendant le comportement de bout en bout plus prévisible lors du chaînage de plusieurs outils ou du travail à travers des fournisseurs. Tandis que l'appel XML peut atteindre des taux de succès de cache de tokens d'entrée de 80-85% sur des modèles modernes comme GPT-5, les appels de fonction natifs peuvent augmenter cela à 90%+, tout en atteignant aussi la plus grande fiabilité décrite ci-dessus.

## Inconvénients

Il y a quelques considérations et défis.

1. Compatibilité Modèle : Tous les modèles ne sont pas entraînés pour les appels de fonction natifs, particulièrement les petits modèles en dessous de 4-7B paramètres. Cela dit, la grande majorité des modèles, tant ouverts que fermés, publiés depuis juin 2025 _font_ supporter les appels de fonction natifs.
2. Compatibilité Fournisseur : Il y a de nombreux fournisseurs "compatibles" OpenAI sur le marché, utilisant une variété d'outils pour supporter leurs produits (souvent vLLM, SGLang, TensorRT-LLM). Au-delà de cela, il y a de nombreux outils de modèles locaux (LM Studio, Ollama, Osaurus). Malgré leur réclamation de compatibilité avec la spécification API OpenAI, il est commun de voir des implémentations partielles ou totalement incorrectes.

À cause de ces risques et considérations, cette capacité est expérimentale, et désactivée par défaut pour nearly tous les modèles et fournisseurs.

## Utilisation

Pour activer et utiliser les appels de fonction natifs, considérez et effectuez ce qui suit :

1. Assurez-vous d'utiliser un fournisseur qui a été activé dans Kilo Code pour cette expérience. Au 21 octobre 2025, ils incluent :

- OpenRouter
- Kilo Code
- LM Studio
- OpenAI Compatible
- Z.ai
- Synthetic
- X.ai
- Chutes

Par défaut, les appels de fonction natifs sont _désactivés_ pour la plupart des modèles. Si vous souhaitez l'essayer, ouvrez les paramètres avancés pour un profil de fournisseur donné qui est inclus dans le groupe de test.

Changez le Style d'Appel d'Outil à `JSON`, et sauvegardez le profil.

## Avertissements

Cette fonctionnalité est actuellement expérimentale et mostly destinée aux utilisateurs intéressés à contribuer à son développement.

Il y a des problèmes possibles incluant, mais non limités à :

- ~~Outils manquants~~ : Au 21 octobre, tous les outils sont supportés
- Les appels d'outils ne mettant pas à jour l'UI jusqu'à ce qu'ils soient complets
- ~~Serveurs MCP ne fonctionnant pas~~ : Au 21 octobre, les MCPs sont supportés
- Erreurs spécifiques à certains fournisseurs d'inférence
    - Tous les fournisseurs d'inférence n'utilisent pas des serveurs qui sont entièrement compatibles avec la spécification OpenAI. En conséquence, le comportement variera, même avec le même modèle à travers les fournisseurs.

Tandis que nearly n'importe quel fournisseur peut être configuré via le profil OpenAI Compatible, les testeurs devraient être conscients que c'est activé purement pour la facilité de test et devraient être préparés à expérimenter des réponses inattendues de fournisseurs qui ne sont pas préparés à gérer les appels de fonction natifs.
