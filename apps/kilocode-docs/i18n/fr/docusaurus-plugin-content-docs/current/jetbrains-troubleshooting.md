# Dépannage du Plugin JetBrains

Ce guide couvre les problèmes courants lors de l'utilisation de Kilo Code dans les IDE JetBrains (IntelliJ IDEA, Android Studio, WebStorm, PyCharm, etc.).

## Fonctionnalités Manquantes Connues

Les fonctionnalités suivantes, disponibles dans la version VS Code de Kilo Code, ne sont actuellement pas implémentées dans la version JetBrains :

- **Autocomplétion/Tâches Rapides**
- **Génération de Messages de Commit Git** Cette fonctionnalité est manquante mais sera ajoutée bientôt !

Nous travaillons activement à atteindre la parité des fonctionnalités entre les versions VS Code et JetBrains. Consultez notre [dépôt GitHub](https://github.com/Kilo-Org/kilocode) pour des mises à jour sur les progrès du développement.

## Exigences Node.js

### Pourquoi Node.js est Requis

L'extension Kilo pour JetBrains nécessite que Node.js soit installé sur votre système. Node.js est utilisé pour exécuter les services backend de l'extension et gérer la communication entre l'IDE et les fonctionnalités IA de Kilo Code.

### Installation de Node.js

Visitez le site web officiel de Node.js pour les instructions d'installation pour votre plateforme : [https://nodejs.org/en/download](https://nodejs.org/en/download)

Nous recommandons de télécharger la version **LTS (Long Term Support)** pour la stabilité.

### Vérification de l'installation de Node.js

Après l'installation, vérifiez que Node.js est correctement installé en ouvrant un terminal et en exécutant :

```bash
node --version
npm --version
```

Les deux commandes devraient retourner des numéros de version.

## Problèmes JCEF (Java Chromium Embedded Framework)

### Qu'est-ce que JCEF ?

JCEF (Java Chromium Embedded Framework) est requis pour que l'interface web de Kilo Code s'affiche correctement dans les IDE JetBrains. La plupart des IDE JetBrains incluent le support JCEF par défaut, mais certaines configurations peuvent nécessiter une activation manuelle.

## Correction des Problèmes JCEF par IDE

### Android Studio

JCEF est disponible dans Android Studio mais peut nécessiter une activation manuelle :

1. **Ouvrir Settings/Preferences :**

    - **Windows/Linux :** Fichier → Settings
    - **macOS :** Aide → Find Action...

2. **Naviguer vers Boot Java Runtime :**

    - Choisir Boot Java Runtime for the IDE...

3. **Choisir un nouveau runtime**

    - Choisissez-en un qui a "with JCEF" dans le nom

4. **Redémarrer Android Studio :**

    - Fermez et rouvrez Android Studio pour que les changements prennent effet

5. **Vérifier :**
    - Ouvrez le panneau Kilo Code
    - L'avertissement JCEF devrait avoir disparu, et l'interface devrait se charger correctement

**Guide Visuel :**

<img src="/docs/img/jetbrains/android-studio-jcef-enable.gif" alt="Guide étape par étape montrant comment activer JCEF dans Android Studio" width="600" />

_Cette animation montre le processus complet d'activation de JCEF dans Android Studio._

### IntelliJ IDEA

JCEF devrait être activé par défaut dans IntelliJ IDEA. Si vous voyez des avertissements JCEF :

1. **Mettre à jour IntelliJ IDEA :**

    - Assurez-vous d'exécuter la dernière version
    - Allez dans Aide → Check for Updates

2. **Vérifier JetBrains Runtime :**

    - IntelliJ IDEA devrait utiliser JetBrains Runtime (JBR) par défaut
    - JBR inclut le support JCEF

3. **Vérifier les Paramètres Avancés :**
    - Allez dans Fichier → Settings (Windows/Linux) ou IntelliJ IDEA → Preferences (macOS)
    - Naviguez vers Advanced Settings
    - Recherchez toutes les options liées à JCEF et assurez-vous qu'elles sont activées

### Autres IDE JetBrains

Pour WebStorm, PyCharm, PhpStorm, RubyMine, CLion, GoLand, DataGrip, et Rider :

1. **Mettre à jour vers la Dernière Version :**

    - La plupart des problèmes JCEF sont résolus dans les versions récentes
    - Utilisez le mise à jour intégré : Aide → Check for Updates

2. **Vérifier JetBrains Runtime :**

    - Ces IDE devraient utiliser JetBrains Runtime par défaut
    - JBR inclut un support JCEF complet

3. **Vérifier les Paramètres :**
    - Allez dans Fichier → Settings (Windows/Linux) ou [Nom de l'IDE] → Preferences (macOS)
    - Naviguez vers Advanced Settings
    - Activez toutes les options liées à JCEF

_Pour le support et la documentation généraux de Kilo Code, visitez [kilocode.ai/docs](https://kilocode.ai/docs)_
