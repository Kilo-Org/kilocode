# kilo-code

## [v4.117.0]

- [#3568](https://github.com/Kilo-Org/kilocode/pull/3568) [`18dfc86`](https://github.com/Kilo-Org/kilocode/commit/18dfc86e5f00e0d722f448450574ec444d3c894a) Merci à [@mcowger](https://github.com/mcowger)! - Ajouter Kimi K2-Thinking au Fournisseur Synthétique

## [v4.116.1]

- [#3533](https://github.com/Kilo-Org/kilocode/pull/3533) [`f5bb82d`](https://github.com/Kilo-Org/kilocode/commit/f5bb82ddf4038ed2d9e5a1266c9e6b0dc09c0af5) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction d'un blocage au démarrage

## [v4.116.0]

- [#3288](https://github.com/Kilo-Org/kilocode/pull/3288) [`afeca17`](https://github.com/Kilo-Org/kilocode/commit/afeca176f4ef7d27831715b5e5a672fcf3fe58f) Merci à [@mcowger](https://github.com/mcowger)! - Ajouter le support natif MCP pour l'appel d'outils JSON

### Changements de correctif

- [#3471](https://github.com/Kilo-Org/kilocode/pull/3471) [`9895a95`](https://github.com/Kilo-Org/kilocode/commit/9895a959b9bb8a14aab6ec11267a2bb0e12fb78c) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Autoriser l'appel natif d'outils pour le fournisseur Qwen Code

- [#3513](https://github.com/Kilo-Org/kilocode/pull/3513) [`ff2e459`](https://github.com/Kilo-Org/kilocode/commit/ff2e4595777683265559f81f82dd9cbb0dc2e9f3) Merci à [@markijbema](https://github.com/markijbema)! - Empêcher l'autocomplétion de suggérer la duplication de la ligne précédente ou suivante

- [#3523](https://github.com/Kilo-Org/kilocode/pull/3523) [`ba5416a`](https://github.com/Kilo-Org/kilocode/commit/ba5416ae3083fb5225ed7e9f0e1018203e611b84) Merci à [@markijbema](https://github.com/markijbema)! - Suppression de l'animation de la marge pour l'autocomplétion

- [#2893](https://github.com/Kilo-Org/kilocode/pull/2893) [`37d8493`](https://github.com/Kilo-Org/kilocode/commit/37d8493a4d2629d0498f089b40f850ddae0c91fc) Merci à [@ivanarifin](https://github.com/ivanarifin)! - correction(virtual-quota): afficher le modèle actif dans l'interface utilisateur pour le frontend

    Lorsque le backend change de modèle, il émet maintenant un signal "le modèle a changé" en émettant un événement.
    La logique principale de l'application attrape ce signal et indique immédiatement à l'interface utilisateur de se rafraîchir.
    L'interface utilisateur met ensuite à jour l'affichage pour montrer le nom du nouveau modèle actuellement actif.
    Cela permettra également de synchroniser le modèle actif du backend et du frontend

## [v4.115.0]

- [#3486](https://github.com/Kilo-Org/kilocode/pull/3486) [`2b89d84`](https://github.com/Kilo-Org/kilocode/commit/2b89d8472123e48db866e10a88b5b6160812d73e) Merci à [@markijbema](https://github.com/markijbema)! - Afficher l'outil MCP au lieu du nom du serveur lorsqu'on demande d'approuver un outil

- [#3466](https://github.com/Kilo-Org/kilocode/pull/3466) [`e623ce1`](https://github.com/Kilo-Org/kilocode/commit/e623ce146bbad7453355ee84a4b4bb2fc894b031) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci à @pranjaldatta! Ajout du support pour Inception en tant que fournisseur

- [#2435](https://github.com/Kilo-Org/kilocode/pull/2435) [`c13fe3c`](https://github.com/Kilo-Org/kilocode/commit/c13fe3c634496b9e1fc08371822a4071407ff9bc) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Le nettoyage automatique gère automatiquement l'historique des tâches en supprimant les anciennes tâches pour libérer de l'espace disque et améliorer les performances - https://kilocode.ai/docs/advanced-usage/auto-cleanup

### Changements de correctif

- [#3428](https://github.com/Kilo-Org/kilocode/pull/3428) [`b3c0e10`](https://github.com/Kilo-Org/kilocode/commit/b3c0e102cad5e48fe1389dc55a287dfc0072ed33) Merci à [@markijbema](https://github.com/markijbema)! - Faire moins de requêtes pour l'autocomplétion quand aucune complétion n'a pu être trouvée

- [#3502](https://github.com/Kilo-Org/kilocode/pull/3502) [`94552b8`](https://github.com/Kilo-Org/kilocode/commit/94552b8704efa80a9f7aee8ad601a3f291ffe7f2) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Réversion de la correction des messages partielles orphelines

## [v4.114.1]

- [#3188](https://github.com/Kilo-Org/kilocode/pull/3188) [`131fa0e`](https://github.com/Kilo-Org/kilocode/commit/131fa0ee68d6f47172a968489129071a7da88de3) Merci à [@NikoDi2000](https://github.com/NikoDi2000)! - Ajout des infobulles manquantes pour activer/désactiver le retour à la ligne

- [#3357](https://github.com/Kilo-Org/kilocode/pull/3357) [`d2bb122`](https://github.com/Kilo-Org/kilocode/commit/d2bb122a8b0e80044a66fe141de39489f7098bb5) Merci à [@mollux](https://github.com/mollux)! - Maintenant, seules les capacités des serveurs MCP disponibles sont récupérées

- [#2817](https://github.com/Kilo-Org/kilocode/pull/2817) [`0da1bc7`](https://github.com/Kilo-Org/kilocode/commit/0da1bc772a700874f8ec3fbad039fed1ea4d89dc) Merci à [@dennismeister93](https://github.com/dennismeister93)! - Mise à jour du SDK MCP vers la version 1.13.3

- [#2849](https://github.com/Kilo-Org/kilocode/pull/2849) [`642cec5`](https://github.com/Kilo-Org/kilocode/commit/642cec502c9fecd297dce8cb1cc708ad3e9c7d12) Merci à [@Ralph-Abejuela](https://github.com/Ralph-Abejuela)! - Ajout d'une option pour démarrer la limitation de débit après la fin du flux API

- [#3468](https://github.com/Kilo-Org/kilocode/pull/3468) [`8f8ef10`](https://github.com/Kilo-Org/kilocode/commit/8f8ef107dd2751e4141473d33e098d6f28faa6d1) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Résolution des messages partielles orphelines

- [#3213](https://github.com/Kilo-Org/kilocode/pull/3213) [`7238628`](https://github.com/Kilo-Org/kilocode/commit/7238628bc24058eb352ff231090c08d99a8a8961) Merci à [@siulong](https://github.com/siulong)! - Correction du lien de feedback GitHub en bas du marketplace qui n'était pas cliquable.

## [v4.114.0]

- [#3435](https://github.com/Kilo-Org/kilocode/pull/3435) [`bd4f19d`](https://github.com/Kilo-Org/kilocode/commit/bd4f19da040462b6477087d76cffe1006ef8d444) Merci à [@markijbema](https://github.com/markijbema)! - Cmd-L insère maintenant directement au lieu de s'afficher en texte fantôme

### Changements de correctif

- [#3435](https://github.com/Kilo-Org/kilocode/pull/3435) [`7f018d8`](https://github.com/Kilo-Org/kilocode/commit/7f018d8428a994c6ada6ecbda95a75336150946b) Merci à [@markijbema](https://github.com/markijbema)! - Améliorations mineures de la gestion d'état interne de l'autocomplétion

- [#3379](https://github.com/Kilo-Org/kilocode/pull/3379) [`9c7b99c`](https://github.com/Kilo-Org/kilocode/commit/9c7b99c716d92deabc49ec07f5771c03b3507b2c) Merci à [@TsFreddie](https://github.com/TsFreddie)! - Mise à jour des tarifs pour DeepSeek V3.2

- [#3342](https://github.com/Kilo-Org/kilocode/pull/3342) [`8827792`](https://github.com/Kilo-Org/kilocode/commit/88277927f69e1baae6f61f0e76f3a43862abd31e) Merci à [@mcowger](https://github.com/mcowger)! - Amélioration des messages quand VS Code LM n'est pas disponible

- [#3437](https://github.com/Kilo-Org/kilocode/pull/3437) [`829f052`](https://github.com/Kilo-Org/kilocode/commit/829f052d199ef8013671392ce70230048dde6e0) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout du modèle zai-glm-4.6 au Cerebras et définition de gpt-oss-120b comme modèle par défaut (merci Roo)

- [#3411](https://github.com/Kilo-Org/kilocode/pull/3411) [`2dc2a32`](https://github.com/Kilo-Org/kilocode/commit/2dc2a32d9db54cfe3908263eb5f594c99058dde5) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Correction des mentions @ lors de l'édition de messages

## [v4.113.1]

- [#3408](https://github.com/Kilo-Org/kilocode/pull/3408) [`5aee3ad`](https://github.com/Kilo-Org/kilocode/commit/5aee3ad6ee200efd5dd12933ba650989ccc0857) Merci à [@brianc](https://github.com/brianc)! - Correction de l'indicateur d'autocomplétion. Il se cache maintenant correctement si la requête d'autocomplétion échoue en arrière-plan.

## [v4.113.0]

- [#3382](https://github.com/Kilo-Org/kilocode/pull/3382) [`98c4d89`](https://github.com/Kilo-Org/kilocode/commit/98c4d89f414394de0b5ab579e9216c860b4a1d30) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajout de descriptions aux en-têtes du marketplace MCP et des modes

- [#2442](https://github.com/Kilo-Org/kilocode/pull/2442) [`34b04ae`](https://github.com/Kilo-Org/kilocode/commit/34b04ae0c5763757c41bfbd3132aed3a67d2ac7a) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajout de la génération de messages de commit alimentée par l'IA aux IDEs Jetbrains

### Changements de correctif

- [#3373](https://github.com/Kilo-Org/kilocode/pull/3373) [`3cb7d20`](https://github.com/Kilo-Org/kilocode/commit/3cb7d20fc79707f901c8429c971ed86500b0b527) Merci à [@markijbema](https://github.com/markijbema)! - Correction: restauration de la fonctionnalité cmd-l

## [v4.112.1]

- [#3375](https://github.com/Kilo-Org/kilocode/pull/3375) [`52d39dd`](https://github.com/Kilo-Org/kilocode/commit/52d39ddaadf3b3ce8388db02078b004b6573e6da) Merci à [@RSO](https://github.com/RSO)! - Correction de l'activation/désactivation de l'autocomplétion

## [v4.112.0]

- [#3346](https://github.com/Kilo-Org/kilocode/pull/3346) [`5d82884`](https://github.com/Kilo-Org/kilocode/commit/5d828842b502b6accd2e0423db99ef8bdc0dbf33) Merci à [@mcowger](https://github.com/mcowger)! - Correction des modèles Anthropic qui ne fonctionnaient pas sur Google Vertex Global

## [v4.111.2]

- [#3363](https://github.com/Kilo-Org/kilocode/pull/3363) [`233334c`](https://github.com/Kilo-Org/kilocode/commit/23334cd28447290b67359add7e0f703d8707b7) Merci à [@markijbema](https://github.com/markijbema)! - Diverses améliorations de la fonctionnalité d'autocomplétion

## [v4.11.1]

- [#3282](https://github.com/Kilo-Org/kilocode/pull/3282) [`ed4399b`](https://github.com/Kilo-Org/kilocode/commit/ed4399b7d82d735895fbf4d85cfaefff5002571a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration de la gestion des appels d'outils dans l'historique des conversations API

- [#3270](https://github.com/Kilo-Org/kilocode/pull/3270) [`2b35053`](https://github.com/Kilo-Org/kilocode/commit/2b350530367bb0a14a0fdc7c1a030c2943c6cf6) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Claude Haiku 4.5 utilise maintenant un outil de lecture de fichier simplifié pour réduire le taux d'erreur

## [v4.111.0]

- [#3256](https://github.com/Kilo-Org/kilocode/pull/3256) [`f81b48b`](https://github.com/Kilo-Org/kilocode/commit/f81b48b8dec9cd276c3c7ba994d0512036abfa96) Merci à [@markijbema](https://github.com/markijbema)! - Passage de l'autocomplétion à l'affichage des complétions en ligne

### Changements de correctif

- [#3261](https://github.com/Kilo-Org/kilocode/pull/3261) [`bae048f`](https://github.com/Kilo-Org/kilocode/commit/bae048f914712439e54f29363d52dc248600e7) Merci à [@mcowger](https://github.com/mcowger)! - Amélioration de la cohérence de l'appel natif d'outils

- [#3281](https://github.com/Kilo-Org/kilocode/pull/3281) [`2586e9b`](https://github.com/Kilo-Org/kilocode/commit/2586e9b4f6cbea9734ff10df7086f2d999713448) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction des liens de connexion cassés

- [#3313](https://github.com/Kilo-Org/kilocode/pull/3313) [`2e61e91`](https://github.com/Kilo-Org/kilocode/commit/2e61e9152ae3be43ce12e9fd3c2f94c0d603d771) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les commandes en cours d'exécution ne sont plus parfois affichées deux fois dans le chat

## [v4.110.0]

### Changements de correctif

- [#3249](https://github.com/Kilo-Org/kilocode/pull/3249) [`ccee64c`](https://github.com/Kilo-Org/kilocode/commit/ccee64cf1676f51a6b9dae49aad994d9f834b3e8) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Suppression de la barre d'état du crédit jusqu'à ce que l'on puisse récupérer le solde à jour depuis la réponse du proxy.

- [#3235](https://github.com/Kilo-Org/kilocode/pull/3235) [`0108896`](https://github.com/Kilo-Org/kilocode/commit/010889619121159a8993ad5846ac2cccecd91bd8) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de certains plantages "n'est pas une fonction"

- [#3226](https://github.com/Kilo-Org/kilocode/pull/326) [`e13a99c`](https://github.com/Kilo-Org/kilocode/commit/e13a99c67bd644e7ab9372757227aab3f72da1d4) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Réversion de "Mise à jour de l'URL de base pour les modèles Vertex Anthropic pour contourner la bibliothèque obsolète." car cela cause des problèmes à certains utilisateurs.

- [#2663](https://github.com/Kilo-Org/kilocode/pull/2663) [`43140c9`](https://github.com/Kilo-Org/kilocode/commit/43140c950719d9718c089e45f9ae63b334dd9a6e) Merci à [@NaccOll](https://github.com/NaccOll)! - Correction de listCodeDefinitionNamesTool pour les méthodes Java annotées

- [#3242](https://github.com/Kilo-Org/kilocode/pull/3242) [`8604c83`](https://github.com/Kilo-Org/kilocode/commit/8604c838b205eaa1bdf510b8b64083a8c9c15377) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration du support des variables d'environnement proxy HTTP

## [v4.109.2]

- [#3216](https://github.com/Kilo-Org/kilocode/pull/3216) [`3f34635`](https://github.com/Kilo-Org/kilocode/commit/3f3463554f7cf016db9b2851c40217e38a048840) Merci à [@markijbema](https://github.com/markijbema)! - N'accepter pas une suggestion d'autocomplétion avec shift-tab ou ctrl-tab (seulement tab normal)

- [#3214](https://github.com/Kilo-Org/kilocode/pull/3214) [`b271af9`](https://github.com/Kilo-Org/kilocode/commit/b271af9c51da9a8f6ec3a6f4caf78ff18db9b3a8) Merci à [@mcowger](https://github.com/mcowger)! - Mise à jour du Fournisseur Synthétique pour supporter GLM 4.6, et activation de l'appel natif d'outils

- [#3199](https://github.com/Kilo-Org/kilocode/pull/3199) [`14bbc5f`](https://github.com/Kilo-Org/kilocode/commit/14bbc5f9b5a61cbf2016c7b6a784fdc546fa6a0e) Merci à [@possible055](https://github.com/possible055)! - Amélioration de la traduction chinoise des termes liés à l'autocomplétion

## [v4.109.1]

- [#3203](https://github.com/Kilo-Org/kilocode/pull/3203) [`aeb8bf3`](https://github.com/Kilo-Org/kilocode/commit/aeb8bf37df44532517db96511e3f0f85861f55b8) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction du fournisseur Z.ai donnant une erreur non autorisée

## [v4.109.0]

- [#3088](https://github.com/Kilo-Org/kilocode/pull/3088) [`84a1fa3`](https://github.com/Kilo-Org/kilocode/commit/84a1fa3f84eac42fa76da9be09270cdb57b19b34) Merci à [@mcowger](https://github.com/mcowger)! - Mise à jour de l'URL de base pour les modèles Vertex Anthropic pour contourner la bibliothèque obsolète.

- [#3192](https://github.com/Kilo-Org/kilocode/pull/3192) [`7015c23`](https://github.com/Kilo-Org/kilocode/commit/7015c2367c0ddf45d40b4adf96386f3ca5005bc1) Merci à [@markijbema](https://github.com/markijbema)! - Correction du bug: l'autocomplétion ne suggère plus d'étranges XML

### Changements de correctif

- [#3159](https://github.com/Kilo-Org/kilocode/pull/3159) [`935bbae`](https://github.com/Kilo-Org/kilocode/commit/935bbae3a080c8475671b97440eacf2ead939198) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.28.18

    - Correction: Suppression du contenu de la requête de l'interface des messages pour améliorer les performances et réduire l'encombrement (#5601 par @MuriloFP, #8594 par @multivac2x, #8690 par @hannesrudolph, PR par @mrubens)
    - Correction: Ajout de userAgent au client Bedrock pour le suivi de version (#8660 par @ajjuaire, PR par @app/roomote)
    - Fonctionnalité: Z AI utilise maintenant seulement deux points de terminaison de codage pour de meilleures performances (#8687 par @hannesrudolph)
    - Fonctionnalité: Mise à jour de la sélection du modèle de génération d'images pour une qualité améliorée (merci @chrarnoldus!)

- [#3194](https://github.com/Kilo-Org/kilocode/pull/3194) [`b566965`](https://github.com/Kilo-Org/kilocode/commit/b5696581e82652086564503f7743e9e82585823) Merci à [@markijbema](https://github.com/markijbema)! - Ne pas déclencher l'autocomplétion pour les événements externes, comme les changements git

- [#3100](https://github.com/Kilo-Org/kilocode/pull/3100) [`3e409b8`](https://github.com/Kilo-Org/kilocode/commit/3e409b84310f481d1c3be4095d887f5cf6d15282) Merci à [@markijbema](https://github.com/markijbema)! - Ajout d'Amazon Bedrock en tant que fournisseur pour l'autocomplétion

- [#3149](https://github.com/Kilo-Org/kilocode/pull/3149) [`79c7d60`](https://github.com/Kilo-Org/kilocode/commit/79c7d60a10a765da8195fde80e6a89630993b918) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Mise à jour du framework (Le plugin nécessite maintenant IntelliJ IDEA 2024.3 ou plus)

- [#3195](https://github.com/Kilo-Org/kilocode/pull/3195) [`93371d0`](https://github.com/Kilo-Org/kilocode/commit/93371d08f1c1b88eeb9f567af9ae74188fe7e379) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction d'un crash lors de l'utilisation de l'outil navigateur avec l'appel natif d'outils activé

## [v4.108.0]

- [#2674](https://github.com/Kilo-Org/kilocode/pull/2674) [`2836aed`](https://github.com/Kilo-Org/kilocode/commit/2836aeddbbd6884f2c6f2421ca79387c25f5cd94) Merci à [@mcowger](https://github.com/mcowger)! - ajout du paramètre d'envoi de message sur entrée avec un comportement configurable

- [#3090](https://github.com/Kilo-Org/kilocode/pull/3090) [`261889f`](https://github.com/Kilo-Org/kilocode/commit/261889f1d4fa853aea0ddb261856b6d4c63e1159) Merci à [@mcowger](https://github.com/mcowger)! - Autoriser l'utilisation de l'appel de fonction natif pour les fournisseurs OpenAI-compatible, LM Studio, Chutes, DeepInfra, xAI et Z.ai.

### Changements de correctif

- [#3155](https://github.com/Kilo-Org/kilocode/pull/3155) [`6242b03`](https://github.com/Kilo-Org/kilocode/commit/6242b03e9fb58eff8da9f637fa448b35aeaae3a3) Merci à [@NikoDi2000](https://github.com/NikoDi2000)! - Amélioration de la traduction chinoise de "run" de '命令' à '运行'

- [#3120](https://github.com/Kilo-Org/kilocode/pull/3120) [`ced4857`](https://github.com/Kilo-Org/kilocode/commit/ced48571894311e3350b9603071e5e2becc9473f) Merci à [@mcowger](https://github.com/mcowger)! - L'outil apply_diff a été implémenté pour l'appel expérimental d'outils en style JSON

## [v4.107.0]

### Changements de correctif

- [#3082](https://github.com/Kilo-Org/kilocode/pull/3082) [`d82e684`](https://github.com/Kilo-Org/kilocode/commit/d82e6842d423861d7c5725ebfdba491438b3302a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le paramètre "Activer l'outil navigateur" est maintenant respecté lors de l'utilisation d'appels expérimentaux d'outils en style JSON.

- [#3059](https://github.com/Kilo-Org/kilocode/pull/3059) [`d71f1d6`](https://github.com/Kilo-Org/kilocode/commit/d71f1d67e372fab1186ec07eda97c6d950338ec2) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction d'un bug empêchant l'agent de modifier correctement les fichiers quand les vues de diff git sont ouvertes

- [#3105](https://github.com/Kilo-Org/kilocode/pull/3105) [`b0c7475`](https://github.com/Kilo-Org/kilocode/commit/b0c7475a5f086171dbff162cbfa4761937617f27) Merci à [@metju90](https://github.com/metju90)! - Correction du style des boutons sur le CTA "Let's Go"

- [#3107](https://github.com/Kilo-Org/kilocode/pull/3107) [`c58c4ac`](https://github.com/Kilo-Org/kilocode/commit/c58c4ac9bed8af1a9c18250e759ee4b93873f86b) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.28.16-v3.28.17

    - Correction: Mise à jour de la traduction du titre de la commande run en zh-TW (merci @PeterDaveHello!)
    - fonctionnalité: Ajout du support de Claude Sonnet 4.5 1M fenêtre de contexte pour Claude Code (merci @ColbySerpa!)

## [v4.106.0]

- [#2833](https://github.com/Kilo-Org/kilocode/pull/2833) [`0b8ef46`](https://github.com/Kilo-Org/kilocode/commit/0b8ef4632cab8cbf1da7a90a2f9b228861b41be8) Merci à [@mcowger](https://github.com/mcowger)! - (aussi merci à @NaccOll pour avoir ouvert la voie) - Support préliminaire pour l'appel natif d'outils (appelé fonctionnement natif d'outils) a été ajouté.

    Cette fonctionnalité est actuellement expérimentale et destinée principalement aux utilisateurs intéressés par son développement.
    Elle n'est pour l'instant prise en charge que lors de l'utilisation d'OpenRouter ou de fournisseurs Kilo Code. Il peut y avoir des problèmes possibles, y compris, mais sans s'y limiter:

    - Outils manquants (ex: outil apply_diff)
    - Les appels d'outils ne mettant pas à jour l'interface utilisateur jusqu'à ce qu'ils soient terminés
    - Les outils sont utilisés même s'ils sont désactivés (ex: outil navigateur)
    - Les serveurs MCP ne fonctionnent pas
    - Erreurs spécifiques à certains fournisseurs d'inférence

    L'appel natif d'outils peut être activé dans Paramètres Fournisseurs > Paramètres Avancés > Style d'appel d'outils > JSON.
    Il est activé par défaut pour Claude Haiku 4.5, car ce modèle ne fonctionne pas du tout autrement.

- [#3050](https://github.com/Kilo-Org/kilocode/pull/3050) [`357d438`](https://github.com/Kilo-Org/kilocode/commit/357d4385c0a5e609a408c5842047c0e6593b8153) Merci à [@markijbema](https://github.com/markijbema)! - CMD-I invoque maintenant l'agent pour que vous puissiez lui donner des invites plus complexes

## [v4.105.0]

- [#3005](https://github.com/Kilo-Org/kilocode/pull/305) [`b87ae9c`](https://github.com/Kilo-Org/kilocode/commit/b87ae9ca29ca632ec0d324dae469a75c8005e876) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Amélioration de la zone d'édition du chat pour permettre le glisser-déposer de contexte et de fichiers lors de l'édition de messages. Alignement avec la fonctionnalité d'édition en amont

### Changements de correctif

- [#2983](https://github.com/Kilo-Org/kilocode/pull/2983) [`93e8243`](https://github.com/Kilo-Org/kilocode/commit/93e8243686488ecf61476f854cd19eb67706f7cb) Merci à [@jrf0110](https://github.com/jrf0110)! - Ajout du suivi d'utilisation de projet pour les clients Teams et Enterprise. Les membres de l'organisation peuvent visualiser et filtrer l'utilisation par projet. L'identifiant de projet est automatiquement déduit de `.git/config`. Il peut être écrasé en écrivant un fichier `.kilocode/config.json` avec le contenu suivant:

    ```json
    {
    	"project": {
    		"id": "my-project-id"
    	}
    }
    ```

- [#3057](https://github.com/Kilo-Org/kilocode/pull/3057) [`69f5a18`](https://github.com/Kilo-Org/kilocode/commit/69f5a182cf42361e659e94c95969e3bd3641176f) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci à Roo, support de Claude Haiku 4.5 ajouté aux fournisseurs Anthropic, Bedrock et Vertex

- [#3046](https://github.com/Kilo-Org/kilocode/pull/3046) [`1bd934f`](https://github.com/Kilo-Org/kilocode/commit/1bd934f784034ec29d10ae7b42d67f768e0883b1) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Un avertissement est maintenant affiché quand l'utilisation de la mémoire de la vue web dépasse 90% de la limite (zone d'écran grise)

- [#2885](https://github.com/Kilo-Org/kilocode/pull/2885) [`a34dab0`](https://github.com/Kilo-Org/kilocode/commit/a34dab09d2cbcc9732698f21e824b6773b30fa2b) Merci à [@shameez-struggles-to-commit](https://github.com/shameez-struggles-to-commit)! - Mise à jour des métadonnées du fournisseur d'API de modèle de langage VS Code pour refléter les limites actuelles du modèle:

    - Alignement des fenêtres de contexte, des limites de prompt/entrée et des jetons de sortie max avec les dernières données du fournisseur pour les modèles correspondants: gpt-3.5-turbo, gpt-4o-mini, gpt-4, gpt-4-0125-preview, gpt-4o, o3-mini, claude-3.5-sonnet, claude-sonnet-4, gemini-2.0-flash-001, gemini-2.5-pro, o4-mini-2025-04-16, gpt-4.1, gpt-5-mini, gpt-5.
    - Correction d'un problème où un contexte par défaut de 128k était supposé pour tous les modèles.
    - Remarquable: la famille GPT-5 utilise maintenant un contexte de 264k; o3-mini/o4-mini, Gemini, Claude et les familles 4o ont des indicateurs de sortie et de support d'images mis à jour. La sortie maximale de GPT-5-mini est explicitement fixée à 127 805.

    Cela garantit que Kilo Code applique correctement les budgets de jetons de modèle avec l'intégration VS Code LM.

## [v4.104.0]

- [#2673](https://github.com/Kilo-Org/kilocode/pull/2673) [`cf1aca2`](https://github.com/Kilo-Org/kilocode/commit/cf1aca2fb6c0f16414d42737a4ebf90357f5a796) Merci à [@mcowger](https://github.com/mcowger)! - Mise à jour du fournisseur Gemini pour supporter la récupération dynamique de modèles.

- [#2749](https://github.com/Kilo-Org/kilocode/pull/2749) [`7e493ec`](https://github.com/Kilo-Org/kilocode/commit/7e493ec35c01687b78cb2fb54b3f92c6b42662aa) Merci à [@mcowger](https://github.com/mcowger)! - Amélioration de la capacité du parseur compatible OpenAI à produire du contenu de raisonnement

## [v4.103.1]

- [#2962](https://github.com/Kilo-Org/kilocode/pull/2962) [`a424824`](https://github.com/Kilo-Org/kilocode/commit/a424824269b3cafdf58bcdb1acf7ed6151f32e0b) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration du message d'erreur quand une valeur d'effort de raisonnement non supportée est choisie

- [#2960](https://github.com/Kilo-Org/kilocode/pull/2960) [`254e21b`](https://github.com/Kilo-Org/kilocode/commit/254e21b29df46dab3048ecd792625eadc20beafb) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le paramètre d'effort de raisonnement n'est plus ignoré pour GLM 4.6 lors de l'utilisation des fournisseurs Kilo Code ou OpenRouter. Certains fournisseurs d'inférence sur OpenRouter ont des difficultés quand le raisonnement est activé, mais cela est maintenant moins problématique, car plus de fournisseurs sont en ligne. La plupart des fournisseurs n'exposent pas les jetons de raisonnement pour GLM 4.6, quelle que soit l'effort de raisonnement.

## [v4.103.0]

- [#2528](https://github.com/Kilo-Org/kilocode/pull/2528) [`14d5060`](https://github.com/Kilo-Org/kilocode/commit/14d506025a9374f54409768629fc4ebd57f8f628) Merci à [@mcowger](https://github.com/mcowger)! - Ajout d'horodatages à la vue Chat.

### Changements de correctif

- [#2861](https://github.com/Kilo-Org/kilocode/pull/2861) [`279d7cf`](https://github.com/Kilo-Org/kilocode/commit/279d7cff9d19ec908681318fbe929b45fbf94393) Merci à [@jrf0110](https://github.com/jrf0110)! - Sélection des modes d'organisation. Cette fonctionnalité permet aux organisations de créer
  de nouveaux modes et de les envoyer à l'extension KiloCode. Elle permet également de
  remplacer les modes intégrés de Kilo Code. Les modes d'organisation sont en lecture seule
  depuis l'extension et doivent être modifiés depuis le tableau de bord.

- [#2858](https://github.com/Kilo-Org/kilocode/pull/2858) [`15472b`](https://github.com/Kilo-Org/kilocode/commit/154722be5a73143231e95ccbc2679b8a4eaaa5ab) Merci à [@hassoncs](https://github.com/hassoncs)! - Rendre tous les liens textuels du même style visuel

## [v4.102.0]

- [#2854](https://github.com/Kilo-Org/kilocode/pull/2854) [`bd5d7fc`](https://github.com/Kilo-Org/kilocode/commit/bd5d7fc5f0c67ac2b040dbdefbd90d0396e0b60e) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.28.14-v3.28.15

    - Correction: réinitialisation correcte du suivi de limite de coût quand l'utilisateur clique sur "Réinitialiser et Continuer" (#6889 par @alecoot, PR par app/roomote)
    - Correction: amélioration de l'activation du bouton de sauvegarde dans les paramètres des invites (#5780 par @beccare, PR par app/roomote)
    - Correction: dialogue 'il y a des modifications non sauvegardées' trop zélé dans les paramètres (merci @brunobergher!)
    - Correction: améliorations de compatibilité Claude Sonnet 4.5 (merci @mrubens!)
    - Suppression du modèle gratuit Gemini 2.5 Flash Image Preview non supporté (merci @SannidhyaSah!)

- [#1652](https://github.com/Kilo-Org/kilocode/pull/1652) [`b3caf38`](https://github.com/Kilo-Org/kilocode/commit/b3caf38e44f2f6ccd58f3e92cd68edce48a96844) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajout d'un paramètre d'affichage qui masque les coûts en dessous d'un seuil défini par l'utilisateur

### Changements de correctif

- [#2871](https://github.com/Kilo-Org/kilocode/pull/2871) [`0403f82`](https://github.com/Kilo-Org/kilocode/commit/0403f820a8413656eecbe3bbfe252a52c2999e37) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration des messages d'erreur Fast Apply

- [#2851](https://github.com/Kilo-Org/kilocode/pull/2851) [`9e6a897`](https://github.com/Kilo-Org/kilocode/commit/9e6a89796f04f6215e31ac7950669783387a11de) Merci à [@eliasto](https://github.com/eliasto)! - Ajout du support d'URL de base personnalisée au fournisseur OVHcloud

- [#2870](https://github.com/Kilo-Org/kilocode/pull/2870) [`4730e08`](https://github.com/Kilo-Org/kilocode/commit/4730e080f9bcd414a3eb0a71a04ab5fd6dbcb6e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Un point de contrôle est maintenant créé avant _chaque_ appel d'outil

## [v4.101.0]

- [#2518](https://github.com/Kilo-Org/kilocode/pull/2518) [`01106a8`](https://github.com/Kilo-Org/kilocode/commit/01106a8d35159ccea34e290a2174d44d83fecd64) Merci à [@eliasto](https://github.com/eliasto)! - Fournisseur OVHcloud AI Endpoints ajouté

### Changements de correctif

- [#2852](https://github.com/Kilo-Org/kilocode/pull/2852) [`a707e1d`](https://github.com/Kilo-Org/kilocode/commit/a707e1db5b4f8ee3ca80f259217f521a02ddbd50) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - L'autocomplétion respecte maintenant .kilocodeignore

- [#2829](https://github.com/Kilo-Org/kilocode/pull/2829) [`75acbab`](https://github.com/Kilo-Org/kilocode/commit/75acbabd1f0d39488bc252e8559e39a4b8daed19) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction potentielle de l'icône Kilo Code manquante en supprimant la condition 'when' de la configuration de la barre d'activité de l'extension

- [#2831](https://github.com/Kilo-Org/kilocode/pull/2831) [`9d457f0`](https://github.com/Kilo-Org/kilocode/commit/9d457f0bc3eef1c1f07eb80070e0ecf6935b38a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Lors de l'utilisation de Kilo Code ou OpenRouter, le fournisseur d'inférence utilisé est maintenant affiché dans une infobulle sur "Requête API"

## [v4.100.0]

- [#2787](https://github.com/Kilo-Org/kilocode/pull/2787) [`9c16d14`](https://github.com/Kilo-Org/kilocode/commit/9c16d14c4b8455041b16e5ffa0787014d5154d19) Merci à [@b3nw](https://github.com/b3nw)! - La liste des modèles Chutes est maintenant chargée dynamiquement

- [#2806](https://github.com/Kilo-Org/kilocode/pull/2806) [`5d1cda9`](https://github.com/Kilo-Org/kilocode/commit/5d1cda99a5c3872dae526db9b3c8cefbabe69de0) Merci à [@EamonNerbonne](https://github.com/EamonNerbonne)! - Suppression de l'option d'utilisation d'un fournisseur personnalisé pour l'autocomplétion.

    L'utilisation d'un fournisseur personnalisé revient par défaut à utiliser le fournisseur globalement configuré sans aucune limite de fenêtre de contexte, et utiliser un fournisseur personnalisé sans autres restrictions comme cela signifie que les coûts par requête d'autocomplétion sont parfois extrêmement élevés et les réponses très lentes.

- [#2790](https://github.com/Kilo-Org/kilocode/pull/2790) [`d0f6fa0`](https://github.com/Kilo-Org/kilocode/commit/d0f6fa0531e5abfb39f2e99c7a637ead54bfe8be) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - La politique de non conservation des données peut maintenant être activée pour Kilo Code et OpenRouter sous les paramètres de routage du fournisseur.

- [#2567](https://github.com/Kilo-Org/kilocode/pull/2567) [`68ea97f`](https://github.com/Kilo-Org/kilocode/commit/68ea97fc02861e932cf0357d60d73a3204ed19ef) Merci à [@billycao](https://github.com/billycao)! - Ajout du support du fournisseur Synthetic (https://synthetic.new)

- [#2807](https://github.com/Kilo-Org/kilocode/pull/2807) [`375470`](https://github.com/Kilo-Org/kilocode/commit/337547095ff64fbdd1294a22b19c7dd6b41e37bb) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le bouton "Voir toutes les modifications" quand une tâche se termine est maintenant accompagné d'un bouton "Rétablir toutes les modifications" pour pouvoir facilement rétablir toutes les modifications.

### Changements de correctif

- [#2798](https://github.com/Kilo-Org/kilocode/pull/2798) [`bb3baca`](https://github.com/Kilo-Org/kilocode/commit/bb3baca433ce77419abd8d3f4814278a05f8c631) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le délai d'attente de la requête API pour Ollama et LM Studio est maintenant configurable (Panneau Extensions VS Code -> menu engrenage Kilo Code -> Paramètres -> Délai d'attente de la requête API)

## [v4.99.2]

- [#2729](https://github.com/Kilo-Org/kilocode/pull/2729) [`bda1ef4`](https://github.com/Kilo-Org/kilocode/commit/bda1ef4a6ece7532db4e07359cfae640b1080d3c) Merci à [@ivanarifin](https://github.com/ivanarifin)! - Mise à jour des variables d'environnement de la CLI Gemini quand le chemin d'autorisation OAuth change

- [#2755](https://github.com/Kilo-Org/kilocode/pull/2755) [`82ffeb4`](https://github.com/Kilo-Org/kilocode/commit/82ffeb4bcfbf1ff6b4cc50413e7dbc57fd82c7cd) Merci à [@b3nw](https://github.com/b3nw)! - Ajout du modèle zai-org/GLM-4.6-turbo au fournisseur Chutes

## [v4.99.1]

- [#2731](https://github.com/Kilo-Org/kilocode/pull/2731) [`36cf88f`](https://github.com/Kilo-Org/kilocode/commit/36cf88f868eee2a322b35b37032f98d19e0f91a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une recommandation pour désactiver l'édition par diffs ou Fast Apply est maintenant incluse dans le message d'erreur quand un modèle échoue à les utiliser correctement

- [#2751](https://github.com/Kilo-Org/kilocode/pull/2751) [`6ebf0bb`](https://github.com/Kilo-Org/kilocode/commit/6ebf0bbe38be7d737546f8975cff927d95e85751) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de certains textes non traduits affichés dans les paramètres Ollama

## [v4.99.0]

- [#2719](https://github.com/Kilo-Org/kilocode/pull/2719) [`345947f`](https://github.com/Kilo-Org/kilocode/commit/345947f29978045209a82687843c28059b339dc0) Merci à [@mcowger](https://github.com/mcowger)! - Prévention des conditions de course empêchant la progression de l'agent pendant l'indexation.

- [#2716](https://github.com/Kilo-Org/kilocode/pull/2716) [`41a6dbf`](https://github.com/Kilo-Org/kilocode/commit/41a6dbf1a54a699e358a24ecd167f692f3a2aef5) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.28.8-v3.28.13

    - Correction: Suppression du paramètre topP de la configuration d'inférence Bedrock (#8377 par @ronyblum, PR par @daniel-lxs)
    - Correction: Correction de la configuration du modèle Sonnet 4.5 Vertex AI (#8387 par @nickcatal, PR par @mrubens!)
    - Correction: Correction de l'ID du modèle Anthropic Sonnet 4.5 et ajout de la case à cocher contexte 1M Bedrock (merci @daniel-lxs!)
    - Correction: Correction de l'identifiant du modèle Claude Sonnet 4.5 Bedrock AWS (#8371 par @sunhyung, PR par @app/roomote)
    - Correction: Correction du format de l'ID du modèle Claude Sonnet 4.5 (merci @daniel-lxs!)
    - Correction: Rendre les icônes du chat correctement dimensionnées avec la classe shrink-0 (merci @mrubens!)
    - Le modèle gratuit Supernova dispose maintenant d'une fenêtre de contexte de 1M jetons (merci @mrubens!)
    - Correction: Suppression des balises <thinking> des invites pour une sortie plus propre et moins de jetons (#8318 par @hannesrudolph, PR par @app/roomote)
    - Correction de l'utilisation d'outils pour améliorer l'adhésion du modèle à la suggestion (merci @hannesrudolph!)
    - Suppression de l'indice utilisateur lors de l'actualisation des modèles (merci @requesty-JohnCosta27!)
    - Correction: Résolution des erreurs fréquentes "Aucun outil utilisé" en clarifiant les règles d'utilisation des outils (merci @hannesrudolph!)
    - Correction: Inclusion de la demande initiale dans la synthèse condensée (merci @hannesrudolph!)

- [#2701](https://github.com/Kilo-Org/kilocode/pull/2701) [`0593631`](https://github.com/Kilo-Org/kilocode/commit/05936316c0bedfb62a0c1851dd4abfe1882fe3a4) Merci à [@mcowger](https://github.com/mcowger)! - Ajout de modèles supplémentaires supportés à la fonctionnalité expérimentale Fast Apply pour un total de trois : Morph V3 Fast, Morph V3 Large et Relace Apply 3

### Changements de correctif

- [#2656](https://github.com/Kilo-Org/kilocode/pull/2656) [`4e1b4ed`](https://github.com/Kilo-Org/kilocode/commit/4e1b4edb06ba3894ba86abd63853c167f1b4eb0) Merci à [@SnHaku](https://github.com/SnHaku)! - Correction de l'intégration PowerShell de JetBrains

- [#2725](https://github.com/Kilo-Org/kilocode/pull/2725) [`2ae6a7c`](https://github.com/Kilo-Org/kilocode/commit/2ae6a7c3a9531ad6418cc3858aa43f96fc849072) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de GLM 4.6 qui se bloquait toujours en boucles avec les fournisseurs Kilo Code et OpenRouter

- [#2659](https://github.com/Kilo-Org/kilocode/pull/2659) [`318edd6`](https://github.com/Kilo-Org/kilocode/commit/318edd639b38f65dfdab0695f481322ea90ce2cc) Merci à [@akhil41](https://github.com/akhil41)! - Mise à jour de la liste des modèles du fournisseur Chutes AI

## [v4.98.2]

- [#2704](https://github.com/Kilo-Org/kilocode/pull/2704) [`6b6af0a`](https://github.com/Kilo-Org/kilocode/commit/6b6af0a213cd106f08b1538172d5ba5d19a80ff) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de la duplication de l'affichage des coûts

- [#2705](https://github.com/Kilo-Org/kilocode/pull/2705) [`e65557d`](https://github.com/Kilo-Org/kilocode/commit/e65557dcfb880f70c6d18a6f511454c234b70ee4) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout de "Command Timeout Allowlist" et "Prevent Completion with Open Todos" aux paramètres d'extension.

- [#2707](https://github.com/Kilo-Org/kilocode/pull/2707) [`55ff2dc`](https://github.com/Kilo-Org/kilocode/commit/55ff2dcf6bccfcc9d70ba631ba57c99269ebe716) Merci à [@Ed4ward](https://github.com/Ed4ward)! - Ajout du support GLM 4.6 au fournisseur Z.AI

## [v4.98.1]

- [#2695](https://github.com/Kilo-Org/kilocode/pull/2695) [`ab49c14`](https://github.com/Kilo-Org/kilocode/commit/ab49c141ca397a0af985341a1cfe907d586430ef) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout de Claude 4.5 Sonnet à tous les fournisseurs supportés (merci Roo Code)

## [v4.98.0]

- [#2623](https://github.com/Kilo-Org/kilocode/pull/2623) [`da834dd`](https://github.com/Kilo-Org/kilocode/commit/da834ddcd24ee334ec97c1a5ca398b87d624adc0) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.28.2-v3.28.7

    - UX: Réduction des blocs de réflexion par défaut avec des paramètres d'interface pour toujours les afficher (merci @brunobergher!)
    - Correction: Résolution du positionnement du popover de restauration de point de contrôle (#8219 par @NaccOll, PR par @app/roomote)
    - Ajout du support du modèle zai-org/GLM-4.5-turbo dans le fournisseur Chutes (#8155 par @mugnimaestra, PR par @app/roomote)
    - Correction: Amélioration du formatage des blocs de raisonnement pour une meilleure lisibilité (merci @daniel-lxs!)
    - Correction: Respect de la configuration num_ctx du fichier de modèle Ollama (#7797 par @hannesrudolph, PR par @app/roomote)
    - Correction: Empêcher le texte de point de contrôle de s'enrouler dans les langues non anglaises (#8206 par @NaccOll, PR par @app/roomote)
    - Correction: Corrections d'évaluation en bare metal (merci @cte!)
    - Correction: Les questions de suivi devraient déclencher l'état "interactif" (merci @cte!)
    - Correction: Résolution de la réhydratation en double pendant le raisonnement; centralisation de la réhydratation et conservation des métadonnées d'annulation (#8153 par @hannesrudolph, PR par @hannesrudolph)
    - Correction: Support du préfixe tiret dans parseMarkdownChecklist pour les listes de tâches (#8054 par @NaccOll, PR par @app/roomote)
    - Correction: Application de tarification par palier pour les modèles Gemini via Vertex AI (#8017 par @ikumi3, PR par @app/roomote)
    - Mise à jour des modèles SambaNova vers les dernières versions (merci @snova-jorgep!)
    - UX: Interface de message redessinée (merci @brunobergher!)
    - UX: Approbation automatique réactive (merci @brunobergher!)
    - Ajout de la file d'attente de réessai de télémétrie pour la résilience réseau (merci @daniel-lxs!)
    - Correction: Filtrage des outils intégrés de Claude Code (ExitPlanMode, BashOutput, KillBash) (#7817 par @juliettefournier-econ, PR par @roomote)
    - Correction: Correction de la requête tree-sitter C# (#5238 par @vadash, PR par @mubeen-zulfiqar)
    - Ajout d'un raccourci clavier pour l'action "Ajouter au contexte" (#7907 par @hannesrudolph, PR par @roomote)
    - Correction: Le menu contextuel est masqué lors de l'édition du message (#7759 par @mini2s, PR par @NaccOll)
    - Correction: Gestion des erreurs de conversion ByteString dans les embeddeurs OpenAI (#7959 par @PavelA85, PR par @daniel-lxs)
    - Rappel d'une façon de temporairement et globalement suspendre l'approbation automatique sans perdre votre état de bascule (merci @brunobergher!)

- [#2221](https://github.com/Kilo-Org/kilocode/pull/221) [`bcb4c69`](https://github.com/Kilo-Org/kilocode/commit/bcb4c69f92c833e3c6cfc10d64b80077613386f1) Merci à [@Ffinnis](https://github.com/Ffinnis)! - Ajout de la possibilité d'annuler le processus d'indexation du code

### Changements de correctif

- [#2665](https://github.com/Kilo-Org/kilocode/pull/2665) [`7b100d5`](https://github.com/Kilo-Org/kilocode/commit/7b100d5473e28aeafa832bcc3bbca3699c5ad9b1) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le bouton "Voir les nouvelles modifications" est maintenant masqué quand les points de contrôle sont désactivés.

## [v4.97.2]

- [#265](https://github.com/Kilo-Org/kilocode/pull/2655) [`3f83727`](https://github.com/Kilo-Org/kilocode/commit/3f8372708344171f4b379b90ad04693e1f67be39) Merci à [@PierreAncey](https://github.com/PierreAncey)! - Ajout du modèle Grok 4 Fast au fournisseur xAI

- [#2648](https://github.com/Kilo-Org/kilocode/pull/2648) [`6f3f9fb`](https://github.com/Kilo-Org/kilocode/commit/6f3f9fba397ad34430c98a6db7ef535fe3262e8) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Correction du comportement de journalisation des erreurs dans le plugin JetBrains en mettant à jour les niveaux de journalisation du pont console

- [#2617](https://github.com/Kilo-Org/kilocode/pull/2617) [`a94bf01`](https://github.com/Kilo-Org/kilocode/commit/a94bf01f7df542ffd372bbb0d385b39941187b0d) Merci à [@RSO](https://github.com/RSO)! - JetBrains: Correction du terminal n'ayant pas le chemin complet

## [v4.97.1]

- [#2625](https://github.com/Kilo-Org/kilocode/pull/2625) [`3409665`](https://github.com/Kilo-Org/kilocode/commit/340966544bda3a069f9cf2478658bf58f5e2cf3c) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout d'une correction pour la CLI Gemini ne pouvant plus rafraîchir le jeton d'accès

- [#2536](https://github.com/Kilo-Org/kilocode/pull/2536) [`1a0114`](https://github.com/Kilo-Org/kilocode/commit/1a011145572333d053b8999c3f38bf718bbedf66) Merci à [@mcowger](https://github.com/mcowger)! - Validation des embeddeurs uniquement quand ils correspondent au fournisseur actuellement configuré

- [#2491](https://github.com/Kilo-Org/kilocode/pull/2491) [`06afc76`](https://github.com/Kilo-Org/kilocode/commit/06afc769d29740083027a1caa6195edcfbbb94e2) Merci à [@Thireus](https://github.com/Thireus)! - Augmentation du délai d'attente OpenAI Compatible

## [v4.97.0]

- [#2505](https://github.com/Kilo-Org/kilocode/pull/2505) [`a59e7f5`](https://github.com/Kilo-Org/kilocode/commit/a59e7f565478c7405e62c59448bf7667e4b26c8f) Merci à [@markijbema](https://github.com/markijbema)! - Ajout d'une option dans l'onglet Affichage des paramètres pour désactiver l'animation de la marge d'autocomplétion

- [#2602](https://github.com/Kilo-Org/kilocode/pull/2602) [`0807e5f`](https://github.com/Kilo-Org/kilocode/commit/0807e5ffdfcef1f90e6469a964d47ec177cca706) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout de GPT-5-Codex au fournisseur OpenAI (merci Roo / @daniel-lxs)

### Changements de correctif

- [#2583](https://github.com/Kilo-Org/kilocode/pull/2583) [`0c13d2d`](https://github.com/Kilo-Org/kilocode/commit/0c13d2db8391f194150001a2fc1e247573a95db2) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le limiteur de débit ne génère plus de délais d'attente plus longs que la limite configurée.

- [#2596](https://github.com/Kilo-Org/kilocode/pull/2596) [`38f4547`](https://github.com/Kilo-Org/kilocode/commit/38f45478d4183f375e8a717a3564d3ac91fd6daa) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le raisonnement peut maintenant être désactivé pour les modèles DeepSeek V3.1 lors de l'utilisation des fournisseurs Kilo Code ou OpenRouter en définissant l'effort de raisonnement à minimal

- [#2586](https://github.com/Kilo-Org/kilocode/pull/2586) [`0b4025d`](https://github.com/Kilo-Org/kilocode/commit/0b4025df4c4d86a0aba20d19d5b32f2eaa214c6) Merci à [@b3nw](https://github.com/b3nw)! - Nouveaux modèles Chutes AI ajoutés et tarification mise à jour

- [#2603](https://github.com/Kilo-Org/kilocode/pull/2603) [`b5325a8`](https://github.com/Kilo-Org/kilocode/commit/b5325a82abe94e195b580ac27cd0a8bf7f8577a7) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le raisonnement peut maintenant être désactivé pour Grok 4 Fast sur OpenRouter en définissant l'effort de raisonnement à minimal. Notez que Grok 4 Fast n'expose pas ses jetons de raisonnement.

- [#2570](https://github.com/Kilo-Org/kilocode/pull/2570) [`18963de`](https://github.com/Kilo-Org/kilocode/commit/18963de4dce86be883c03ceeb418e820bd2c0635) Merci à [@snova-jorgep](https://github.com/snova-jorgep)! - Mise à jour des modèles SambaNova disponibles

## [v4.96.2]

- [#2521](https://github.com/Kilo-Org/kilocode/pull/2521) [`9304511`](https://github.com/Kilo-Org/kilocode/commit/9304511cb00114886f026744c3492f6a6a839f2) Merci à [@mcowger](https://github.com/mcowger)! - Mise à jour du message d'erreur de boucle pour référencer le modèle au lieu de Kilo Code comme cause.

- [#2532](https://github.com/Kilo-Org/kilocode/pull/2532) [`8103ad4`](https://github.com/Kilo-Org/kilocode/commit/8103ad4b59135888861b06c2cff7fc35ba965607) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - La description de l'outil read_file a été modifiée pour le rendre plus susceptible d'être utilisé par un modèle capable de vision pour la lecture d'images.

- [#2558](https://github.com/Kilo-Org/kilocode/pull/258) [`3044c43`](https://github.com/Kilo-Org/kilocode/commit/3044c43479b7d64599af536d3df90251b850ea24) Merci à [@ivanarifin](https://github.com/ivanarifin)! - Correction de la résolution du chemin d'environnement pour le chemin OAuth personnalisé de la CLI gemini

## [v4.96.1]

- [#2452](https://github.com/Kilo-Org/kilocode/pull/2452) [`d4cfbe9`](https://github.com/Kilo-Org/kilocode/commit/d4cfbe98a7ca4e2ce389fe221875f6158688ff69) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Correction du rechargement de l'extension lors du changement de projet

## [v4.96.0]

- [#2504](https://github.com/Kilo-Org/kilocode/pull/2504) [`4927414`](https://github.com/Kilo-Org/kilocode/commit/4927414d0737312796a0c5ae9b0e5a9d7629fbbc) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Inclure les modifications de Roo Code v3.28.0-v3.28.2:

    - Amélioration de l'interface d'approbation automatique avec un design plus petit et plus subtil (merci @brunobergher!)
    - Correction: Boucle de refilement de la file d'attente de messages dans Task.ask() causant des problèmes de performance (#7861 par @hannesrudolph, PR par @daniel-lxs)
    - Correction: Restreindre l'analyse des mentions @ au début de ligne ou aux limites d'espace blanc pour éviter les déclenchements erronés (#7875 par @hannesrudolph, PR par @app/roomote)
    - Correction: Rendre l'avertissement de dépôt git imbriqué persistant avec des informations de chemin pour une meilleure visibilité (#7884 par @hannesrudolph, PR par @app/roomote)
    - Correction: Inclure la clé API dans les requêtes /api/tags d'Ollama pour les instances authentifiées (#7902 par @ItsOnlyBinary, PR par @app/roomote)
    - Correction: Préserver le contexte du premier message pendant la condensation de conversation (merci @daniel-lxs!)
    - Faire de Posthog la télémétrie par défaut (merci @mrubens!)
    - Vider le cache dans l'aperçu d'image généré (merci @mrubens!)
    - Correction: Centrer le mode actif dans le sélecteur déroulant à l'ouverture (#7882 par @hannesrudolph, PR par @app/roomote)
    - Correction: Préserver le premier message pendant la condensation de conversation (merci @daniel-lxs!)
    - fonctionnalité: Ajouter la modification par clic, ESC pour annuler, et corriger la cohérence du rembourrage pour les messages de chat (#7788 par @hannesrudolph, PR par @app/roomote)
    - fonctionnalité: Rendre le raisonnement plus visible (merci @app/roomote!)
    - correction: Correction de l'affichage de la fenêtre de contexte Groq (merci @mrubens!)
    - correction: Ajouter la variable d'environnement GIT_EDITOR au mode de fusion pour une résolution non interactive (merci @daniel-lxs!)
    - correction: Résoudre les problèmes de duplication édition/suppression de message de chat (merci @daniel-lxs!)
    - correction: Réduire la valeur z-index des boutons de bloc de code pour éviter le chevauchement avec les popovers (#7703 par @A0nameless0man, PR par @daniel-lxs)
    - correction: Réversion PR #7188 - Restauration du paramètre de température pour corriger les plantages TabbyApi/ExLlamaV2 (#7581 par @drknyt, PR par @daniel-lxs)
    - correction: Faire fonctionner les informations du modèle ollama comme lmstudio (#7674 par @ItsOnlyBinary, PR par @ItsOnlyBinary)
    - correction: Mise à jour des tarifs DeepSeek pour les nouveaux taux unifiés effectifs le 5 sept 2025 (#7685 par @NaccOll, PR par @app/roomote)
    - fonctionnalité: Mise à jour des modèles et régions Vertex AI (#7725 par @ssweens, PR par @ssweens)

### Changements de correctif

- [#2484](https://github.com/Kilo-Org/kilocode/pull/2484) [`f57fa9c`](https://github.com/Kilo-Org/kilocode/commit/f57fa9c58baca627a84003f0da133286212dba92) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction de l'affichage de la barre d'état d'autocomplétion quand l'autocomplétion n'est pas activée

- [#2260](https://github.com/Kilo-Org/kilocode/pull/2260) [`9d4b078`](https://github.com/Kilo-Org/kilocode/commit/9d4b078c867c5b160af7a3f4629adfb016f9c2d9) Merci à [@anhhct](https://github.com/anhhct)! - Le paramètre follow_up de l'outil ask_followup_question est maintenant optionnel

- [#2458](https://github.com/Kilo-Org/kilocode/pull/2458) [`6a79d3b`](https://github.com/Kilo-Org/kilocode/commit/6a79d3b640f8c7e3f24e54bcf17ce63127fbce57) Merci à [@NaccOll](https://github.com/NaccOll)! - Correction du surlignage au mauvais endroit lors de la référence de contexte

## [v4.95.0]

- [#2437](https://github.com/Kilo-Org/kilocode/pull/2437) [`5591bcb`](https://github.com/Kilo-Org/kilocode/commit/5591bcbb68d2e8e5af49baf45b8614982ab71e2f) Merci à [@hassoncs](https://github.com/hassoncs)! - Vous pouvez maintenant démarrer automatiquement une tâche dans un profil/mode donné en créant un `.kilocode/launchConfig.json` avant de démarrer VS Code.

    Voir la documentation pour plus d'informations!

- [#2394](https://github.com/Kilo-Org/kilocode/pull/2394) [`94ce7ca`](https://github.com/Kilo-Org/kilocode/commit/94ce7ca174c4569d8e31fe11d075f04631fc42f4) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - L'onglet Historique des tâches est maintenant paginé. Cela devrait aider à réduire la consommation de mémoire.

- [#2417](https://github.com/Kilo-Org/kilocode/pull/2417) [`0d4a18f`](https://github.com/Kilo-Org/kilocode/commit/0d4a18fd0ff5a1948405405644ff30b9cbfa3e43) Merci à [@hassoncs](https://github.com/hassoncs)! - Les suggestions d'autocomplétion prennent maintenant en charge la coloration syntaxique du code

### Changements de correctif

- [#2421](https://github.com/Kilo-Org/kilocode/pull/2421) [`825f7df`](https://github.com/Kilo-Org/kilocode/commit/825f7df5da5a6bbdbfe26739cd5adfc2836fb7a1) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration du support proxy dans les cas où auparavant les listes de modèles Kilo Code et OpenRouter resteraient vides

## [v4.94.0]

- [#2361](https://github.com/Kilo-Org/kilocode/pull/2361) [`9b553d3`](https://github.com/Kilo-Org/kilocode/commit/9b553d32940736fec49dde8de75faba1e0890471) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Amélioration du thème clair

- [#2407](https://github.com/Kilo-Org/kilocode/pull/2407) [`acf662`](https://github.com/Kilo-Org/kilocode/commit/aacf662030e25c64fbc8800bcf514832949f74ec) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Réajout de la barre de menu de bloc de code pour une copie facile et un basculement de la coloration syntaxique

### Changements de correctif

- [#2423](https://github.com/Kilo-Org/kilocode/pull/2423) [`ed12b48`](https://github.com/Kilo-Org/kilocode/commit/ed12b4897bc65df822fa994c13bf325c12055842) Merci à [@mcowger](https://github.com/mcowger)! - Amélioration du comportement du fournisseur de quota virtuel de secours quand il n'y a pas de limites configurées.

- [#2412](https://github.com/Kilo-Org/kilocode/pull/2412) [`e7fc4b4`](https://github.com/Kilo-Org/kilocode/commit/e7fc4b473b105ce8a6d92df17f1893f724c158a1) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Changement du mode par défaut au premier démarrage de architecte à code et ajustement du menu du sélecteur de mode pour afficher tous les modes par défaut

- [#2402](https://github.com/Kilo-Org/kilocode/pull/2402) [`cb4445`](https://github.com/Kilo-Org/kilocode/commit/cb4445574a43179968656ade28bfce666973f9d) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le fournisseur Z.ai prend maintenant en charge leur plan de codage (abonnement)

- [#2408](https://github.com/Kilo-Org/kilocode/pull/2408) [`53b387c`](https://github.com/Kilo-Org/kilocode/commit/53b387ce388dbd0c51547934c308d305128f9e5a) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout du support pour Qwen3-Next-80B-A3B-Instruct et Qwen3-Next-80B-A3B-Thinking au fournisseur Chutes

## [v4.93.2]

- [#2401](https://github.com/Kilo-Org/kilocode/pull/2401) [`4c0c434`](https://github.com/Kilo-Org/kilocode/commit/4c0c434fce4bd8ce9c31a396c98e21b62cb300c1) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - La génération de message de commit et l'amélioration de l'invite prennent maintenant en charge la facturation via Kilo pour les équipes

## [v4.93.1]

- [#2388](https://github.com/Kilo-Org/kilocode/pull/2388) [`484ced4`](https://github.com/Kilo-Org/kilocode/commit/484ced4df8f6bc24091268d1850c8eba752e7cc8) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les paramètres de routage du fournisseur Kilo Code sont maintenant masqués quand ils sont gérés par une organisation

## [v4.93.0]

- [#2353](https://github.com/Kilo-Org/kilocode/pull/2353) [`75f8f7b`](https://github.com/Kilo-Org/kilocode/commit/75f8f7b21671ddfba4bdfb441fe3e8fd215530d1) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.27.0

    Ajouté de Roo Code v3.26.5-v3.27.0:

    - Ajout: support du modèle Kimi K2-0905 dans le fournisseur Chutes (#7700 par @pwilkin, PR par @app/roomote)
    - Correction: prévention du débordement de pile dans l'indexation de codebase pour les grands projets (#7588 par @StarTrai1, PR par @daniel-lxs)
    - Correction: résolution d'une condition de course dans les sources d'ancrage Gemini en améliorant la conception du code (#6372 par @daniel-lxs, PR par @HahaBill)
    - Correction: préservation du contexte de conversation en réessayant avec la conversation complète en cas d'invalidation previous_response_id (merci @daniel-lxs!)
    - Correction: identification du chemin de configuration MCP et slash command dans les espaces de travail à plusieurs dossiers (#6720 par @kfuglsang, PR par @NaccOll)
    - Correction: gestion correcte des profils de terminal VSCode avec des tableaux de chemins (#7695 par @Amosvcc, PR par @app/roomote)
    - Correction: amélioration du style et de la lisibilité de WelcomeView (merci @daniel-lxs!)
    - Correction: résolution des erreurs ETIMEDOUT de test e2e CI lors du téléchargement de VS Code (merci @daniel-lxs!)
    - Fonctionnalité: Ajout des services de réponses OpenAI avec sélecteur UI et tarification (merci @hannesrudolph!)
    - Fonctionnalité: Ajout de DeepInfra en tant que fournisseur de modèle dans Roo Code (#7661 par @Thachnh, PR par @Thachnh)
    - Fonctionnalité: Mise à jour des modèles kimi-k2-0905-preview et kimi-k2-turbo-preview sur le fournisseur Moonshot (merci @CellenLee!)
    - Fonctionnalité: Ajout de kimi-k2-0905-preview à Groq, Moonshot et Fireworks (merci @daniel-lxs et Cline!)
    - Correction: prévention de l'affichage du minuteur de compte à rebours dans l'historique pour les questions de suivi répondues (#7624 par @XuyiK, PR par @daniel-lxs)
    - Correction: limitation du nombre maximum de jetons de retour de Moonshot à 1024 résolue (#6936 par @greyishsong, PR par @wangxiaolong100)
    - Correction: ajout d'une transformation d'erreur aux erreurs SDK OpenAI cryptiques quand la clé API est invalide (#7483 par @A0nameless0man, PR par @app/roomote)
    - Correction: validation de l'existence de l'outil MCP avant exécution (#7631 par @R-omk, PR par @app/roomote)
    - Correction: gestion correcte des qualificateurs de glob zsh (merci @mrubens!)
    - Correction: gestion correcte de la substitution de processus zsh (merci @mrubens!)
    - Correction: correction mineure de typo dans la locale chinoise traditionnelle zh-TW (merci @PeterDaveHello!)
    - Correction: utilisation de l'encapsulation askApproval dans les outils insert_content et search_and_replace (#7648 par @hannesrudolph, PR par @app/roomote)
    - Ajout de la configuration du modèle Kimi K2 Turbo à moonshotModels (merci @wangxiaolong100!)
    - Correction: préservation de la position de défilement lors du changement d'onglets dans les paramètres (merci @DC-Dancao!)
    - fonctionnalité: Ajout du support du modèle Qwen3 235B A22B Thinking 2507 dans chutes (merci @mohamad154!)
    - fonctionnalité: Ajout du support d'approbation automatique pour l'outil access_resource MCP (#7565 par @m-ibm, PR par @daniel-lxs)
    - fonctionnalité: Ajout d'une taille de lot d'embedding configurable pour l'indexation de code (#7356 par @BenLampson, PR par @app/roomote)
    - correction: Ajout du support de rapport de cache pour le fournisseur OpenAI-Natif (merci @hannesrudolph!)
    - fonctionnalité: Déplacement de la file d'attente de messages vers l'hôte d'extension pour de meilleures performances (merci @cte!)

### Changements de correctif

- [#2375](https://github.com/Kilo-Org/kilocode/pull/2375) [`5b634bc`](https://github.com/Kilo-Org/kilocode/commit/5b634bc5933eca19abc8f9bb4e011d0dae486b76) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Suppression de la limite arbitraire de 8192 sorties pour les modèles Anthropic

- [#2368](https://github.com/Kilo-Org/kilocode/pull/2368) [`5f4071b`](https://github.com/Kilo-Org/kilocode/commit/5f4071b64d9cbd7a8b37b806a678e0f70457ebee) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction des fenêtres de contexte trop petites lors de l'utilisation d'Ollama Turbo

## [v4.92.1]

- [#2364](https://github.com/Kilo-Org/kilocode/pull/2364) [`7573854`](https://github.com/Kilo-Org/kilocode/commit/75738541270db6702aac649730472c92e8084444) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Suppression de certains modèles inexistants du sélecteur de modèle

## [v4.92.0]

- [#2299](https://github.com/Kilo-Org/kilocode/pull/2299) [`1ab5cc7`](https://github.com/Kilo-Org/kilocode/commit/1ab5cc7d0f9d7748137791043508253af70704a9) Merci à [@catrielmuller](https://github.com/catrielmuller)! - MacOS - Support du notificateur système terminal

### Changements de correctif

- [#2352](https://github.com/Kilo-Org/kilocode/pull/2352) [`e343439`](https://github.com/Kilo-Org/kilocode/commit/e34343916be94d0f4374753e0c130b911cfbf20e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Meilleurs messages d'erreur sont affichés quand le modèle actuellement utilisé disparaît (ceci sera pertinent prochainement pour Sonoma)

## [v4.91.2]

- [#2342](https://github.com/Kilo-Org/kilocode/pull/2342) [`6641568`](https://github.com/Kilo-Org/kilocode/commit/6641568fedba0b5f0a76ce9c5d88182b58b327a5) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Correction de la détection de l'éditeur JetBrains

## [v4.91.1]

- [#2310](https://github.com/Kilo-Org/kilocode/pull/2310) [`29c7af6`](https://github.com/Kilo-Org/kilocode/commit/29c7af60d8c5c285b28ce2f9bd1bfeff1d59dc40) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci @Qiiks! - Suppression des paramètres de fournisseur Qwen Code en double

- [#2322](https://github.com/Kilo-Org/kilocode/pull/2322) [`669713e`](https://github.com/Kilo-Org/kilocode/commit/669713e6a66ce6599664e15450bf2c917861df51) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de la taille maximale de sortie de Claude Opus 4.1, qui était accidentellement fixée à 8192 au lieu de 32k

- [#2332](https://github.com/Kilo-Org/kilocode/pull/2332) [`e3eea75`](https://github.com/Kilo-Org/kilocode/commit/e3eea758975c2ef3da34dec167ea37327ab5928) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction d'une erreur HTTP 500 avec les fournisseurs compatibles OpenAI quand aucune température personnalisée n'est définie

## [v4.91.0]

- [#2289](https://github.com/Kilo-Org/kilocode/pull/2289) [`13c45e5`](https://github.com/Kilo-Org/kilocode/commit/13c45e59adc7d4f337dacb8eda5e35127639c241) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout du support de Kimi K2 0905 à Chutes, Fireworks, Groq et Moonshot

- [#2294](https://github.com/Kilo-Org/kilocode/pull/2294) [`980a253`](https://github.com/Kilo-Org/kilocode/commit/980a253ccc906c7a40ef65ab4a7513097b99648b) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Support MultiDiff / Voir les nouvelles modifications

### Changements de correctif

- [#2281](https://github.com/Kilo-Org/kilocode/pull/2281) [`71334fc`](https://github.com/Kilo-Org/kilocode/commit/71334fcb9556fc8ada02b707bef9dd09aedf3864) Merci à [@hassoncs](https://github.com/hassoncs)! - Effacement des images quand on change vers un modèle qui ne les supporte pas

- [#2280](https://github.com/Kilo-Org/kilocode/pull/2280) [`0713b0d`](https://github.com/Kilo-Org/kilocode/commit/0713b0dbfe047ac7f68727d6dd77b780c9006c6b) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du changement d'organisation ne se sauvegardant pas correctement

- [#2287](https://github.com/Kilo-Org/kilocode/pull/2287) [`b5a8550`](https://github.com/Kilo-Org/kilocode/commit/b5a8550a106fcafa31d332f5b76febc34ffc43ec) Merci à [@Qiiks](https://github.com/Qiiks)! - Correction de l'intégration CLI Gemini pour gérer les structures de réponse imbriquées

## [v4.90.0]

- [#2275](https://github.com/Kilo-Org/kilocode/pull/2275) [`4ae9acc`](https://github.com/Kilo-Org/kilocode/commit/4ae9acc00a9033194433356e8b936a0dcc06e77) Merci à [@jeske](https://github.com/jeske)! - correction d'une course asynchrone intermittente qui jette les entrées utilisateur-chat pendant l'approbation/rejet structuré

- [#2129](https://github.com/Kilo-Org/kilocode/pull/2129) [`984b5c4`](https://github.com/Kilo-Org/kilocode/commit/984b5c4151945fc483ca1fd08e07c12f61a372da) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Extension Jetbrains Bêta

### Changements de correctif

- [#2274](https://github.com/Kilo-Org/kilocode/pull/2274) [`24d0c9f`](https://github.com/Kilo-Org/kilocode/commit/24d0c9f679e33c899f74c06440a80e4ea50b07ed) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le fournisseur API (Kilo Code ou OpenRouter) pour la génération d'images est maintenant un choix explicite

## [v4.89.0]

- [#2242](https://github.com/Kilo-Org/kilocode/pull/2242) [`f474c89`](https://github.com/Kilo-Org/kilocode/commit/f474c89e3881955d2f41b8912b728e91eddb87f8) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.26.4

    - Optimisation de l'utilisation de la mémoire pour la gestion des images dans la vue web (merci @daniel-lxs!)
    - Correction: Les jetons spéciaux ne devraient pas interrompre le traitement des tâches utilisateur (#7539 par @pwilkin, PR par @pwilkin)
    - Ajout du support de clé API Ollama pour le mode Turbo (#7147 par @LivioGama, PR par @app/roomote)
    - Ajout d'un paramètre optionnel d'image d'entrée à l'outil de génération d'images (merci @roomote!)
    - Refactorisation: Aplatir la structure des paramètres de génération d'images (merci @daniel-lxs!)
    - Affichage de la journalisation de la console dans les vitests quand le drapeau --no-silent est défini (merci @hassoncs!)
    - fonctionnalité: Ajout de l'outil expérimental de génération d'images avec intégration OpenRouter (merci @daniel-lxs!)
    - Correction: Résolution des problèmes GPT-5 Responses API avec la condensation et le support des images (#7334 par @nlbuescher, PR par @daniel-lxs)
    - Correction: Masquer les fichiers .kilocodeignore des détails d'environnement par défaut (#7368 par @AlexBlack772, PR par @app/roomote)
    - Correction: Exclure les actions de défilement du navigateur de la détection de répétition (#7470 par @cgrierson-smartsheet, PR par @app/roomote)
    - Ajout de l'intégration du fournisseur Vercel AI Gateway (merci @joshualipman123!)
    - Ajout du support des embeddings Vercel (merci @mrubens!)
    - Activation du stockage sur disque pour les vecteurs Qdrant et l'index HNSW (merci @daniel-lxs!)
    - Mise à jour du composant d'infobulle pour correspondre au style d'ombre des infobulles natives VSCode (merci @roomote!)
    - Correction: suppression de l'affichage en double du cache dans l'en-tête de tâche (merci @mrubens!)
    - Nettoyage aléatoire de la zone de texte du chat (merci @cte!)
    - fonctionnalité: Ajout de Deepseek v3.1 au fournisseur Fireworks AI (#7374 par @dmarkey, PR par @app/roomote)
    - Correction: Faire en sorte que la bascule d'approbation automatique reste (#3909 par @kyle-apex, PR par @elianiva)
    - Correction: Préserver l'entrée utilisateur lors de la sélection des choix de suivi (#7316 par @teihome, PR par @daniel-lxs)
    - Correction: Gérer le contenu de réflexion Mistral comme des blocs de raisonnement (#6842 par @Biotrioo, PR par @app/roomote)
    - Correction: Résolution du paramètre newTaskRequireTodos ne fonctionnant pas correctement (merci @hannesrudolph!)
    - Correction: Problème de liste de modèles (#7377 par @dtrugman, PR par @dtrugman)
    - fonctionnalité: Masquer les fournisseurs statiques sans modèles de la liste des fournisseurs (merci @daniel-lxs!)
    - Ajout du paramètre todos à l'utilisation de l'outil new_task dans le mode issue-fixer (merci @hannesrudolph!)
    - Gestion des modèles de substitution dans la validation de commande (merci @mrubens!)
    - Marquage des fichiers code-workspace comme protégés (merci @mrubens!)
    - Mise à jour de la liste des commandes autorisées par défaut (merci @mrubens!)
    - Suivi des liens symboliques dans les vérifications rooignore (merci @mrubens!)
    - Affichage des prix de lecture et d'écriture du cache pour les fournisseurs d'inférence OpenRouter (merci @chrarnoldus!)

## [v4.88.0]

- [#2235](https://github.com/Kilo-Org/kilocode/pull/2235) [`fbf4e42`](https://github.com/Kilo-Org/kilocode/commit/fbf4e42125cef538387301be784ede7d2609fe16) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Renommage d'Assistance en ligne en Autocomplétion Kilo Code

- [#2202](https://github.com/Kilo-Org/kilocode/pull/2202) [`92ef190`](https://github.com/Kilo-Org/kilocode/commit/92ef190d8d9e5ec0df3cbdd8488c98f4190f57b2) Merci à [@hassoncs](https://github.com/hassoncs)! - Affichage d'un avertissement lors d'une tentative de collage d'image quand le modèle actuel ne supporte pas les images

### Changements de correctif

- [#2244](https://github.com/Kilo-Org/kilocode/pull/2244) [`6a83c5a`](https://github.com/Kilo-Org/kilocode/commit/6a83c5acdd8153a2d8c89aff9644883061c7efe6) Merci à [@hassoncs](https://github.com/hassoncs)! - Empêcher l'écriture dans des fichiers en dehors de l'espace de travail par défaut

    Cela devrait atténuer les attaques de compromission de la chaîne d'approvisionnement par injection de prompt. Merci à Evan Harris du MCP Security Research pour avoir trouvé cela!

- [#2245](https://github.com/Kilo-Org/kilocode/pull/2245) [`fff884f`](https://github.com/Kilo-Org/kilocode/commit/fff884fd6f2f1be4906e3d4494adeed3017e8d57) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du manque de couleur de fond de l'en-tête du Marketplace Kilo Code

- [#2237](https://github.com/Kilo-Org/kilocode/pull/2237) [`06c6e8b`](https://github.com/Kilo-Org/kilocode/commit/06c6e8b013b54fc7706a9862af9ddabc86fb8781) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code affiche maintenant un message d'erreur quand un modèle atteint sa sortie maximale

- [#2238](https://github.com/Kilo-Org/kilocode/pull/2238) [`b5de938`](https://github.com/Kilo-Org/kilocode/commit/b5de93836338c0398dfa6dede89dbb92f525ceef) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de l'erreur 50 avec Chutes quand aucune température personnalisée n'est spécifiée.

- [#2248](https://github.com/Kilo-Org/kilocode/pull/2248) [`b8c6f27`](https://github.com/Kilo-Org/kilocode/commit/b8c6f2780757f16e1599b989bb88d235c26233c4) Merci à [@hassoncs](https://github.com/hassoncs)! - Suppression de l'expérience Assistance en ligne, l'activant par défaut

    Les commandes et raccourcis clavier individuels peuvent toujours être activés/désactivés dans les paramètres.

## [v4.87.0]

- [#2010](https://github.com/Kilo-Org/kilocode/pull/2010) [`a7b89d3`](https://github.com/Kilo-Org/kilocode/commit/a7b89d3cf173e6f5d1915aece598489d63652b5f) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Il y a maintenant un bouton "Voir les nouvelles modifications" sous le message "Tâche terminée". Utilisez ce bouton pour voir toutes les modifications de fichiers faites depuis le message "Tâche terminée" précédent. Cette fonctionnalité nécessite que les points de contrôle soient activés.

### Changements de correctif

- [#2215](https://github.com/Kilo-Org/kilocode/pull/2215) [`4b102aa`](https://github.com/Kilo-Org/kilocode/commit/4b102aaeb42e776e224d71d5fc55033ff0388442) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le paramètre de collecte de fournisseur de données dans les paramètres des fournisseurs Kilo Code et OpenRouter est maintenant activé même quand un fournisseur d'inférence spécifique est sélectionné.

- [#228](https://github.com/Kilo-Org/kilocode/pull/228) [`5bd17b9`](https://github.com/Kilo-Org/kilocode/commit/5bd17b9ff2b44282200992befad618729e2c1e8e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Des messages d'avertissement pour les cas courants où les points de contrôle ne fonctionnent pas ont été ajoutés

- [#2174](https://github.com/Kilo-Org/kilocode/pull/2174) [`a1d0972`](https://github.com/Kilo-Org/kilocode/commit/a1d097294a2fd64bd86a6260169d450fb36966f0) Merci à [@TimAidley](https://github.com/TimAidley)! - Ajout du support GPT-5 au fournisseur LiteLLM

- [#2216](https://github.com/Kilo-Org/kilocode/pull/2216) [`479821f`](https://github.com/Kilo-Org/kilocode/commit/479821f84d64d91412996a24d4ed9314f7373839) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - La variable d'environnement OLLAMA_CONTEXT_LENGTH est maintenant prioritaire sur le paramètre num_ctx du modèle.

- [#2191](https://github.com/Kilo-Org/kilocode/pull/2191) [`6fcde72`](https://github.com/Kilo-Org/kilocode/commit/6fcde72c3470d5634a8091dc92191a50f07bab40) Merci à [@hassoncs](https://github.com/hassoncs)! - Désactivation explicite de la version web de l'extension car elle n'est pas compatible (vscode.dev)

## [v4.86.0]

- [#2012](https://github.com/Kilo-Org/kilocode/pull/2012) [`1fd698a`](https://github.com/Kilo-Org/kilocode/commit/1fd698ad2025946519a0ce2d516ec528ea92eea4) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Amélioration de la compatibilité et des performances de l'Assistance en ligne

- [#2199](https://github.com/Kilo-Org/kilocode/pull/2199) [`a19f72c`](https://github.com/Kilo-Org/kilocode/commit/a19f72c05f2bed48106b33c6eaa9f4e9e6d4d020) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci @Thachnh! - Ajout du fournisseur DeepInfra avec récupération dynamique de modèles et mise en cache de prompts

### Changements de correctif

- [#2170](https://github.com/Kilo-Org/kilocode/pull/2170) [`58987e3`](https://github.com/Kilo-Org/kilocode/commit/58987e36377724b639d4b19a2d92162b34bc5eaa) Merci à [@mcowger](https://github.com/mcowger)! - Suppression de l'écrasement forcé de la limite de contexte pour l'API Ollama

## [v4.85.0]

- [#2119](https://github.com/Kilo-Org/kilocode/pull/2119) [`19dc45d`](https://github.com/Kilo-Org/kilocode/commit/19dc45d1b1578a41c41ecb787e7945513f6554d9) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.25.23

    - fonctionnalité: ajout du support d'URL de base personnalisée pour le fournisseur Requesty (merci @requesty-JohnCosta27!)
    - fonctionnalité: ajout du modèle DeepSeek V3.1 au fournisseur Chutes AI (#7294 par @dmarkey, PR par @app/roomote)
    - Ajout du support de mise en cache de prompts pour Kimi K2 sur Groq (merci @daniel-lxs et @benank!)
    - Ajout de liens de documentation pour les instructions globales personnalisées dans l'interface (merci @app/roomote!)
    - Assurer que les résultats des sous-tâches sont fournis à GPT-5 dans OpenAI Responses API
    - Promotion du parseur AssistantMessageParser expérimental au parseur par défaut
    - Mise à jour de la fenêtre de contexte des modèles DeepSeek à 128k (merci @JuanPerezReal)
    - Activation des fonctionnalités d'ancrage pour Vertex AI (merci @anguslees)
    - Autoriser l'orchestrateur à transmettre des listes de tâches aux sous-tâches
    - Améliorations de la gestion MDM
    - Gestion des valeurs de jeton nulles dans ContextCondenseRow pour éviter le crash de l'interface (merci @s97712)
    - Amélioration de la gestion des erreurs de fenêtre de contexte pour OpenAI et autres fournisseurs
    - Ajout d'un filtre "installé" au Marketplace (merci @semidark)
    - Amélioration des vérifications d'accès au système de fichiers (merci @elianiva)
    - Ajout du fournisseur Featherless (merci @DarinVerheijke)

### Changements de correctif

- [#2184](https://github.com/Kilo-Org/kilocode/pull/2184) [`0be6743`](https://github.com/Kilo-Org/kilocode/commit/0be6743e08540d1671c10f79b49f17eeac82397e) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Correction: réajout du bouton favori aux tâches

- [#2125](https://github.com/Kilo-Org/kilocode/pull/2125) [`5828254`](https://github.com/Kilo-Org/kilocode/commit/58254d47e9073c0f0fc9c9db5ef38eb6358036) Merci à [@nitinprajwal](https://github.com/nitinprajwal)! - Ajout du support à Qwen Code pour un chemin de stockage d'identifiants OAuth personnalisé

## [v4.84.1]

- [#2113](https://github.com/Kilo-Org/kilocode/pull/2113) [`d40b35a`](https://github.com/Kilo-Org/kilocode/commit/d40b35a3a1efcc2fbfca51d4ca64a8da2aa321e5) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le sélecteur de modèle sous le chat affiche maintenant la bonne liste de modèles pour Qwen Code et certains autres fournisseurs

- [#2116](https://github.com/Kilo-Org/kilocode/pull/2116) [`61e18d6`](https://github.com/Kilo-Org/kilocode/commit/61e18d60f54d11d63a64cd674474a68fa398c3b9) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les points de contrôle fonctionnent maintenant quand on utilise Morph fast apply

- [#2130](https://github.com/Kilo-Org/kilocode/pull/2130) [`78aaf7c`](https://github.com/Kilo-Org/kilocode/commit/78aaf7c4607c5a98174a26b99973e379b87e5893) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout du support de Grok Code Fast au fournisseur xAI

- [#2109](https://github.com/Kilo-Org/kilocode/pull/2109) [`173ecf4`](https://github.com/Kilo-Org/kilocode/commit/173ecf4983449a4b7766ba900f736a57b7d5d525) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Un "0" solitaire qui était parfois affiché sur la page des paramètres du fournisseur API Kilo Code a été supprimé.

## [v4.84.0]

- [#1961](https://github.com/Kilo-Org/kilocode/pull/1961) [`d4a7cb6`](https://github.com/Kilo-Org/kilocode/commit/d4a7cb6300d8e00d5889e1079057e43de19ff95e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Mises à jour du support expérimental Morph FastApply

    - Une indication visuelle est maintenant incluse dans la vue tâche chaque fois que Morph est utilisé.
    - Les outils d'édition de fichiers traditionnels sont maintenant désactivés pour s'assurer que Morph est utilisé pour modifier les fichiers.
    - Morph est maintenant automatiquement désactivé quand le fournisseur API ne le supporte pas et qu'aucune clé API Morph n'est configurée.
    - La clé API Morph n'est plus perdue quand on change de profil de fournisseur.

- [#1886](https://github.com/Kilo-Org/kilocode/pull/1886) [`0221aaa`](https://github.com/Kilo-Org/kilocode/commit/0221aaa4febea9dfeea8cfbb26fa355204e75d1b) Merci à [@mcowger](https://github.com/mcowger)! - Ajout d'appels d'outils MCP réductibles avec gestion de la mémoire

### Changements de correctif

- [#2095](https://github.com/Kilo-Org/kilocode/pull/2095) [`8623bb8`](https://github.com/Kilo-Org/kilocode/commit/8623bb8516a7453d299512bd11c5000f43ecb952) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le fournisseur Kilo Code revient maintenant au modèle par défaut quand le modèle sélectionné n'existe plus

- [#2090](https://github.com/Kilo-Org/kilocode/pull/2090) [`fd147b8`](https://github.com/Kilo-Org/kilocode/commit/fd147b8ed35c8963ec66c5fae89f37829529574f) Merci à [@Mats4k](https://github.com/Mats4k)! - Améliorations de la traduction en langue allemande

- [#2030](https://github.com/Kilo-Org/kilocode/pull/2030) [`11e8c7d`](https://github.com/Kilo-Org/kilocode/commit/11e8c7dda9f03b769e22f233b5ea487c9a12bd66) Merci à [@ivanarifin](https://github.com/ivanarifin)! - Affichage d'un message quand le fournisseur de quota virtuel de secours change de profil

- [#2100](https://github.com/Kilo-Org/kilocode/pull/2100) [`5ed3d7b`](https://github.com/Kilo-Org/kilocode/commit/5ed3d7be3273fef7ff0eeede8db064fc9bdb4fe0) Merci à [@RSO](https://github.com/RSO)! - Changement du domaine API pour le fournisseur Kilo Code

- [#1964](https://github.com/Kilo-Org/kilocode/pull/1964) [`6b0dfbf`](https://github.com/Kilo-Org/kilocode/commit/6b0dfbf10a397063f02e0dd6964d1fb1b73cf12) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les paramètres du fournisseur API Kilo Code affichent maintenant également le coût moyen par requête en plus du coût moyen par million de jetons pour un modèle particulier.

## [v4.83.1]

- [#2073](https://github.com/Kilo-Org/kilocode/pull/2073) [`a4b870`](https://github.com/Kilo-Org/kilocode/commit/a4b8770ba82cbb366bb986a36026b6860129f799) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Assuré que l'utilisation des modèles gratuits est signalée comme gratuite

- [#206](https://github.com/Kilo-Org/kilocode/pull/2066) [`62624d2`](https://github.com/Kilo-Org/kilocode/commit/62624d21f4f3408a552b5f0308d35be154d403b3) Merci à [@mcowger](https://github.com/mcowger)! - Correction de l'erreur "'messages' field is required" dans LMStudio

- [#2064](https://github.com/Kilo-Org/kilocode/pull/2064) [`8655a71`](https://github.com/Kilo-Org/kilocode/commit/8655a712d7fc84fce1a7aa8c928fa2b32a68cf24) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration du message d'erreur "language model did not provide any assistant messages" pour indiquer qu'il implique probablement une limitation de débit

## [v4.83.0]

- [#2063](https://github.com/Kilo-Org/kilocode/pull/2063) [`e844c5f`](https://github.com/Kilo-Org/kilocode/commit/e84c5f3a43c0808a037156e44f621b36a529abd) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout d'un marketplace pour les modes

- [#2050](https://github.com/Kilo-Org/kilocode/pull/2050) [`0ffe951`](https://github.com/Kilo-Org/kilocode/commit/0ffe951af4d356984608df623c410327cee7f130) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.25.20

    - Correction: respecter le paramètre enableReasoningEffort lors de la détermination de l'utilisation du raisonnement (#7048 par @ikbencasdoei, PR par @app/roomote)
    - Correction: empêcher la duplication des modèles LM Studio avec une déduplication insensible à la casse (#6954 par @fbuechler, PR par @daniel-lxs)
    - Fonctionnalité: simplification de la documentation de l'invite ask_followup_question (merci @daniel-lxs!)
    - Fonctionnalité: outil de lecture de fichier simple pour les modèles à fichier unique (merci @daniel-lxs!)
    - Correction: Ajout de zaiApiKey et doubaoApiKey manquants à SECRET_STATE_KEYS (#7082 par @app/roomote)
    - Fonctionnalité: Ajout de nouveaux modèles et mise à jour des configurations pour vscode-lm (merci @NaccOll!)
    - Correction: Résolution des problèmes de logique de réutilisation de terminal
    - Ajout du support du modèle OpenAI gpt-5-chat-latest (#7057 par @PeterDaveHello, PR par @app/roomote)
    - Correction: Utilisation de l'API Ollama native au lieu de la couche de compatibilité OpenAI (#7070 par @LivioGama, PR par @daniel-lxs)
    - Correction: Empêcher le décodage d'entités XML dans les outils de diff (#7107 par @indiesewell, PR par @app/roomote)
    - Correction: Ajout d'une vérification de type avant d'appeler .match() sur diffItem.content (#6905 par @pwilkin, PR par @app/roomote)
    - Refactorisation du système d'exécution de tâches: amélioration de la gestion de la pile d'appels (merci @catrielmuller!)
    - Correction: Activation du bouton de sauvegarde pour les changements de fournisseur et cases à cocher (merci @daniel-lxs!)
    - Ajout d'une API pour reprendre les tâches par ID (merci @mrubens!)
    - Émission d'événement quand une demande de tâche requiert une interaction (merci @cte!)
    - Rendre l'amélioration avec l'historique des tâches par défaut à vrai (merci @liwilliam2021!)
    - Correction: Utilisation de cline.cwd comme source principale pour le chemin de l'espace de travail dans codebaseSearchTool (merci @NaccOll!)
    - Correction de point de contrôle d'espace de travail à plusieurs dossiers (merci @NaccOll!)
    - Correction: Suppression de la limite de 500 messages pour éviter le saut de la barre de défilement dans les longues conversations (#7052, #7063 par @daniel-lxs, PR par @app/roomote)
    - Correction: Réinitialisation de l'état de condensation quand changement de tâche (#6919 par @f14XuanLv, PR par @f14XuanLv)
    - Correction: Implémentation de la génération de sitemap en TypeScript et suppression du fichier XML (#5231 par @abumalick, PR par @abumalick)
    - Correction: Les valeurs allowedMaxRequests et allowedMaxCost ne s'affichent pas dans l'interface des paramètres (merci @chrarnoldus!)

## [v4.82.3]

- [#2047](https://github.com/Kilo-Org/kilocode/pull/2047) [`077b774`](https://github.com/Kilo-Org/kilocode/commit/077b774deaf1a65d7864db0c1248cfa9574b93b9) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction d'un problème qui causait l'affichage multiple de la même erreur

## [v4.82.2]

- [#1811](https://github.com/Kilo-Org/kilocode/pull/1811) [`5f7afe6`](https://github.com/Kilo-Org/kilocode/commit/5f7afe6ffeb1078428b0b43c6d9a4e9252e78bc8) Merci à [@gerardbalaoro](https://github.com/gerardbalaoro)! - Ajustement de la position dans les menus contextuels pour être en dessous des éléments par défaut

- [#2033](https://github.com/Kilo-Org/kilocode/pull/2033) [`8aef7ef`](https://github.com/Kilo-Org/kilocode/commit/8aef7efc9597613010339a667f87328cf70c9ce1) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci @daniel-lxs! - Ajout d'un outil de lecture de fichier unique qui fonctionne mieux avec Sonic que l'outil de lecture multi-fichier par défaut.

## [v4.82.1]

- [#2021](https://github.com/Kilo-Org/kilocode/pull/2021) [`02adf7c`](https://github.com/Kilo-Org/kilocode/commit/02adf7c4780170125e0f54beaeb5a3cbbd972669) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les fournisseurs d'inférence OpenRouter dont la fenêtre de contexte est plus petite que celle du fournisseur principal pour un modèle particulier sont maintenant automatiquement ignorés par défaut. Ils peuvent toujours être utilisés en les sélectionnant spécifiquement dans les paramètres de routage du fournisseur.

- [#2015](https://github.com/Kilo-Org/kilocode/pull/2015) [`e5c7641`](https://github.com/Kilo-Org/kilocode/commit/e5c76411cc3ff6f5aae53e5d1e3975d6830e03e) Merci à [@mcowger](https://github.com/mcowger)! - Ajout du support de clé API au fournisseur Ollama, permettant l'utilisation d'Ollama Turbo

- [#2029](https://github.com/Kilo-Org/kilocode/pull/2029) [`64c6955`](https://github.com/Kilo-Org/kilocode/commit/64c695517dd8a5556c418d88c8338ea090ea09a9) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Ajout de recherche dans la liste des fournisseurs et tri alphabétique

## [v4.82.0]

- [#1974](https://github.com/Kilo-Org/kilocode/pull/1974) [`ec18e51`](https://github.com/Kilo-Org/kilocode/commit/ec18e51d7f38c2f5ee21a02cf2290be2123119b) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code 3.25.14

    - Correction: Inclure uniquement le paramètre de verbosité pour les modèles qui le supportent (#7054 par @eastonmeth, PR par @app/roomote)
    - Correction: AWS Bedrock 1M contexte - Déplacement de anthropic_beta vers additionalModelRequestFields (merci @daniel-lxs!)
    - Correction: Rendre l'annulation des requêtes plus réactive en annulant les modifications récentes
    - Ajout de la case à cocher Sonnet 1M contexte à Bedrock
    - Correction: ajout du drapeau --no-messages à ripgrep pour supprimer les erreurs d'accès aux fichiers (#6756 par @R-omk, PR par @app/roomote)
    - Ajout du support de AGENT.md en plus de AGENTS.md (#6912 par @Brendan-Z, PR par @app/roomote)
    - Suppression du modèle déprécié GPT-4.5 Preview (merci @PeterDaveHello!)
    - Mise à jour: Claude Sonnet 4 fenêtre de contexte configurable à 1 million de jetons dans le fournisseur Anthropic (merci @daniel-lxs!)
    - Ajout: Support minimal de raisonnement à OpenRouter (merci @daniel-lxs!)
    - Correction: Ajout d'un délai configurable pour les requêtes API locales (#6521 par @dabockster, PR par @app/roomote)
    - Correction: Ajout du drapeau --no-sandbox aux options de lancement du navigateur (#6632 par @QuinsZouls, PR par @QuinsZouls)
    - Correction: Assurer que les fichiers JSON respectent .kilocodeignore pendant l'indexation (#6690 par @evermoving, PR par @app/roomote)
    - Ajout: Nouveaux modèles du fournisseur Chutes (#6698 par @fstandhartinger, PR par @app/roomote)
    - Ajout: Modèles OpenAI gpt-oss au dropdown Amazon Bedrock (#6752 par @josh-clanton-powerschool, PR par @app/roomote)
    - Correction: Correction du détecteur de répétition d'outils pour ne pas bloquer le premier appel d'outil quand la limite est 1 (#6834 par @NaccOll, PR par @app/roomote)
    - Correction: Amélioration de l'initialisation du service de point de contrôle (merci @NaccOll!)
    - Mise à jour: Amélioration de la locale chinoise traditionnelle zh-TW (merci @PeterDaveHello!)
    - Ajout: Traductions d'expansion et de réduction des tâches (merci @app/roomote!)
    - Mise à jour: Exclure les modèles GPT-5 de la limite de fenêtre de contexte de 20% pour les jetons de sortie (merci @app/roomote!)
    - Correction: Tronquer les noms de modèles longs dans le sélecteur de modèle pour éviter le débordement (merci @app/roomote!)
    - Ajout: Support de l'URL de base Requesty (merci @requesty-JohnCosta27!)
    - Ajout: Modèle Codex Mini du fournisseur OpenAI natif (#5386 par @KJ7LNW, PR par @daniel-lxs)
    - Ajout: Support du fournisseur IO Intelligence (merci @ertan2002!)
    - Correction: Problèmes de démarrage MCP et suppression des notifications de rafraîchissement (merci @hannesrudolph!)
    - Correction: Améliorations de la configuration du fournisseur GPT-5 OpenAI (merci @hannesrudolph!)
    - Correction: Clarification du paramètre de chemin codebase_search comme optionnel et amélioration descriptions d'outils (merci @app/roomote!)
    - Correction: Contournement du fournisseur Bedrock pour les problèmes de passage LiteLLM (merci @jr!)
    - Correction: Les jetons utilisés et les coûts sont sous-déclarés sur les requêtes annulées (merci @chrarnoldus!)

## [v4.81.0]

- [#1868](https://github.com/Kilo-Org/kilocode/pull/1868) [`50638b4`](https://github.com/Kilo-Org/kilocode/commit/50638b4226aa3de24f5a9b825a8ef7f1e4d376f6) Merci à [@Toukaiteio](https://github.com/Toukaiteio)! - Ajout du support de Qwen Code

### Changements de correctif

- [#1968](https://github.com/Kilo-Org/kilocode/pull/1968) [`e7680cc`](https://github.com/Kilo-Org/kilocode/commit/e7680cc7f9563a52d4a4babe70ca300ce67aef4a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les paramètres de routage OpenRouter ne sont plus réinitialisés aléatoirement

- [#1948](https://github.com/Kilo-Org/kilocode/pull/1948) [`ecc81c6`](https://github.com/Kilo-Org/kilocode/commit/ecc81c61db648f2701aa7d71f70cefc71a553300) Merci à [@hassoncs](https://github.com/hassoncs)! - Support du glisser-déplacer dans l'en-tête de la chronologie des tâches

- [#1899](https://github.com/Kilo-Org/kilocode/pull/1899) [`2c59ba`](https://github.com/Kilo-Org/kilocode/commit/22c59ba82419f9be7662e56fa71a74ca042c7bd) Merci à [@ivanarifin](https://github.com/ivanarifin)! - Amélioration de l'initialisation et de la gestion des erreurs du gestionnaire de quota virtuel

- [#1955](https://github.com/Kilo-Org/kilocode/pull/1955) [`553033a`](https://github.com/Kilo-Org/kilocode/commit/553033af3220c66e177f516df1bc6b7ee43192e) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajout d'une entrée de coût maximal au menu Approbation automatique dans la vue Chat

## [v4.80.0]

- [#1893](https://github.com/Kilo-Org/kilocode/pull/1893) [`d36b1c1`](https://github.com/Kilo-Org/kilocode/commit/d36b1c17fa9d5cb06d13865b4d1ba1e66500a85c) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Plus de détails de prix sont maintenant affichés pour le fournisseur Kilo Code et OpenRouter. Le coût moyen de Kilo Code est le coût moyen d'un modèle lors de l'utilisation de Kilo Code, après application des réductions de mise en cache. Un détaillant des prix du fournisseur est également disponible.

- [#1893](https://github.com/Kilo-Org/kilocode/pull/1893) [`d36b1c1`](https://github.com/Kilo-Org/kilocode/commit/d36b1c17fa9d5cb06d13865b4d1ba1e66500a85c) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Des options de routage du fournisseur ont été ajoutées aux paramètres Kilo Code et OpenRouter. Il est maintenant possible de sélectionner une préférence de tri (ex: préférer le prix le plus bas) et une politique de données (ex: refuser la collecte de données).

### Changements de correctif

- [#1924](https://github.com/Kilo-Org/kilocode/pull/1924) [`f7d54ee`](https://github.com/Kilo-Org/kilocode/commit/f7d54eee006c21e3b7760e2ee88f144760731892) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le fournisseur API Big Model dédié a été supprimé. Au lieu de cela, vous pouvez utiliser le fournisseur Z.AI avec le point de terminaison open.bigmodel.cn.

## [v4.79.3]

- [#191](https://github.com/Kilo-Org/kilocode/pull/1911) [`62018d4`](https://github.com/Kilo-Org/kilocode/commit/62018d4cb0dff0386bdccc68ce4a9dbb21834e8f) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de l'amélioration de l'invite et de la génération de message de commit ne fonctionnant pas avec GPT-5 sur le fournisseur OpenAI

## [v4.79.2]

- [#1892](https://github.com/Kilo-Org/kilocode/pull/1892) [`c5cfb6c`](https://github.com/Kilo-Org/kilocode/commit/c5cfb6cc0af6b7de2a33832b6b1b56b60b950edc) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de l'impossibilité de définir le coût maximal d'approbation automatique

- [#1889](https://github.com/Kilo-Org/kilocode/pull/1889) [`2bbebd0`](https://github.com/Kilo-Org/kilocode/commit/2bbebd09c27a00c197de9dfcc384f34880fdb46f) Merci à [@unitythemaker](https://github.com/unitythemaker)! - Mise à jour de la liste des modèles Chutes

- [#1879](https://github.com/Kilo-Org/kilocode/pull/1879) [`e348ea1`](https://github.com/Kilo-Org/kilocode/commit/e348ea18cbbfc76abece9cbe9e54bc477e764e99) Merci à [@possible055](https://github.com/possible055)! - Mise à jour des traductions chinoises traditionnelles pour l'interface des paramètres

## [v4.79.1]

- [#1871](https://github.com/Kilo-Org/kilocode/pull/1871) [`fe0b1ce`](https://github.com/Kilo-Org/kilocode/commit/fe0b1ce7141e6fb07f4c4816fd1895a663ce13e7) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.25.10

    - Amélioration du support de GPT-5 (merci Cline et @app/roomote!)
    - Correction: Utilisation de sections CDATA dans les exemples XML pour éviter les erreurs de parseur (#4852 par @hannesrudolph, PR par @hannesrudolph)
    - Correction: Ajout de clés de traduction MCP manquantes (merci @app/roomote!)
    - Correction: Résolution du problème d'arrondi avec les jetons max (#6806 par @markp018, PR par @mrubens)
    - Ajout du support de GLM-4.5 et des modèles OpenAI gpt-oss dans le fournisseur Fireworks (#6753 par @alexfarlander, PR par @app/roomote)
    - Amélioration de l'UX en focusant l'entrée de chat en cliquant sur le bouton plus dans le menu d'extension (merci @app/roomote!)

## [v4.79.0]

- [#1862](https://github.com/Kilo-Org/kilocode/pull/1862) [`43c7179`](https://github.com/Kilo-Org/kilocode/commit/43c71796a58e25805217c520a9d612d56b2f11d5) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclure les modifications de Roo Code v3.25.8

    - Correction: Empêcher les serveurs MCP désactivés de démarrer des processus et afficher le statut correct (#6036 par @hannesrudolph, PR par @app/roomote)
    - Correction: Gérer correctement le chemin de répertoire courant "." dans l'outil codebase_search (#6514 par @hannesrudolph, PR par @app/roomote)
    - Correction: Suppression des espaces de l'URL de base OpenAI pour corriger la détection de modèle (#6559 par @vauhochzett, PR par @app/roomote)
    - Fonctionnalité: Réduction du budget de réflexion minimum de Gemini 2.5 Pro à 128 (merci @app/roomote!)
    - Correction: Amélioration de la gestion des erreurs net::ERR_ABORTED lors de la récupération d'URL (#6632 par @QuinsZouls, PR par @app/roomote)
    - Correction: Récupération d'état d'erreur quand Qdrant devient disponible (#6660 par @hannesrudolph, PR par @app/roomote)
    - Correction: Résolution de la fuite de mémoire dans l'implémentation de défilement virtuel de ChatView (merci @xyOz-dev!)
    - Ajout: Fichiers Swift à la liste de secours (#5857 par @niteshbalusu11, #6555 par @sealad886, PR par @niteshbalusu11)
    - Fonctionnalité: Limite à 20% de la fenêtre de contexte pour les jetons max par défaut (merci @mrubens!)
    - Ajout du support de Claude Opus 4.1
    - Ajout du support d'indexation de codebase pour plusieurs dossiers similaire à l'historique des tâches (#6197 par @NaccOll, PR par @NaccOll)
    - Rendre les dropdowns de sélection de mode réactifs (#6423 par @AyazKaan, PR par @AyazKaan)
    - Interface redessinée de l'en-tête de tâche et de l'historique des tâches (merci @brunobergher!)
    - Correction des points de contrôle de synchronisation et assurance qu'ils fonctionnent correctement (#4827 par @mrubens, PR par @NaccOll)
    - Correction des noms de mode vides ne devant pas être sauvegardés (#5766 par @kfxmvp, PR par @app/roomote)
    - Correction de la création de serveur MCP quand le paramètre est désactivé (#6607 par @characharm, PR par @app/roomote)
    - Mise à jour du style de la couche de surlignage et alignement à la zone de texte (#6647 par @NaccOll, PR par @NaccOll)
    - Correction de l'approbation des commandes en chaîne
    - Utilisation de la classe assistantMessageParser au lieu de parseAssistantMessage (#5340 par @qdaxb, PR par @qdaxb)
    - Inclusion conditionnelle de la section rappel basée sur la configuration de la liste des tâches (merci @NaccOll!)
    - Nettoyage des émetteurs d'événements de tâche et de TaskProvider avec de nouveaux événements (merci @cte!)
    - Définition de la valeur maxTokens du modèle horizon-beta à 32k pour OpenRouter (demandé par @hannesrudolph, PR par @app/roomote)
    - Ajout du support de synchronisation des profils de fournisseur depuis le cloud
    - Correction: Amélioration de la gestion des erreurs ENOENT de Claude Code avec des instructions d'installation (#5866 par @JamieJ1, PR par @app/roomote)
    - Correction: Longueur de contexte du modèle LM Studio (#5075 par @Angular-Angel, PR par @pwilkin)
    - Correction: Indexation VB.NET en implémentant un système de découpage de secours (#6420 par @JensvanZutphen, PR par @daniel-lxs)
    - Ajout de limites de coût d'approbation automatique (merci @hassoncs!)
    - Ajout de Qwen 3 Coder de Cerebras (merci @kevint-cerebras!)
    - Correction: Gestion gracieuse des erreurs de suppression Qdrant pour éviter l'interruption de l'indexation (merci @daniel-lxs!)
    - Correction: Restauration de l'envoi de messages en cliquant sur le bouton de sauvegarde (merci @daniel-lxs!)
    - Correction: Linter non appliqué aux locales/\*/README.md (merci @liwilliam2021!)
    - Gestion de plus de variations de validation de commandes en chaîne et sous-shell
    - Correspondance de recherche/remplacement plus tolérante
    - Nettoyage de l'interface d'approbation automatique (merci @mrubens!)
    - Saut de l'interpolation pour les slash commands non existants (merci @app/roomote!)

### Changements de correctif

- [#1856](https://github.com/Kilo-Org/kilocode/pull/1856) [`9c8423e`](https://github.com/Kilo-Org/kilocode/commit/9c8423ef902cf68566185dbf96dae92f4fcac9b3) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de l'amélioration de l'invite et de la génération de message de commit ne fonctionnant pas avec GPT-5 sur le fournisseur OpenAI

- [#1822](https://github.com/Kilo-Org/kilocode/pull/1822) [`79efaea`](https://github.com/Kilo-Org/kilocode/commit/79efaeaa3da8881310feb4a711f475810df5f84e) Merci à [@tejaschokhawala](https://github.com/tejaschokhawala)! - Correction de l'analyse et de la gestion des limites de valeur de budget de réflexion

- [#1850](https://github.com/Kilo-Org/kilocode/pull/1850) [`b9714db`](https://github.com/Kilo-Org/kilocode/commit/b9714dbbdde7e6ec628d32657329fe82c01cfb42) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Correction de l'erreur "Failed to load Kilo Code provider model list"

- [#1829](https://github.com/Kilo-Org/kilocode/pull/1829) [`2bdeaa0`](https://github.com/Kilo-Org/kilocode/commit/2bdeaa05074e5e87ffa2af1bbed149864dbd3785) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Amélioration de l'allocation de mémoire sur la vue web

## [v4.78.0]

- [#1836](https://github.com/Kilo-Org/kilocode/pull/1836) [`1cc5edd`](https://github.com/Kilo-Org/kilocode/commit/1cc5edd003434fcd3d1fd66e652099165b077ac6) Merci à [@hassoncs](https://github.com/hassoncs)! - La chronologie des tâches défile maintenant horizontalement en utilisant la molette de la souris (merci @ABODFTW!)

### Changements de correctif

- [#1814](https://github.com/Kilo-Org/kilocode/pull/1814) [`3e7290e`](https://github.com/Kilo-Org/kilocode/commit/3e7290e49974d26ee55bcaef743edb527e214735) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Suppression du message "Press Ctrl+Shift+G to generate terminal commands"

- [#1832](https://github.com/Kilo-Org/kilocode/pull/1832) [`80b0f20`](https://github.com/Kilo-Org/kilocode/commit/80b0f209ad823ac23f30838ba3989dbf877fce73) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout du support du modèle GPT-5 au fournisseur OpenAI

## [v4.77.1]

- [#1792](https://github.com/Kilo-Org/kilocode/pull/1792) [`ee300bc`](https://github.com/Kilo-Org/kilocode/commit/ee300bcd9138049182f9979ea9794996c96ee3d1) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Correction du spin infini de la requête API initiale

## [v4.77.0]

- [#1784](https://github.com/Kilo-Org/kilocode/pull/1784) [`bf5bd8e`](https://github.com/Kilo-Org/kilocode/commit/bf5bd8e22e34191730512f0f793d45b6f3a0a694) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Assistance en ligne - Amélioration de la compatibilité avec plus de modèles (analyse JSON)

### Changements de correctif

- [#1786](https://github.com/Kilo-Org/kilocode/pull/1786) [`26cb921`](https://github.com/Kilo-Org/kilocode/commit/26cb92172d361bb274cb30d81f400136bff06f1e) Merci à [@hellosunghyun](https://github.com/hellosunghyun)! - Mise à jour des modèles Cerebras avec les dernières offres

## [v4.76.0]

- [#1738](https://github.com/Kilo-Org/kilocode/pull/1738) [`0d3643b`](https://github.com/Kilo-Org/kilocode/commit/0d3643b4926fb1d77c865eb96ab9bcfdc49e1ea3) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Assistant en ligne: déclenchement automatique - affichage automatique des suggestions de code après un délai configurable

- [#1631](https://github.com/Kilo-Org/kilocode/pull/1631) [`b4f6e09`](https://github.com/Kilo-Org/kilocode/commit/b4f6e09ad57a9e00b5b64f7d75311c647cdf5fce) Merci à [@mcowger](https://github.com/mcowger)! - Ajout du support du suivi d'utilisation et correction d'une condition de course pour la sélection du fournisseur

## [v4.75.0]

- [#1750](https://github.com/Kilo-Org/kilocode/pull/1750) [`4e48339`](https://github.com/Kilo-Org/kilocode/commit/4e48339bb1651e83fe40f481a66c97720afe9900) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Augmentation de la longueur maximale du prompt système pour Claude Code

### Changements de correctif

- [#1761](https://github.com/Kilo-Org/kilocode/pull/1761) [`c13bf0c`](https://github.com/Kilo-Org/kilocode/commit/c13bf0c03cd26f40a705fde2dc0ce67a1e1cc622) Merci à [@Ed4ward](https://github.com/Ed4ward)! - Ajustement des configurations du fournisseur BigModel pour GLM-4.5, ajout des niveaux de prix pour les modèles

- [#1755](https://github.com/Kilo-Org/kilocode/pull/1755) [`9054e23`](https://github.com/Kilo-Org/kilocode/commit/9054e23bd9ca05f920845b8e24d1785fc9a0e2e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout du support pour GLM-4.5-Flash, le modèle le plus avancé de Zhipu à ce jour, aux fournisseurs BigModel et Z.AI.

- [#1741](https://github.com/Kilo-Org/kilocode/pull/1741) [`8ae7c1f`](https://github.com/Kilo-Org/kilocode/commit/8ae7c1f7558cff4370976d347ddc532ecf48fc45) Merci à [@tejaschokhawala](https://github.com/tejaschokhawala)! - feat(gemini): Ajout de Gemma 3 27B au fournisseur Gemini

- [#1744](https://github.com/Kilo-Org/kilocode/pull/1744) [`b8f3267`](https://github.com/Kilo-Org/kilocode/commit/b8f3267e584ea0399e1bdb89b2b03fd08b8c1f1b) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Correction du file d'attente des messages #1736

- [#1763](https://github.com/Kilo-Org/kilocode/pull/1763) [`d3cfbcd`](https://github.com/Kilo-Org/kilocode/commit/d3cfbcd8ccd3820837ba86ee9f7c25a2d4fd44e0) Merci à [@ershang-fireworks](https://github.com/ershang-fireworks)! - Correction du fournisseur fireworks

## [v4.74.0]

- [#1721](https://github.com/Kilo-Org/kilocode/pull/1721) [`3f816a8`](https://github.com/Kilo-Org/kilocode/commit/3f816a8e65b7c94d7212130f1312c9d77ff84ebf) Merci à [@damonto](https://github.com/damonto)! - Suppression de la notation de raccourci du titre de la barre d'activité présente dans certaines langues

- [#1731](https://github.com/Kilo-Org/kilocode/pull/1731) [`8aa1cd3`](https://github.com/Kilo-Org/kilocode/commit/8aa1cd3cd6fa462d8dce4961ff13080d4683161d) Merci à [@Ed4ward](https://github.com/Ed4ward)! - Ajout des fournisseurs Z.AI & BigModel pour les séries GLM-4.5

### Changements de correctif

- [#1717](https://github.com/Kilo-Org/kilocode/pull/1717) [`529c0d6`](https://github.com/Kilo-Org/kilocode/commit/529c0d61da1f45e93604dd98ed10bf74f694f02f) Merci à [@hassoncs](https://github.com/hassoncs)! - Afficher l'astuce de génération de terminal une seule fois par session

- [#1743](https://github.com/Kilo-Org/kilocode/pull/1743) [`b5a50d1`](https://github.com/Kilo-Org/kilocode/commit/b5a50d198306dcf24d16437ccf409e54fd3972cc) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du bug empêchant les sous-tâches du mode Orchestrateur de rapporter correctement leurs résultats

- [#1720](https://github.com/Kilo-Org/kilocode/pull/1720) [`23dfe72`](https://github.com/Kilo-Org/kilocode/commit/23dfe7256bdf95a3be8db4dcc9d6dc6c9ac1d37a) Merci à [@k9evin](https://github.com/k9evin)! - Correction du problème d'état modal d'installation du Marketplace MCP

- [#1735](https://github.com/Kilo-Org/kilocode/pull/1735) [`783e291`](https://github.com/Kilo-Org/kilocode/commit/783e2915bf8795f39f8d63615dd48d79cbd1760a) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction les workflows ne fonctionnent pas

- [#1734](https://github.com/Kilo-Org/kilocode/pull/1734) [`e2de39f`](https://github.com/Kilo-Org/kilocode/commit/e2de39f9082b26336992248ce4cc0ee5d191d4df) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout de l'étiquette "Générer la commande du terminal" manquante sur la page des paramètres des invites

- [#1713](https://github.com/Kilo-Org/kilocode/pull/1713) [`54b88f3`](https://github.com/Kilo-Org/kilocode/commit/54b88f3869e1fa07ae0467b557c7a33adcad0cc9) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le délai d'attente pour Ollama et LM Studio a été augmenté de 5 minutes à 1 heure

## [v4.73.1]

- [#1707](https://github.com/Kilo-Org/kilocode/pull/1707) [`d2af1bd`](https://github.com/Kilo-Org/kilocode/commit/d2af1bd779f8e5480355eeceaeaba91679696d95) Merci à [@possible055](https://github.com/possible055)! - Affiner la traduction chinoise traditionnelle

- [#1710](https://github.com/Kilo-Org/kilocode/pull/1710) [`8d5c647`](https://github.com/Kilo-Org/kilocode/commit/8d5c647e8fd39b5dd528ea959d7e14e28b29d6e6) Merci à [@NaccOll](https://github.com/NaccOll)! - Les rappels de tâches ne sont plus inclus dans l'invite lorsque les listes de tâches sont désactivées

- [#1711](https://github.com/Kilo-Org/kilocode/pull/1711) [`e71ca57`](https://github.com/Kilo-Org/kilocode/commit/e71ca578c2935085213ad41bf24226c55f4cf4f5) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du padding manquant dans le sélecteur de profil

## [v4.73.0]

- [#1654](https://github.com/Kilo-Org/kilocode/pull/1654) [`c4ed29a`](https://github.com/Kilo-Org/kilocode/commit/c4ed29acdabfd131dae82c5ccd06ebe1ecbce058) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclusion des changements de Roo Code v3.25.4

    - feat: ajout de l'intégration du fournisseur SambaNova (#6077 par @snova-jorgep, PR par @snova-jorgep)
    - feat: ajout de l'intégration du fournisseur Doubao (merci @AntiMoron!)
    - feat: définir le modèle horizon-alpha max tokens à 32k pour OpenRouter (merci @app/roomote!)
    - feat: ajout du modèle zai-org/GLM-4.5-FP8 au fournisseur Chutes AI (#6440 par @leakless21, PR par @app/roomote)
    - feat: ajout du support des liens symboliques pour le chargement du fichier AGENTS.md (merci @app/roomote!)
    - feat: ajout optionnel du contexte de l'historique des tâches à l'amélioration de l'invite (merci @liwilliam2021!)
    - fix: suppression du message trompeur de reprise de tâche (#5850 par @KJ7LNW, PR par @KJ7LNW)
    - feat: ajout du motif pour supporter les points de terminaison Databricks /invocations (merci @adambrand!)
    - feat: amélioration du comptage de tokens en extrayant le texte des messages en utilisant l'API VSCode LM (#6112 par @sebinseban, PR par @NaccOll)
    - feat: rafraîchissement automatique des données du marketplace lorsque les paramètres de l'organisation changent (merci @app/roomote!)
    - fix: bouton tuer pour l'outil execute_command (merci @daniel-lxs!)
    - Autoriser la mise en file d'attente des messages avec des images
    - Augmenter les tokens de sortie par défaut de Claude Code à 16k (#6125 par @bpeterson1991, PR par @app/roomote)
    - Ajouter un lien vers la documentation pour les commandes slash
    - Masquer les cases à cocher Gemini sur la vue de bienvenue
    - Clarifier les descriptions de l'outil apply_diff pour souligner les modifications chirurgicales
    - Fix: Empêcher l'effacement de l'entrée lors du clic sur les boutons de chat (merci @hassoncs!)
    - Mettre à jour les règles du réviseur de PR et la configuration du mode (merci @daniel-lxs!)
    - Ajouter le support des contrôles MCP au niveau de l'organisation
    - Fix: Correction de l'icône zap état de survol
    - Ajouter le support du modèle GLM-4.5-Air au fournisseur Chutes AI (#6376 par @matbgn, PR par @app/roomote)
    - Améliorer la validation des sous-shells pour les commandes
    - Ajouter la mise en file d'attente des messages (merci @app/roomote!)
    - Ajouter des options pour le contexte URL et le grounding avec Google Search au fournisseur Gemini (merci @HahaBill!)
    - Ajouter le support des images à l'outil read_file (merci @samhvw8!)
    - Ajouter un paramètre expérimental pour empêcher la perturbation du focus de l'éditeur (#4784 par @hannesrudolph, PR par @app/roomote)
    - Ajouter le support de mise en cache pour LiteLLM (#5791 par @steve-gore-snapdocs, PR par @MuriloFP)
    - Ajouter le support du rendu des tableaux markdown
    - Fix: list_files le mode récursif fonctionne maintenant pour les répertoires pointillés (#2992 par @avtc, #4807 par @zhang157686, #5409 par @MuriloFP, PR par @MuriloFP)
    - Ajouter la fonctionnalité de recherche au sélecteur de mode et réorganiser la mise en page
    - Synchroniser le style du sélecteur de configuration API avec le sélecteur de mode
    - Fix: raccourcis clavier pour les dispositions non-QWERTY (#6161 par @shlgug, PR par @app/roomote)
    - Ajouter la gestion des touches ESC pour les modes, fournisseur API, et fenêtres pop-up des paramètres d'indexation (merci @app/roomote!)
    - Rendre le mode de tâche collant à la tâche (merci @app/roomote!)
    - Ajouter l'enveloppement de texte aux motifs de commande dans Gérer les autorisations de commande (merci @app/roomote!)
    - Mettre à jour le test list-files pour corriger le bug des fichiers cachés (merci @daniel-lxs!)
    - Fix: normaliser les chemins Windows en barres obliques dans l'exportation de mode (#6307 par @hannesrudolph, PR par @app/roomote)
    - Assurer que form-data >= 4.0.4
    - Fix: filtrer les entrées d'onglet non textuelles (Kilo-Org/kilocode#712 par @szermatt, PR par @hassoncs)

## [v4.72.1]

- [#1697](https://github.com/Kilo-Org/kilocode/pull/1697) [`bcea22c`](https://github.com/Kilo-Org/kilocode/commit/bcea22c5cf6c446a73edbaeabcae8bce62da6441) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une note sur où trouver le Marketplace MCP a été ajoutée

## [v4.72.0]

- [#1663](https://github.com/Kilo-Org/kilocode/pull/1663) [`b043643`](https://github.com/Kilo-Org/kilocode/commit/b043643fe067e415ef28375554e24b8829fa5600) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajouter des descriptions au menu du sélecteur de mode

### Changements de correctif

- [#1662](https://github.com/Kilo-Org/kilocode/pull/1662) [`57e5c3e`](https://github.com/Kilo-Org/kilocode/commit/57e5c3eb8f2a86167e121f2d459b74dea987b804) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Certains textes de l'interface utilisateur liés à la tarification et au coût ont été améliorés

- [#1684](https://github.com/Kilo-Org/kilocode/pull/1684) [`ccd8a63`](https://github.com/Kilo-Org/kilocode/commit/ccd8a6387c7123f3cb904a1327eaa775e3f87953) Merci à [@NyxJae](https://github.com/NyxJae)! - Standardiser les noms de marque dans les localisations

- [#1666](https://github.com/Kilo-Org/kilocode/pull/1666) [`c59029a`](https://github.com/Kilo-Org/kilocode/commit/c59029a57b820f3cf684476f56a30dc49509d9ea) Merci à [@kevint-cerebras](https://github.com/kevint-cerebras)! - Mettre à jour les modèles Cerebras disponibles

- [#1655](https://github.com/Kilo-Org/kilocode/pull/1655) [`a3276c0`](https://github.com/Kilo-Org/kilocode/commit/a3276c0feab4300731d9294bbfc44c0bf85db98a) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorations du magasin de crédits

- [#1688](https://github.com/Kilo-Org/kilocode/pull/1688) [`de00d50`](https://github.com/Kilo-Org/kilocode/commit/de00d5014e57a602aaee0b21a97a6352bdcdf4c5) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les requêtes Ollama n'expirent plus après 5 minutes

- [#1677](https://github.com/Kilo-Org/kilocode/pull/1677) [`8a0d0e8`](https://github.com/Kilo-Org/kilocode/commit/8a0d0e830fe56439ce343a743a702c8fa1d02744) Merci à [@possible055](https://github.com/possible055)! - Affiner la traduction chinoise traditionnelle

## [v4.71.0]

- [#1656](https://github.com/Kilo-Org/kilocode/pull/1656) [`68a3f4a`](https://github.com/Kilo-Org/kilocode/commit/68a3f4a583751ae70ecb5fbd83db119375c4d5bd) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Désactiver l'intégration du shell terminal par défaut

- [#1596](https://github.com/Kilo-Org/kilocode/pull/1596) [`3e918a2`](https://github.com/Kilo-Org/kilocode/commit/3e918a299c10796805880121844c4841ab56da7c) Merci à [@hassoncs](https://github.com/hassoncs)! - # Générateur de commandes terminal

    Nouveau générateur de commandes terminal alimenté par l'IA - aide les utilisateurs à créer des commandes terminal en utilisant le langage naturel

    ## Nouvelles fonctionnalités

    - **Générateur de commandes terminal**: Appuyez sur `Ctrl+Shift+G` (ou `Cmd+Shift+G` sur Mac) pour générer des commandes terminal à partir de descriptions en langage naturel
    - **Messages de bienvenue terminal**: Les nouveaux terminaux affichent désormais des astuces utiles sur la fonctionnalité du générateur de commandes
    - **Sélection de configuration API**: Choisissez quelle configuration de fournisseur IA utiliser pour la génération de commandes terminal dans les paramètres

    ## Comment utiliser

    1. Ouvrez n'importe quel terminal dans VSCode
    2. Appuyez sur `Ctrl+Shift+G` (Windows/Linux) ou `Cmd+Shift+G` (Mac)
    3. Décrivez la commande que vous voulez en anglais simple (par exemple, "lister tous les fichiers dans le répertoire courant", "trouver les gros fichiers", "installer le package npm")
    4. L'IA générera et exécutera la commande terminal appropriée

    ## Paramètres

    Naviguez vers Paramètres Kilo Code → Terminal pour configurer:

    - **Configuration API**: Sélectionnez quel fournisseur IA utiliser pour la génération de commandes (par défaut votre configuration actuelle)

- [#1628](https://github.com/Kilo-Org/kilocode/pull/1628) [`4913a39`](https://github.com/Kilo-Org/kilocode/commit/4913a39e6cc6342c896352ed8eaa56831812810c) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci @bhaktatejas922! Ajout du support expérimental pour Morph Fast Apply

### Changements de correctif

- [#1658](https://github.com/Kilo-Org/kilocode/pull/1658) [`962c90a`](https://github.com/Kilo-Org/kilocode/commit/962c90a2d057a72081cb271949cbf780c80a3555) Merci à [@hassoncs](https://github.com/hassoncs)! - Contrôler Kilo Code par programmation depuis la ligne de commande en utilisant IPC avec la variable `KILO_CODE_IPC_SOCKET_PATH`

- [#1647](https://github.com/Kilo-Org/kilocode/pull/1647) [`12a7a5a`](https://github.com/Kilo-Org/kilocode/commit/12a7a5a21ed34ce68694452d7d6bb67a59ca8904) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Simplifier l'écran de bienvenue/connexion

- [#1649](https://github.com/Kilo-Org/kilocode/pull/1649) [`b3d3fc4`](https://github.com/Kilo-Org/kilocode/commit/b3d3fc4c08a0c1023a37ddeb5823d12d30490727) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - L'interface utilisateur de basculement de règles fonctionne à nouveau, les règles peuvent être désactivées

## [v4.70.2]

- [#1645](https://github.com/Kilo-Org/kilocode/pull/1645) [`81e20ef`](https://github.com/Kilo-Org/kilocode/commit/81e20ef2168b966f8757acf009b27a7374a29386) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Vous pouvez maintenant acheter des crédits directement depuis l'onglet profil

- [#1643](https://github.com/Kilo-Org/kilocode/pull/1643) [`0e99eae`](https://github.com/Kilo-Org/kilocode/commit/0e99eaec42f8111dc75bcd5b273871db0ddc1298) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Optimisation de l'utilisation mémoire de la vue de chat

- [#1623](https://github.com/Kilo-Org/kilocode/pull/1623) [`7e29e32`](https://github.com/Kilo-Org/kilocode/commit/7e29e32f40ef3447edf3e5d356235cae6c497e32) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajouter les métriques de mémoire webview à la télémétrie

## [v4.70.1]

- [#1614](https://github.com/Kilo-Org/kilocode/pull/1614) [`2f9d064`](https://github.com/Kilo-Org/kilocode/commit/2f9d064b0370bfa4da92ceffec0026a16feb178a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les comptes GitHub affichent désormais leur avatar sur la page de profil

## [v4.70.0]

- [#1588](https://github.com/Kilo-Org/kilocode/pull/1588) [`96be5a5`](https://github.com/Kilo-Org/kilocode/commit/96be5a5f82111ac2357112a04d3c0adc42103592) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Ajouter un avertissement lorsque GitHub Copilot entre en conflit avec les commandes d'autocomplétion de Kilo

### Changements de correctif

- [#1606](https://github.com/Kilo-Org/kilocode/pull/1606) [`b518ee7`](https://github.com/Kilo-Org/kilocode/commit/b518ee7a577edb61bedcf235bb03164a29719891) Merci à [@hassoncs](https://github.com/hassoncs)! - Mettre toutes les fonctionnalités d'autocomplétion derrière une nouvelle expérience

## [v4.69.0]

- [#1514](https://github.com/Kilo-Org/kilocode/pull/1514) [`3d09426`](https://github.com/Kilo-Org/kilocode/commit/3d0942667c80cb0e9a185fe1bf1b2dc67f82a694) Merci à [@mcowger](https://github.com/mcowger)! - Afficher un toast à l'utilisateur lorsque le gestionnaire actif change dans le fournisseur de quota virtuel de secours

### Changements de correctif

- [#1603](https://github.com/Kilo-Org/kilocode/pull/1603) [`dd60d57`](https://github.com/Kilo-Org/kilocode/commit/dd60d57d49e6d0cd62126b869368f6bd8118202f) Merci à [@namaku](https://github.com/namaku)! - fix(ollama): préférer num_ctx à partir de model.parameters sur context_length à partir de model.info

## [v4.68.0]

- [#1579](https://github.com/Kilo-Org/kilocode/pull/1579) [`4e5d90a`](https://github.com/Kilo-Org/kilocode/commit/4e5d90a78b99ed5dca750446733aef36d3381680) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclusion des changements de Roo Code v3.24.0

    - Ajout du fournisseur Hugging Face avec support pour les modèles open source (merci @TGlide!)
    - Ajout de l'interface utilisateur des autorisations de commande terminal à l'interface de chat
    - Ajout du support pour les règles d'agent standard via AGENTS.md (merci @sgryphon!)
    - Ajout des paramètres pour contrôler les messages de diagnostic
    - Correction du basculement de l'approbation automatique pour être basculé à tout moment (merci @KJ7LNW!)
    - Ajout d'un avertissement d'efficacité pour les blocs SEARCH/REPLACE uniques dans apply_diff (merci @KJ7LNW!)
    - Fix: respecter le paramètre maxReadFileLine pour les mentions de fichiers pour empêcher l'épuisement du contexte (merci @sebinseban!)
    - Fix: normalisation de l'URL API Ollama en supprimant les barres obliques de fin (merci @Naam!)
    - Fix: restaurer les styles de liste pour les listes markdown dans l'interface de chat (merci @village-way!)
    - Ajout du support des clés API Bedrock
    - Ajout de la boîte de dialogue de confirmation et du nettoyage approprié pour la suppression de mode marketplace
    - Fix: annuler le minuteur d'approbation automatique lors de l'édition de la suggestion de suivi (merci @hassoncs!)
    - Fix: ajouter un message d'erreur lorsqu'aucun dossier d'espace de travail n'est ouvert pour l'indexation du code

### Changements de correctif

- [#1561](https://github.com/Kilo-Org/kilocode/pull/1561) [`b3b024f`](https://github.com/Kilo-Org/kilocode/commit/b3b024f670c8b98921d3fc02c626a21c18be0a52) Merci à [@RSO](https://github.com/RSO)! - Ajout des notifications du backend kilocode

- [#1574](https://github.com/Kilo-Org/kilocode/pull/1574) [`2ac061e`](https://github.com/Kilo-Org/kilocode/commit/2ac061ed83ef68f429e113f94f6d72be47fe4389) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorer les styles pour les aperçus de suggestions d'autocomplétion

- [#1581](https://github.com/Kilo-Org/kilocode/pull/1581) [`abf9898`](https://github.com/Kilo-Org/kilocode/commit/abf9898fa1e4e37bdb65ba3abad5c2a7ea78db45) Merci à [@hassoncs](https://github.com/hassoncs)! - Fix 'l'échec de l'application des changements aux fichiers' lorsque les vues de diff Git sont ouvertes

- [#1575](https://github.com/Kilo-Org/kilocode/pull/1575) [`3442152`](https://github.com/Kilo-Org/kilocode/commit/34421525994cfa794744a4f969e8eded5cf14d47) Merci à [@hassoncs](https://github.com/hassoncs)! - Tenter de corriger le bug 'icône kilo manquante' en revenant aux icônes PNG

## [v4.67.0]

- [#1484](https://github.com/Kilo-Org/kilocode/pull/1484) [`8294250`](https://github.com/Kilo-Org/kilocode/commit/8294250662f15c819f68781b507cb0e35a29b71b) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorer les suggestions d'autocomplétion en ajoutant une conscience contextuelle complète

## [v4.66.0]

- [#1539](https://github.com/Kilo-Org/kilocode/pull/1539) [`fd3679b`](https://github.com/Kilo-Org/kilocode/commit/fd3679b56b1b72ca41d70b30d805c94d377f3626) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les modèles Ollama utilisent et rapportent désormais la taille correcte de la fenêtre de contexte.

- [#1510](https://github.com/Kilo-Org/kilocode/pull/1510) [`ee48df4`](https://github.com/Kilo-Org/kilocode/commit/ee48df43fb460a1fbaa9e4f5a11ce45172bf63e3) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Inclusion des changements de Roo Code v3.23.19

    - Fix: configuration de délai configurable pour les diagnostics pour empêcher le rapport d'erreurs prématuré
    - Ajout de la liste d'autorisation de délai de commande
    - Ajout des champs de description et whenToUse aux modes personnalisés dans .roomodes (merci @RandalSchwartz!)
    - Fix: détection de modèle Claude par nom pour la sélection du protocole API (merci @daniel-lxs!)
    - Paramètre optionnel pour empêcher la complétion avec des tâches ouvertes
    - Ajout de la limitation de débit global pour les embeddings OpenAI-compatible (merci @daniel-lxs!)
    - Ajout de la limitation de lot à l'indexeur de code (merci @daniel-lxs!)
    - Ajout: fournisseur Moonshot (merci @CellenLee!)
    - Ajout: modèle Qwen/Qwen3-235B-A22B-Instruct-2507 au fournisseur Chutes AI
    - Fix: déplacer l'invite de condensation de contexte vers la section Prompts (merci @SannidhyaSah!)
    - Ajout: icône de saut pour les fichiers nouvellement créés
    - Fix: ajouter une limite de caractères pour empêcher l'explosion du contexte de sortie terminal
    - Fix: résoudre l'exportation de mode global n'incluant pas les fichiers de règles
    - Ajout: omission automatique du contenu MCP lorsqu'aucun serveur n'est configuré
    - Fix: trier les fichiers de règles liés par noms de liens symboliques, pas par noms cibles
    - Docs: clarifier quand utiliser l'outil update_todo_list
    - Ajout: fournisseur d'embeddings Mistral (merci @SannidhyaSah!)
    - Fix: ajouter le paramètre run aux commandes dans les règles (merci @KJ7LNW!)
    - Mettre à jour: la logique de repli max_tokens dans la fenêtre glissante
    - Fix: améliorations du comptage de tokens Bedrock et Vertex (merci @daniel-lxs!)
    - Ajout: modèle llama-4-maverick au fournisseur Vertex AI (merci @MuriloFP!)
    - Fix: distinguer correctement entre les annulations utilisateur et les échecs API
    - Fix: ajouter une mention de sensibilité à la casse aux corrections suggérées dans le message d'erreur apply_diff
    - Fix: Résoudre l'erreur 'Bad substitution' dans l'analyse de commande (#5978 par @KJ7LNW, PR par @daniel-lxs)
    - Fix: Ajouter le composant ErrorBoundary pour une meilleure gestion des erreurs (#5731 par @elianiva, PR par @KJ7LNW)
    - Améliorer: Utiliser SIGKILL pour les délais d'exécution de commande dans la variante "execa" (merci @cte!)
    - Diviser les commandes sur les nouvelles lignes lors de l'évaluation de l'approbation automatique
    - Refus plus intelligent des commandes

### Changements de correctif

- [#1550](https://github.com/Kilo-Org/kilocode/pull/1550) [`48b0d78`](https://github.com/Kilo-Org/kilocode/commit/48b0d78ea9282f4447e5c57262d727b2bc621e50) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une indication visuelle est désormais fournie chaque fois que le coût d'une requête API n'a pu être récupéré

## [v4.74.0]

- [#1721](https://github.com/Kilo-Org/kilocode/pull/1721) [`3f816a8`](https://github.com/Kilo-Org/kilocode/commit/3f816a8e65b7c94d7212130f1312c9d77ff84ebf) Merci à [@damonto](https://github.com/damonto)! - Suppression de la notation de raccourci du titre de la barre d'activité présente dans certaines langues

- [#1731](https://github.com/Kilo-Org/kilocode/pull/1731) [`8aa1cd3`](https://github.com/Kilo-Org/kilocode/commit/8aa1cd3cd6fa462d8dce4961ff13080d4683161d) Merci à [@Ed4ward](https://github.com/Ed4ward)! - Ajout des fournisseurs Z.AI & BigModel pour les séries GLM-4.5

### Changements de correctif

- [#1717](https://github.com/Kilo-Org/kilocode/pull/1717) [`529c0d6`](https://github.com/Kilo-Org/kilocode/commit/529c0d61da1f45e93604dd98ed10bf74f694f02f) Merci à [@hassoncs](https://github.com/hassoncs)! - Afficher l'astuce de génération de terminal une seule fois par session

- [#1743](https://github.com/Kilo-Org/kilocode/pull/1743) [`b5a50d1`](https://github.com/Kilo-Org/kilocode/commit/b5a50d198306dcf24d16437ccf409e54fd3972cc) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du bug empêchant les sous-tâches du mode Orchestrateur de rapporter correctement leurs résultats

- [#1720](https://github.com/Kilo-Org/kilocode/pull/1720) [`23dfe72`](https://github.com/Kilo-Org/kilocode/commit/23dfe7256bdf95a3be8db4dcc9d6dc6c9ac1d37a) Merci à [@k9evin](https://github.com/k9evin)! - Correction du problème d'état modal d'installation du Marketplace MCP

- [#1735](https://github.com/Kilo-Org/kilocode/pull/1735) [`783e291`](https://github.com/Kilo-Org/kilocode/commit/783e2915bf8795f39f8d63615dd48d79cbd1760a) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction les workflows ne fonctionnent pas

- [#1734](https://github.com/Kilo-Org/kilocode/pull/1734) [`e2de39f`](https://github.com/Kilo-Org/kilocode/commit/e2de39f9082b26336992248ce4cc0ee5d191d4df) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout de l'étiquette "Générer la commande du terminal" manquante sur la page des paramètres des invites

- [#1713](https://github.com/Kilo-Org/kilocode/pull/1713) [`54b88f3`](https://github.com/Kilo-Org/kilocode/commit/54b88f3869e1fa07ae0467b557c7a33adcad0cc9) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Le délai d'attente pour Ollama et LM Studio a été augmenté de 5 minutes à 1 heure

## [v4.73.1]

- [#1707](https://github.com/Kilo-Org/kilocode/pull/1707) [`d2af1bd`](https://github.com/Kilo-Org/kilocode/commit/d2af1bd779f8e5480355eeceaeaba91679696d95) Merci à [@possible055](https://github.com/possible055)! - Affiner la traduction chinoise traditionnelle

- [#1710](https://github.com/Kilo-Org/kilocode/pull/1710) [`8d5c647`](https://github.com/Kilo-Org/kilocode/commit/8d5c647e8fd39b5dd528ea959d7e14e28b29d6e6) Merci à [@NaccOll](https://github.com/NaccOll)! - Les rappels de tâches ne sont plus inclus dans l'invite lorsque les listes de tâches sont désactivées

- [#1711](https://github.com/Kilo-Org/kilocode/pull/1711) [`e71ca57`](https://github.com/Kilo-Org/kilocode/commit/e71ca578c2935085213ad41bf24226c55f4cf4f5) Merci à [@hassoncs](https://github.com/hassoncs)! - Correction du padding manquant dans le sélecteur de profil

## [v4.73.0]

- [#1654](https://github.com/Kilo-Org/kilocode/pull/1654) [`c4ed29a`](https://github.com/Kilo-Org/kilocode/commit/c4ed29acdabfd131dae82c5ccd06ebe1ecbce058) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclusion des changements de Roo Code v3.25.4

    - feat: ajout de l'intégration du fournisseur SambaNova (#6077 par @snova-jorgep, PR par @snova-jorgep)
    - feat: ajout de l'intégration du fournisseur Doubao (merci @AntiMoron!)
    - feat: définir le modèle horizon-alpha max tokens à 32k pour OpenRouter (merci @app/roomote!)
    - feat: ajout du modèle zai-org/GLM-4.5-FP8 au fournisseur Chutes AI (#6440 par @leakless21, PR par @app/roomote)
    - feat: ajout du support des liens symboliques pour le chargement du fichier AGENTS.md (merci @app/roomote!)
    - feat: ajout optionnel du contexte de l'historique des tâches à l'amélioration de l'invite (merci @liwilliam2021!)
    - fix: suppression du message trompeur de reprise de tâche (#5850 par @KJ7LNW, PR par @KJ7LNW)
    - feat: ajout du motif pour supporter les points de terminaison Databricks /invocations (merci @adambrand!)
    - feat: amélioration du comptage de tokens en extrayant le texte des messages en utilisant l'API VSCode LM (#6112 par @sebinseban, PR par @NaccOll)
    - feat: rafraîchissement automatique des données du marketplace lorsque les paramètres de l'organisation changent (merci @app/roomote!)
    - fix: bouton tuer pour l'outil execute_command (merci @daniel-lxs!)
    - Autoriser la mise en file d'attente des messages avec des images
    - Augmenter les tokens de sortie par défaut de Claude Code à 16k (#6125 par @bpeterson1991, PR par @app/roomote)
    - Ajouter un lien vers la documentation pour les commandes slash
    - Masquer les cases à cocher Gemini sur la vue de bienvenue
    - Clarifier les descriptions de l'outil apply_diff pour souligner les modifications chirurgicales
    - Fix: Empêcher l'effacement de l'entrée lors du clic sur les boutons de chat (merci @hassoncs!)
    - Mettre à jour les règles du réviseur de PR et la configuration du mode (merci @daniel-lxs!)
    - Ajouter le support des contrôles MCP au niveau de l'organisation
    - Fix: Correction de l'icône zap état de survol
    - Ajouter le support du modèle GLM-4.5-Air au fournisseur Chutes AI (#6376 par @matbgn, PR par @app/roomote)
    - Améliorer la validation des sous-shells pour les commandes
    - Ajouter la mise en file d'attente des messages (merci @app/roomote!)
    - Ajouter des options pour le contexte URL et le grounding avec Google Search au fournisseur Gemini (merci @HahaBill!)
    - Ajouter le support des images à l'outil read_file (merci @samhvw8!)
    - Ajouter un paramètre expérimental pour empêcher la perturbation du focus de l'éditeur (#4784 par @hannesrudolph, PR par @app/roomote)
    - Ajouter le support de mise en cache pour LiteLLM (#5791 par @steve-gore-snapdocs, PR par @MuriloFP)
    - Ajouter le support du rendu des tableaux markdown
    - Fix: list_files le mode récursif fonctionne maintenant pour les répertoires pointillés (#2992 par @avtc, #4807 par @zhang157686, #5409 par @MuriloFP, PR par @MuriloFP)
    - Ajouter la fonctionnalité de recherche au sélecteur de mode et réorganiser la mise en page
    - Synchroniser le style du sélecteur de configuration API avec le sélecteur de mode
    - Fix: raccourcis clavier pour les dispositions non-QWERTY (#6161 par @shlgug, PR par @app/roomote)
    - Ajouter la gestion des touches ESC pour les modes, fournisseur API, et fenêtres pop-up des paramètres d'indexation (merci @app/roomote!)
    - Rendre le mode de tâche collant à la tâche (merci @app/roomote!)
    - Ajouter l'enveloppement de texte aux motifs de commande dans Gérer les autorisations de commande (merci @app/roomote!)
    - Mettre à jour le test list-files pour corriger le bug des fichiers cachés (merci @daniel-lxs!)
    - Fix: normaliser les chemins Windows en barres obliques dans l'exportation de mode (#6307 par @hannesrudolph, PR par @app/roomote)
    - Assurer que form-data >= 4.0.4
    - Fix: filtrer les entrées d'onglet non textuelles (Kilo-Org/kilocode#712 par @szermatt, PR par @hassoncs)

## [v4.72.1]

- [#1697](https://github.com/Kilo-Org/kilocode/pull/1697) [`bcea22c`](https://github.com/Kilo-Org/kilocode/commit/bcea22c5cf6c446a73edbaeabcae8bce62da6441) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une note sur où trouver le Marketplace MCP a été ajoutée

## [v4.72.0]

- [#1663](https://github.com/Kilo-Org/kilocode/pull/1663) [`b043643`](https://github.com/Kilo-Org/kilocode/commit/b043643fe067e415ef28375554e24b8829fa5600) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajouter des descriptions au menu du sélecteur de mode

### Changements de correctif

- [#1662](https://github.com/Kilo-Org/kilocode/pull/1662) [`57e5c3e`](https://github.com/Kilo-Org/kilocode/commit/57e5c3eb8f2a86167e121f2d459b74dea987b804) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Certains textes de l'interface utilisateur liés à la tarification et au coût ont été améliorés

- [#1684](https://github.com/Kilo-Org/kilocode/pull/1684) [`ccd8a63`](https://github.com/Kilo-Org/kilocode/commit/ccd8a6387c7123f3cb904a1327eaa775e3f87953) Merci à [@NyxJae](https://github.com/NyxJae)! - Standardiser les noms de marque dans les localisations

- [#1666](https://github.com/Kilo-Org/kilocode/pull/1666) [`c59029a`](https://github.com/Kilo-Org/kilocode/commit/c59029a57b820f3cf684476f56a30dc49509d9ea) Merci à [@kevint-cerebras](https://github.com/kevint-cerebras)! - Mettre à jour les modèles Cerebras disponibles

- [#1655](https://github.com/Kilo-Org/kilocode/pull/1655) [`a3276c0`](https://github.com/Kilo-Org/kilocode/commit/a3276c0feab4300731d9294bbfc44c0bf85db98a) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorations du magasin de crédits

- [#1688](https://github.com/Kilo-Org/kilocode/pull/1688) [`de00d50`](https://github.com/Kilo-Org/kilocode/commit/de00d5014e57a602aaee0b21a97a6352bdcdf4c5) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les requêtes Ollama n'expirent plus après 5 minutes

- [#1677](https://github.com/Kilo-Org/kilocode/pull/1677) [`8a0d0e8`](https://github.com/Kilo-Org/kilocode/commit/8a0d0e830fe56439ce343a743a702c8fa1d02744) Merci à [@possible055](https://github.com/possible055)! - Affiner la traduction chinoise traditionnelle

## [v4.71.0]

- [#1656](https://github.com/Kilo-Org/kilocode/pull/1656) [`68a3f4a`](https://github.com/Kilo-Org/kilocode/commit/68a3f4a583751ae70ecb5fbd83db119375c4d5bd) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Désactiver l'intégration du shell terminal par défaut

- [#1596](https://github.com/Kilo-Org/kilocode/pull/1596) [`3e918a2`](https://github.com/Kilo-Org/kilocode/commit/3e918a299c10796805880121844c4841ab56da7c) Merci à [@hassoncs](https://github.com/hassoncs)! - # Générateur de commandes terminal

    Nouveau générateur de commandes terminal alimenté par l'IA - aide les utilisateurs à créer des commandes terminal en utilisant le langage naturel

    ## Nouvelles fonctionnalités

    - **Générateur de commandes terminal**: Appuyez sur `Ctrl+Shift+G` (ou `Cmd+Shift+G` sur Mac) pour générer des commandes terminal à partir de descriptions en langage naturel
    - **Messages de bienvenue terminal**: Les nouveaux terminaux affichent désormais des astuces utiles sur la fonctionnalité du générateur de commandes
    - **Sélection de configuration API**: Choisissez quelle configuration de fournisseur IA utiliser pour la génération de commandes terminal dans les paramètres

    ## Comment utiliser

    1. Ouvrez n'importe quel terminal dans VSCode
    2. Appuyez sur `Ctrl+Shift+G` (Windows/Linux) ou `Cmd+Shift+G` (Mac)
    3. Décrivez la commande que vous voulez en anglais simple (par exemple, "lister tous les fichiers dans le répertoire courant", "trouver les gros fichiers", "installer le package npm")
    4. L'IA générera et exécutera la commande terminal appropriée

    ## Paramètres

    Naviguez vers Paramètres Kilo Code → Terminal pour configurer:

    - **Configuration API**: Sélectionnez quel fournisseur IA utiliser pour la génération de commandes (par défaut votre configuration actuelle)

- [#1628](https://github.com/Kilo-Org/kilocode/pull/1628) [`4913a39`](https://github.com/Kilo-Org/kilocode/commit/4913a39e6cc6342c896352ed8eaa56831812810c) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Merci @bhaktatejas922! Ajout du support expérimental pour Morph Fast Apply

### Changements de correctif

- [#1658](https://github.com/Kilo-Org/kilocode/pull/1658) [`962c90a`](https://github.com/Kilo-Org/kilocode/commit/962c90a2d057a72081cb271949cbf780c80a3555) Merci à [@hassoncs](https://github.com/hassoncs)! - Contrôler Kilo Code par programmation depuis la ligne de commande en utilisant IPC avec la variable `KILO_CODE_IPC_SOCKET_PATH`

- [#1647](https://github.com/Kilo-Org/kilocode/pull/1647) [`12a7a5a`](https://github.com/Kilo-Org/kilocode/commit/12a7a5a21ed34ce68694452d7d6bb67a59ca8904) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Simplifier l'écran de bienvenue/connexion

- [#1649](https://github.com/Kilo-Org/kilocode/pull/1649) [`b3d3fc4`](https://github.com/Kilo-Org/kilocode/commit/b3d3fc4c08a0c1023a37ddeb5823d12d30490727) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - L'interface utilisateur de basculement de règles fonctionne à nouveau, les règles peuvent être désactivées

## [v4.70.2]

- [#1645](https://github.com/Kilo-Org/kilocode/pull/1645) [`81e20ef`](https://github.com/Kilo-Org/kilocode/commit/81e20ef2168b966f8757acf009b27a7374a29386) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Vous pouvez maintenant acheter des crédits directement depuis l'onglet profil

- [#1643](https://github.com/Kilo-Org/kilocode/pull/1643) [`0e99eae`](https://github.com/Kilo-Org/kilocode/commit/0e99eaec42f8111dc75bcd5b273871db0ddc1298) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Optimisation de l'utilisation mémoire de la vue de chat

- [#1623](https://github.com/Kilo-Org/kilocode/pull/1623) [`7e29e32`](https://github.com/Kilo-Org/kilocode/commit/7e29e32f40ef3447edf3e5d356235cae6c497e32) Merci à [@hassoncs](https://github.com/hassoncs)! - Ajouter les métriques de mémoire webview à la télémétrie

## [v4.70.1]

- [#1614](https://github.com/Kilo-Org/kilocode/pull/1614) [`2f9d064`](https://github.com/Kilo-Org/kilocode/commit/2f9d064b0370bfa4da92ceffec0026a16feb178a) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les comptes GitHub affichent désormais leur avatar sur la page de profil

## [v4.70.0]

- [#1588](https://github.com/Kilo-Org/kilocode/pull/1588) [`96be5a5`](https://github.com/Kilo-Org/kilocode/commit/96be5a5f82111ac2357112a04d3c0adc42103592) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Ajouter un avertissement lorsque GitHub Copilot entre en conflit avec les commandes d'autocomplétion de Kilo

### Changements de correctif

- [#1606](https://github.com/Kilo-Org/kilocode/pull/1606) [`b518ee7`](https://github.com/Kilo-Org/kilocode/commit/b518ee7a577edb61bedcf235bb03164a29719891) Merci à [@hassoncs](https://github.com/hassoncs)! - Mettre toutes les fonctionnalités d'autocomplétion derrière une nouvelle expérience

## [v4.69.0]

- [#1514](https://github.com/Kilo-Org/kilocode/pull/1514) [`3d09426`](https://github.com/Kilo-Org/kilocode/commit/3d0942667c80cb0e9a185fe1bf1b2dc67f82a694) Merci à [@mcowger](https://github.com/mcowger)! - Afficher un toast à l'utilisateur lorsque le gestionnaire actif change dans le fournisseur de quota virtuel de secours

### Changements de correctif

- [#1603](https://github.com/Kilo-Org/kilocode/pull/1603) [`dd60d57`](https://github.com/Kilo-Org/kilocode/commit/dd60d57d49e6d0cd62126b869368f6bd8118202f) Merci à [@namaku](https://github.com/namaku)! - fix(ollama): préférer num_ctx à partir de model.parameters sur context_length à partir de model.info

## [v4.68.0]

- [#1579](https://github.com/Kilo-Org/kilocode/pull/1579) [`4e5d90a`](https://github.com/Kilo-Org/kilocode/commit/4e5d90a78b99ed5dca750446733aef36d3381680) Merci à [@kevinvandijk](https://github.com/kevinvandijk)! - Inclusion des changements de Roo Code v3.24.0

    - Ajout du fournisseur Hugging Face avec support pour les modèles open source (merci @TGlide!)
    - Ajout de l'interface utilisateur des autorisations de commande terminal à l'interface de chat
    - Ajout du support pour les règles d'agent standard via AGENTS.md (merci @sgryphon!)
    - Ajout des paramètres pour contrôler les messages de diagnostic
    - Correction du basculement de l'approbation automatique pour être basculé à tout moment (merci @KJ7LNW!)
    - Ajout d'un avertissement d'efficacité pour les blocs SEARCH/REPLACE uniques dans apply_diff (merci @KJ7LNW!)
    - Fix: respecter le paramètre maxReadFileLine pour les mentions de fichiers pour empêcher l'épuisement du contexte (merci @sebinseban!)
    - Fix: normalisation de l'URL API Ollama en supprimant les barres obliques de fin (merci @Naam!)
    - Fix: restaurer les styles de liste pour les listes markdown dans l'interface de chat (merci @village-way!)
    - Ajout du support des clés API Bedrock
    - Ajout de la boîte de dialogue de confirmation et du nettoyage approprié pour la suppression de mode marketplace
    - Fix: annuler le minuteur d'approbation automatique lors de l'édition de la suggestion de suivi (merci @hassoncs!)
    - Fix: ajouter un message d'erreur lorsqu'aucun dossier d'espace de travail n'est ouvert pour l'indexation du code

### Changements de correctif

- [#1561](https://github.com/Kilo-Org/kilocode/pull/1561) [`b3b024f`](https://github.com/Kilo-Org/kilocode/commit/b3b024f670c8b98921d3fc02c626a21c18be0a52) Merci à [@RSO](https://github.com/RSO)! - Ajout des notifications du backend kilocode

- [#1574](https://github.com/Kilo-Org/kilocode/pull/1574) [`2ac061e`](https://github.com/Kilo-Org/kilocode/commit/2ac061ed83ef68f429e113f94f6d72be47fe4389) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorer les styles pour les aperçus de suggestions d'autocomplétion

- [#1581](https://github.com/Kilo-Org/kilocode/pull/1581) [`abf9898`](https://github.com/Kilo-Org/kilocode/commit/abf9898fa1e4e37bdb65ba3abad5c2a7ea78db45) Merci à [@hassoncs](https://github.com/hassoncs)! - Fix 'l'échec de l'application des changements aux fichiers' lorsque les vues de diff Git sont ouvertes

- [#1575](https://github.com/Kilo-Org/kilocode/pull/1575) [`3442152`](https://github.com/Kilo-Org/kilocode/commit/34421525994cfa794744a4f969e8eded5cf14d47) Merci à [@hassoncs](https://github.com/hassoncs)! - Tenter de corriger le bug 'icône kilo manquante' en revenant aux icônes PNG

## [v4.67.0]

- [#1484](https://github.com/Kilo-Org/kilocode/pull/1484) [`8294250`](https://github.com/Kilo-Org/kilocode/commit/8294250662f15c819f68781b507cb0e35a29b71b) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Améliorer les suggestions d'autocomplétion en ajoutant une conscience contextuelle complète

## [v4.66.0]

- [#1539](https://github.com/Kilo-Org/kilocode/pull/1539) [`fd3679b`](https://github.com/Kilo-Org/kilocode/commit/fd3679b56b1b72ca41d70b30d805c94d377f3626) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les modèles Ollama utilisent et rapportent désormais la taille correcte de la fenêtre de contexte.

- [#1510](https://github.com/Kilo-Org/kilocode/pull/1510) [`ee48df4`](https://github.com/Kilo-Org/kilocode/commit/ee48df43fb460a1fbaa9e4f5a11ce45172bf63e3) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Inclusion des changements de Roo Code v3.23.19

    - Fix: configuration de délai configurable pour les diagnostics pour empêcher le rapport d'erreurs prématuré
    - Ajout de la liste d'autorisation de délai de commande
    - Ajout des champs de description et whenToUse aux modes personnalisés dans .roomodes (merci @RandalSchwartz!)
    - Fix: détection de modèle Claude par nom pour la sélection du protocole API (merci @daniel-lxs!)
    - Paramètre optionnel pour empêcher la complétion avec des tâches ouvertes
    - Ajout de la limitation de débit global pour les embeddings OpenAI-compatible (merci @daniel-lxs!)
    - Ajout de la limitation de lot à l'indexeur de code (merci @daniel-lxs!)
    - Ajout: fournisseur Moonshot (merci @CellenLee!)
    - Ajout: modèle Qwen/Qwen3-235B-A22B-Instruct-2507 au fournisseur Chutes AI
    - Fix: déplacer l'invite de condensation de contexte vers la section Prompts (merci @SannidhyaSah!)
    - Ajout: icône de saut pour les fichiers nouvellement créés
    - Fix: ajouter une limite de caractères pour empêcher l'explosion du contexte de sortie terminal
    - Fix: résoudre l'exportation de mode global n'incluant pas les fichiers de règles
    - Ajout: omission automatique du contenu MCP lorsqu'aucun serveur n'est configuré
    - Fix: trier les fichiers de règles liés par noms de liens symboliques, pas par noms cibles
    - Docs: clarifier quand utiliser l'outil update_todo_list
    - Ajout: fournisseur d'embeddings Mistral (merci @SannidhyaSah!)
    - Fix: ajouter le paramètre run aux commandes dans les règles (merci @KJ7LNW!)
    - Mettre à jour: la logique de repli max_tokens dans la fenêtre glissante
    - Fix: améliorations du comptage de tokens Bedrock et Vertex (merci @daniel-lxs!)
    - Ajout: modèle llama-4-maverick au fournisseur Vertex AI (merci @MuriloFP!)
    - Fix: distinguer correctement entre les annulations utilisateur et les échecs API
    - Fix: ajouter une mention de sensibilité à la casse aux corrections suggérées dans le message d'erreur apply_diff
    - Fix: Résoudre l'erreur 'Bad substitution' dans l'analyse de commande (#5978 par @KJ7LNW, PR par @daniel-lxs)
    - Fix: Ajouter le composant ErrorBoundary pour une meilleure gestion des erreurs (#5731 par @elianiva, PR par @KJ7LNW)
    - Améliorer: Utiliser SIGKILL pour les délais d'exécution de commande dans la variante "execa" (merci @cte!)
    - Diviser les commandes sur les nouvelles lignes lors de l'évaluation de l'approbation automatique
    - Refus plus intelligent des commandes

### Changements de correctif

- [#1550](https://github.com/Kilo-Org/kilocode/pull/1550) [`48b0d78`](https://github.com/Kilo-Org/kilocode/commit/48b0d78ea9282f4447e5c57262d727b2bc621e50) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une indication visuelle est désormais fournie chaque fois que le coût d'une requête API n'a pu être récupéré

## [v4.66.0]

- [#1539](https://github.com/Kilo-Org/kilocode/pull/1539) [`fd3679b`](https://github.com/Kilo-Org/kilocode/commit/fd3679b56b1b72ca41d70b30d805c94d377f3626) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Les modèles Ollama utilisent et rapportent désormais la taille correcte de la fenêtre de contexte.

- [#1510](https://github.com/Kilo-Org/kilocode/pull/1510) [`ee48df4`](https://github.com/Kilo-Org/kilocode/commit/ee48df43fb460a1fbaa9e4f5a11ce45172bf63e3) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Inclusion des changements de Roo Code v3.23.19

    - Fix: configuration de délai configurable pour les diagnostics pour empêcher le rapport d'erreurs prématuré
    - Ajout de la liste d'autorisation de délai de commande
    - Ajout des champs de description et whenToUse aux modes personnalisés dans .roomodes (merci @RandalSchwartz!)
    - Fix: détection de modèle Claude par nom pour la sélection du protocole API (merci @daniel-lxs!)
    - Paramètre optionnel pour empêcher la complétion avec des tâches ouvertes
    - Ajout de la limitation de débit global pour les embeddings OpenAI-compatible (merci @daniel-lxs!)
    - Ajout de la limitation de lot à l'indexeur de code (merci @daniel-lxs!)
    - Ajout: fournisseur Moonshot (merci @CellenLee!)
    - Ajout: modèle Qwen/Qwen3-235B-A22B-Instruct-2507 au fournisseur Chutes AI
    - Fix: déplacer l'invite de condensation de contexte vers la section Prompts (merci @SannidhyaSah!)
    - Ajout: icône de saut pour les fichiers nouvellement créés
    - Fix: ajouter une limite de caractères pour empêcher l'explosion du contexte de sortie terminal
    - Fix: résoudre l'exportation de mode global n'incluant pas les fichiers de règles
    - Ajout: omission automatique du contenu MCP lorsqu'aucun serveur n'est configuré
    - Fix: trier les fichiers de règles liés par noms de liens symboliques, pas par noms cibles
    - Docs: clarifier quand utiliser l'outil update_todo_list
    - Ajout: fournisseur d'embeddings Mistral (merci @SannidhyaSah!)
    - Fix: ajouter le paramètre run aux commandes dans les règles (merci @KJ7LNW!)
    - Mettre à jour: la logique de repli max_tokens dans la fenêtre glissante
    - Fix: améliorations du comptage de tokens Bedrock et Vertex (merci @daniel-lxs!)
    - Ajout: modèle llama-4-maverick au fournisseur Vertex AI (merci @MuriloFP!)
    - Fix: distinguer correctement entre les annulations utilisateur et les échecs API
    - Fix: ajouter une mention de sensibilité à la casse aux corrections suggérées dans le message d'erreur apply_diff
    - Fix: Résoudre l'erreur 'Bad substitution' dans l'analyse de commande (#5978 par @KJ7LNW, PR par @daniel-lxs)
    - Fix: Ajouter le composant ErrorBoundary pour une meilleure gestion des erreurs (#5731 par @elianiva, PR par @KJ7LNW)
    - Améliorer: Utiliser SIGKILL pour les délais d'exécution de commande dans la variante "execa" (merci @cte!)
    - Diviser les commandes sur les nouvelles lignes lors de l'évaluation de l'approbation automatique
    - Refus plus intelligent des commandes

### Changements de correctif

- [#1550](https://github.com/Kilo-Org/kilocode/pull/1550) [`48b0d78`](https://github.com/Kilo-Org/kilocode/commit/48b0d78ea9282f4447e5c57262d727b2bc621e50) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Une indication visuelle est désormais fournie chaque fois que le coût d'une requête API n'a pu être récupéré

## [v4.65.3]

- [#1544](https://github.com/Kilo-Org/kilocode/pull/1544) [`758d4ad`](https://github.com/Kilo-Org/kilocode/commit/758d4addb361ae9bc7eb3ba3a98f37a298f8d60d) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Améliorations du reporting des tokens et des coûts d'utilisation

## [v4.65.2]

- [#1526](https://github.com/Kilo-Org/kilocode/pull/1526) [`fe97c95`](https://github.com/Kilo-Org/kilocode/commit/fe97c9526a13dcf6834c5695dc46b4194738464) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Spécifier le modèle par défaut en un seul endroit dans le code

## [v4.65.1]

- [#1518](https://github.com/Kilo-Org/kilocode/pull/1518) [`f709388`](https://github.com/Kilo-Org/kilocode/commit/f709388ae1e1b730c06796d0b9ec207532219d6e) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Claude Sonnet 4 est maintenant le modèle par défaut! Assistez à l'atelier Anthropic x Kilo Code [The Art of Prompt Engineering for Software Developers](https://www.eventbrite.nl/e/the-art-of-prompt-engineering-for-software-developers-tickets-1474017238239) Jeudi, 31 juillet 2025!

- [#1521](https://github.com/Kilo-Org/kilocode/pull/1521) [`08ccbea`](https://github.com/Kilo-Org/kilocode/commit/08ccbeaf2c4e5d9ec22c77edc7cea673f75e397c) Merci à [@hassoncs](https://github.com/hassoncs)! - La boîte de chat n'est plus effacée quand on clique sur les boutons

    Précédemment, si l'un des boutons dans l'agent chat était cliqué, la ChatTextArea était effacée. Maintenant, la ChatTextArea ne sera effacée que si un message est envoyé dans le cadre de la réponse.

## [v4.65.0]

- [#1487](https://github.com/Kilo-Org/kilocode/pull/1487) [`ad91c38`](https://github.com/Kilo-Org/kilocode/commit/ad91c3824c5fcbced818c90745bed95f7a7e9dc0) Merci à [@mcowger](https://github.com/mcowger)! - Introduire un nouveau Fournisseur de Quota Virtuel de Secours - déléguer à d'autres Profils basés sur des limites de coût ou de nombre de requêtes!

    Ce nouveau fournisseur virtuel vous permet de définir des quotas basés sur le coût ou le nombre de requêtes pour une liste de profils. Il basculera automatiquement vers le profil de fournisseur suivant quand une limite est atteinte!

### Changements de correctif

- [#1502](https://github.com/Kilo-Org/kilocode/pull/1502) [`73f414c`](https://github.com/Kilo-Org/kilocode/commit/73f41425a59e140946c4c415a8f11817898987c) Merci à [@hellosunghyun](https://github.com/hellosunghyun)! - Mise à jour des modèles Cerebras avec les dernières offres

- [#1512](https://github.com/Kilo-Org/kilocode/pull/1512) [`aea28be`](https://github.com/Kilo-Org/kilocode/commit/aea28bec33d27ad3f824a8a1d44c9d36025adf26) Merci à [@hassoncs](https://github.com/hassoncs)! - Amélioration de la mémoire lors de l'ouverture de nombreux documents avec différentes URIs

- [#1515](https://github.com/Kilo-Org/kilocode/pull/1515) [`2b208b3`](https://github.com/Kilo-Org/kilocode/commit/2b208b3320834a847fb3443677d5e7dee372c241) Merci à [@hassoncs](https://github.com/hassoncs)! - Amélioration de l'arrière-plan de la boîte de chat

## [v4.64.3]

- [#1494](https://github.com/Kilo-Org/kilocode/pull/1494) [`1488591`](https://github.com/Kilo-Org/kilocode/commit/148859168d0dc1521d5ee7c5d96e63ffae47a587) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Amélioration du reporting des erreurs liées aux points de contrôle

## [v4.64.2]

- [#1477](https://github.com/Kilo-Org/kilocode/pull/1477) [`8edf106`](https://github.com/Kilo-Org/kilocode/commit/8edf1063d308f36074e10d68cf8418d0f20665d6) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Empêcher la sélection de fournisseurs incompatibles quand vous changez de modèles

## [v4.64.1]

- [#1474](https://github.com/Kilo-Org/kilocode/pull/1474) [`7efe383`](https://github.com/Kilo-Org/kilocode/commit/7efe383628f91b7977c0cffcdfc0a7a226ab1f01) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Télémétrie de l'Assistance en ligne

## [v4.64.0]

- [#1447](https://github.com/Kilo-Org/kilocode/pull/1447) [`38d135e`](https://github.com/Kilo-Org/kilocode/commit/38d135eafc395fe5c9883fbe9fcd79941a21e0ce) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - (retry) La vue Tâche affiche désormais le coût par requête lors de l'utilisation du fournisseur Kilo Code

## [v4.63.2]

- [#1462](https://github.com/Kilo-Org/kilocode/pull/1462) [`54f09c6`](https://github.com/Kilo-Org/kilocode/commit/54f09c6edbd9ea13ebbd645fad9de5a448d5a11d) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code n'utilise plus Gemini 2.5 Pro après une nouvelle installation/réinitialisation tout en affichant Sonnet 3.7

- [#1471](https://github.com/Kilo-Org/kilocode/pull/1471) [`d95b409`](https://github.com/Kilo-Org/kilocode/commit/d95b40981715fffbfe62d1fc4e54472195db1f2c) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Fix Kilo Code profil persist of Routing Provider

## [v4.63.1]

- [#1460](https://github.com/Kilo-Org/kilocode/pull/1460) [`415ea90`](https://github.com/Kilo-Org/kilocode/commit/415ea904e8b9ddd35ce1e4a894411f3679c94922) Merci à [@markijbema](https://github.com/markijbema)! - Améliorer l'étiquette de la liste de tâches

## [v4.63.0]

- [#1451](https://github.com/Kilo-Org/kilocode/pull/1451) [`66b5892`](https://github.com/Kilo-Org/kilocode/commit/66b5892fbc56d88372ba2ad87118f8696ccbd366) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Ajout de bascules qui désactivent les fonctionnalités d'autocomplétion aux paramètres du panneau

- [#1450](https://github.com/Kilo-Org/kilocode/pull/1450) [`077dba2`](https://github.com/Kilo-Org/kilocode/commit/077dba2964ad99bea5f57d9db1718063abd08a18) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Ajout de la case à cocher d'outil de liste de tâches aux paramètres avancés du fournisseur (merci @daniel-lxs, @mrubens!)

- [#1443](https://github.com/Kilo-Org/kilocode/pull/1443) [`eba422a`](https://github.com/Kilo-Org/kilocode/commit/eba422acb01017cc9c7465f414836ff9f14bc86c) Merci à [@catrielmuller](https://github.com/catrielmuller)! - Ajout du support de changement du routage du fournisseur Kilo Code

    Vous pouvez maintenant sélectionner le fournisseur OpenRouter pour traiter vos requêtes Kilo Code.

### Changements de correctif

- [#1454](https://github.com/Kilo-Org/kilocode/pull/1454) [`b34b55a`](https://github.com/Kilo-Org/kilocode/commit/b34b55a3f074f14bdfc28bb1998cd91fdf74b0b5) Merci à [@chainedcoder](https://github.com/chainedcoder)! - Charger l'ID de projet depuis le fichier .env de la CLI Gemini

- [#1448](https://github.com/Kilo-Org/kilocode/pull/1448) [`4e9118b`](https://github.com/Kilo-Org/kilocode/commit/4e9118b7c876c2d2620f2b72503ec17b85ec0539) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Suppression du support linguistique pour Filipino, Grec et Suédois car l'utilisation est très faible. Nous pouvons les rajouter si la demande existe.

## [v4.62.0]

- [#1386](https://github.com/Kilo-Org/kilocode/pull/1386) [`48fb539`](https://github.com/Kilo-Org/kilocode/commit/48fb5392a962279463d8db22555db42f32d4ad8) Merci à [@chrarnoldus](https://github.com/chrarnoldus)! - Inclusion des changements de Roo Code v3.23.14

    - Fix Mermaid syntax warning (merci @MuriloFP!)
    - Expand Vertex AI region config pour inclure toutes les régions disponibles dans GCP Vertex AI (merci @shubhamgupta731!)
    - Gérer Qdrant vector dimension mismatch quand on change de modèle d'embedding (merci @daniel-lxs!)
    - Fix typos in comment & document (merci @noritaka1166!)
    - Améliorer l'affichage des résultats de recherche de codebase
    - Correct translation fallback logic for embedding errors (merci @daniel-lxs!)
    - Clean up MCP tool disabling
    - Link to marketplace from modes and MCP tab
    - Fix TTS button display (merci @sensei-woo!)
    - Add Devstral Medium model support
    - Add comprehensive error telemetry to code-index service (merci @daniel-lxs!)
    - Exclude cache tokens from context window calculation (merci @daniel-lxs!)
    - Enable dynamic tool selection in architect mode for context discovery
    - Add configurable max output tokens setting for claude-code
    - Add enable/disable toggle for code indexing (merci @daniel-lxs!)
    - Add a command auto-deny list to auto-approve settings
    - Add navigation link to history tab in HistoryPreview
    - Enable Claude Code provider to run natively on Windows (merci @SannidhyaSah!)
    - Add gemini-embedding-001 model to code-index service (merci @daniel-lxs!)
    - Resolve vector dimension mismatch error when switching embedding models
    - Return the cwd in the exec tool's response so that the model is not lost after subsequent calls (merci @chris-garrett!)
    - Add configurable timeout for command execution in VS Code settings
    - Prioritize built-in model dimensions over custom dimensions (merci @daniel-lxs!)
    - Add padding to the index model options
    - Add Kimi K2 model to Groq along with fixes to context condensing math
    - Add Cmd+Shift+. keyboard shortcut for previous mode switching
    - Update the max-token calculation in model-params to better support Kimi K2 and others
    - Add the ability to "undo" enhance prompt changes
    - Fix a bug where the path component of the baseURL for the LiteLLM provider contains path in it (merci @ChuKhaLi)
    - Add support for Vertex AI model name formatting when using Claude Code with Vertex AI (merci @janaki-sasidhar)
    - The list-files tool must include at least the first-level directory contents (merci @qdaxb!)
    - Add a configurable limit that controls both consecutive errors and tool repetitions (merci @MuriloFP!)
    - Add `.terraform/` and `.terragrunt-cache/` directories to the checkpoint exclusion patterns (merci @MuriloFP)
    - Increase Ollama API timeout values (merci @daniel-lxs)
    - Fix an issue where you need to "discard changes" before saving even though there are no settings changes
    - Fix `DirectoryScanner` memory leak and improve file limit handling (merci @daniel-lxs)
    - Fix time formatting in environment (merci @chrarnoldus)
    - Prevent empty mode names from being saved (merci @daniel-lxs)
    - Improve auto-approve checkbox UX
    - Improve the chat message edit / delete functionality (merci @liwilliam2021)
    - Add `commandExecutionTimeout` to `GlobalSettings`
    - Log api-initiated tasks to a tmp directory
