---
title: Importer, Exporter et Réinitialiser les Paramètres
sidebar_label: Importer/Exporter/Réinitialiser les Paramètres
description: Gérez vos paramètres Kilo Code en les exportant, important ou en les réinitialisant aux valeurs par défaut.
---

# Importer, Exporter et Réinitialiser les Paramètres

Kilo Code vous permet de gérer efficacement vos paramètres de configuration à travers les options d'exportation, importation et réinitialisation. Ces fonctionnalités sont utiles pour sauvegarder votre configuration, partager les configurations avec d'autres, ou restaurer les paramètres par défaut si nécessaire.

Vous pouvez trouver ces options en bas de la page des paramètres Kilo Code, accessible via l'icône d'engrenage (<i class="codicon codicon-gear"></i>) dans la vue de chat Kilo Code.

<img src="/docs/img/settings-management/settings-management.png" alt="Boutons d'Exportation, d'Importation et de Réinitialisation dans les paramètres Kilo Code" width="400" />
*Image : Boutons d'Exportation, d'Importation et de Réinitialisation.*

## Exporter les Paramètres

Cliquer sur le bouton **Exporter** sauvegarde vos paramètres Kilo Code actuels dans un fichier JSON.

- **Ce qui est Exporté :** Le fichier inclut vos Profils de Fournisseur API Configurés et Paramètres Globaux (préférences UI, configurations de mode, paramètres de contexte, etc.).
- **Avertissement de Sécurité :** Le fichier JSON exporté contient **TOUS** vos Profils de Fournisseur API Configurés et Paramètres Globaux. Crucialement, cela inclut **les clés API en texte clair**. Traitez ce fichier comme hautement sensible. Ne le partagez pas publiquement ou avec des individus non dignes de confiance, car cela donne accès à vos comptes API.
- **Processus :**
    1.  Cliquez sur **Exporter**.
    2.  Une boîte de dialogue de sauvegarde de fichier apparaît, suggérant `kilo-code-settings.json` comme nom de fichier (habituellement dans votre dossier `~/Documents`).
    3.  Choisissez un emplacement et sauvegardez le fichier.

Cela crée une sauvegarde de votre configuration ou un fichier que vous pouvez partager.

## Importer les Paramètres

Cliquer sur le bouton **Importer** vous permet de charger les paramètres depuis un fichier JSON précédemment exporté.

- **Processus :**
    1.  Cliquez sur **Importer**.
    2.  Une boîte de dialogue d'ouverture de fichier apparaît. Sélectionnez le fichier `kilo-code-settings.json` (ou fichier nommé de manière similaire) que vous voulez importer.
    3.  Kilo Code lit le fichier, valide son contenu contre le schéma attendu, et applique les paramètres.
- **Fusion :** Importer les paramètres **fusionne** les configurations. Il ajoute de nouveaux profils API et met à jour les existants et les paramètres globaux basés sur le contenu du fichier. Il ne **supprime pas** les configurations présentes dans votre configuration actuelle mais manquantes du fichier importé.
- **Validation :** Seuls les paramètres valides correspondant au schéma interne peuvent être importés, prévenant les erreurs de configuration. Une notification de succès apparaît à la complétion.

## Réinitialiser les Paramètres

Cliquer sur le bouton **Réinitialiser** efface complètement toutes les données de configuration Kilo Code et retourne l'extension à son état par défaut. C'est une action destructive destinée au dépannage ou pour recommencer à zéro.

- **Avertissement :** Cette action est **irréversible**. Elle supprime définitivement toutes les configurations API (incluant les clés stockées dans le stockage secret), les modes personnalisés, les paramètres globaux, et l'historique des tâches.

- **Processus :**

    1.  Cliquez sur le bouton **Réinitialiser** rouge.
    2.  Une boîte de dialogue de confirmation apparaît, avertissant que l'action ne peut pas être annulée.
    3.  Cliquez sur "Oui" pour confirmer.

- **Ce qui est Réinitialisé :**

    - **Profils de Fournisseur API :** Toutes les configurations sont supprimées des paramètres et du stockage secret.
    - **Paramètres Globaux :** Toutes les préférences (UI, modes, approbations, navigateur, etc.) sont réinitialisées aux valeurs par défaut.
    - **Modes Personnalisés :** Tous les modes définis par l'utilisateur sont supprimés.
    - **Stockage Secret :** Toutes les clés API et autres secrets gérés par Kilo Code sont effacés.
    - **Historique des Tâches :** La pile de tâches actuelle est effacée.

- **Résultat :** Kilo Code retourne à son état initial, comme s'il était nouvellement installé, avec les paramètres par défaut et aucune configuration utilisateur.

Utilisez cette option seulement si vous êtes certain de vouloir supprimer toutes les données Kilo Code ou si cela vous est demandé pendant le dépannage. Considérez exporter vos paramètres d'abord si vous pourriez vouloir les restaurer plus tard.
