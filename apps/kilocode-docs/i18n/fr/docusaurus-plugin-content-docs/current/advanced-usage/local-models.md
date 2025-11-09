# Utilisation de Modèles Locaux

Kilo Code supporte l'exécution de modèles de langage localement sur votre propre machine en utilisant [Ollama](https://ollama.com/) et [LM Studio](https://lmstudio.ai/). Cela offre plusieurs avantages :

- **Confidentialité :** Votre code et vos données ne quittent jamais votre ordinateur.
- **Accès Hors Ligne :** Vous pouvez utiliser Kilo Code même sans connexion internet.
- **Économies de Coûts :** Évitez les frais d'utilisation d'API associés aux modèles cloud.
- **Personnalisation :** Expérimentez avec différents modèles et configurations.

**Cependant, l'utilisation de modèles locaux présente également quelques inconvénients :**

- **Exigences de Ressources :** Les modèles locaux peuvent être gourmands en ressources, nécessitant un ordinateur puissant avec un bon CPU et, idéalement, un GPU dédié.
- **Complexité de Configuration :** La configuration des modèles locaux peut être plus complexe que l'utilisation d'API cloud.
- **Performance des Modèles :** La performance des modèles locaux peut varier considérablement. Bien que certains soient excellents, ils ne correspondent pas toujours aux capacités des modèles cloud les plus grands et les plus avancés.
- **Fonctionnalités Limitées** : Les modèles locaux (et de nombreux modèles en ligne) ne supportent souvent pas les fonctionnalités avancées telles que le cache de prompts, l'utilisation ordinateur, et d'autres.

## Fournisseurs de Modèles Locaux Supportés

Kilo Code supporte actuellement deux principaux fournisseurs de modèles locaux :

1.  **Ollama :** Un outil open-source populaire pour exécuter des grands modèles de langage localement. Il supporte une large gamme de modèles.
2.  **LM Studio :** Une application de bureau conviviale qui simplifie le processus de téléchargement, configuration et exécution de modèles locaux. Il fournit également un serveur local qui émule l'API OpenAI.

## Configuration des Modèles Locaux

Pour des instructions de configuration détaillées, voir :

- [Configuration d'Ollama](/providers/ollama)
- [Configuration de LM Studio](/providers/lmstudio)

Les deux fournisseurs offrent des capacités similaires mais avec des interfaces utilisateur et des workflows différents. Ollama fournit plus de contrôle via son interface en ligne de commande, tandis que LM Studio offre une interface graphique plus conviviale.

## Dépannage

- **"Aucune connexion n'a pu être établie car la machine cible a activement refusé" :** Cela signifie généralement que le serveur Ollama ou LM Studio n'est pas en cours d'exécution, ou s'exécute sur un port/adresse différent de celui que Kilo Code est configuré pour utiliser. Vérifiez deux fois le paramètre URL de Base.

- **Temps de Réponse Lents :** Les modèles locaux peuvent être plus lents que les modèles cloud, surtout sur du matériel moins puissant. Si la performance est un problème, essayez d'utiliser un modèle plus petit.

- **Modèle Non Trouvé :** Assurez-vous d'avoir tapé correctement le nom du modèle. Si vous utilisez Ollama, utilisez le même nom que vous fournissez dans la commande `ollama run`.
