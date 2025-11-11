# execute_command

L'outil `execute_command` exécute des commandes CLI sur le système de l'utilisateur. Il permet à Kilo Code d'effectuer des opérations système, installer des dépendances, construire des projets, démarrer des serveurs, et exécuter d'autres tâches basées sur terminal nécessaires pour accomplir les objectifs utilisateur.

## Paramètres

L'outil accepte ces paramètres :

- `command` (requis) : La commande CLI à exécuter. Doit être valide pour le système d'exploitation de l'utilisateur.
- `cwd` (optionnel) : Le répertoire de travail pour exécuter la commande. Si non fourni, le répertoire de travail actuel est utilisé.

## Ce qu'il fait

Cet outil exécute des commandes de terminal directement sur le système de l'utilisateur, permettant une large gamme d'opérations depuis les manipulations de fichiers jusqu'au lancement de serveurs de développement. Les commandes s'exécutent dans des instances de terminal gérées avec capture de sortie en temps réel, intégrées au système de terminal de VS Code pour une performance et sécurité optimales.

## Quand est-il utilisé ?

- Quand on installe les dépendances du projet (npm install, pip install, etc.)
- Quand on construit ou compile du code (make, npm run build, etc.)
- Quand on démarre des serveurs de développement ou des applications
- Quand on initialise de nouveaux projets (git init, npm init, etc.)
- Quand on effectue des opérations de fichiers au-delà de ce que d'autres outils fournissent
- Quand on exécute des tests ou des opérations de linting
- Quand on a besoin d'exécuter des commandes spécialisées pour des technologies spécifiques

## Fonctionnalités Clés

- S'intègre avec l'API shell de VS Code pour une exécution de terminal fiable
- Réutilise les instances de terminal quand possible à travers un système de registre
- Capture la sortie de commande ligne par ligne avec retour en temps réel
- Supporte les commandes de longue durée qui continuent en arrière-plan
- Permet la spécification de répertoires de travail personnalisés
- Maintient l'historique et l'état de terminal à travers les exécutions de commande
- Gère les chaînes de commande complexes appropriées pour le shell de l'utilisateur
- Fournit un statut détaillé de complétion de commande et l'interprétation des codes de sortie
- Supporte les applications de terminal interactives avec boucle de retour utilisateur
- Affiche les terminal pendant l'exécution pour la transparence
- Valide les commandes pour la sécurité en utilisant l'analyse shell-quote
- Bloque les motifs d'exécution de sous-shell potentiellement dangereux
- S'intègre avec le système KiloCodeIgnore pour le contrôle d'accès aux fichiers
- Gère les séquences d'échappement de terminal pour une sortie propre

## Limitations

- L'accès aux commandes peut être restreint par les règles KiloCodeIgnore et les validations de sécurité
- Les commandes avec des exigences de permission élevée peuvent requérir une configuration utilisateur
- Le comportement peut varier à travers les systèmes d'exploitation pour certaines commandes
- Les commandes de très longue durée peuvent requérir une gestion spécifique
- Les chemins de fichiers devraient être correctement échappés selon les règles du shell OS
- Toutes les fonctionnalités de terminal peuvent ne pas fonctionner avec des scénarios de développement distant

## Comment ça fonctionne

Quand l'outil `execute_command` est invoqué, il suit ce processus :

1. **Validation de Commande et Contrôles de Sécurité** :

    - Analyse la commande en utilisant shell-quote pour identifier les composants
    - Valide contre les restrictions de sécurité (utilisation de sous-shell, fichiers restreints)
    - Vérifie contre les règles KiloCodeIgnore pour les permissions d'accès aux fichiers
    - S'assure que la commande répond aux exigences de sécurité système

2. **Gestion de Terminal** :

    - Obtient ou crée un terminal via TerminalRegistry
    - Configure le contexte de répertoire de travail
    - Prépare les détecteurs d'événements pour la capture de sortie
    - Affiche le terminal pour la visibilité utilisateur

3. **Exécution et Surveillance de Commande** :

    - Exécute via l'API shellIntegration de VS Code
    - Capture la sortie avec traitement de séquences d'échappement
    - Limite la gestion de sortie (intervalles de 100ms)
    - Surveille la complétion de commande ou les erreurs
    - Détecte les processus "chauds" comme les compilateurs pour une gestion spéciale

4. **Traitement de Résultats** :
    - Supprime les séquences d'échappement ANSI/VS Code pour une sortie propre
    - Interprète les codes de sortie avec informations de signal détaillées
    - Met à jour le suivi de répertoire de travail si changé par la commande
    - Fournit le statut de commande avec contexte approprié

## Détails d'Implémentation de Terminal

L'outil utilise un système de gestion de terminal sophistiqué :

1. **Première Priorité : Réutilisation de Terminal**

    - Le TerminalRegistry essaie de réutiliser les terminaux existants quand possible
    - Ceci réduit la prolifération d'instances de terminal et améliore la performance
    - L'état de terminal (répertoire de travail, historique) est préservé à travers les commandes

2. **Deuxième Priorité : Validation de Sécurité**

    - Les commandes sont analysées en utilisant shell-quote pour l'analyse de composants
    - Les motifs dangereux comme `$(...)` et backticks sont bloqués
    - Les commandes sont vérifiées contre les règles KiloCodeIgnore pour le contrôle d'accès aux fichiers
    - Un système d'autorisation basé sur préfixe valide les motifs de commande

3. **Optimisations de Performance**

    - La sortie est traitée dans des intervalles limités de 100ms pour prévenir la surcharge UI
    - La gestion de tampon zero-copy utilise le suivi basé sur index pour l'efficacité
    - Gestion spéciale pour la compilation et les processus "chauds"
    - Optimisations spécifiques à la plateforme pour Windows PowerShell

4. **Gestion d'Erreur et de Signal**
    - Les codes de sortie sont mappés à des informations de signal détaillées (SIGTERM, SIGKILL, etc.)
    - Détection de dump core pour les échecs critiques
    - Les changements de répertoire de travail sont suivis et gérés automatiquement
    - Récupération propre des scénarios de déconnexion de terminal

## Exemples d'Utilisation

- Quand on configure un nouveau projet, Kilo Code exécute des commandes d'initialisation comme `npm init -y` suivies de l'installation de dépendances.
- Quand on construit une application web, Kilo Code exécute des commandes de build comme `npm run build` pour compiler les assets.
- Quand on déploie du code, Kilo Code exécute des commandes git pour commiter et pousser les changements vers un dépôt.
- Quand on dépannage, Kilo Code exécute des commandes de diagnostic pour rassembler des informations système.
- Quand on démarre un serveur de développement, Kilo Code lance la commande de serveur appropriée (par ex., `npm start`).
- Quand on exécute des tests, Kilo Code exécute la commande de runner de test pour le framework de test du projet.

## Exemples d'Usage

Exécuter une commande simple dans le répertoire actuel :

```
<execute_command>
<command>npm run dev</command>
</execute_command>
```

Installer les dépendances pour un projet :

```
<execute_command>
<command>npm install express mongodb mongoose dotenv</command>
</execute_command>
```

Exécuter plusieurs commandes en séquence :

```
<execute_command>
<command>mkdir -p src/components && touch src/components/App.js</command>
</execute_command>
```

Exécuter une commande dans un répertoire spécifique :

```
<execute_command>
<command>git status</command>
<cwd>./my-project</cwd>
</execute_command>
```

Construire puis démarrer un projet :

```
<execute_command>
<command>npm run build && npm start</command>
</execute_command>
```
