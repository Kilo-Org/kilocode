# Configuration de Développement de Plugin JetBrains

Ce répertoire contient l'implémentation du plugin JetBrains pour Kilo Code, incluant à la fois le plugin IntelliJ (Kotlin) et l'Extension Host (Node.js/TypeScript).

## Prérequis

Avant de construire le plugin JetBrains, assurez-vous que toutes les dépendances sont correctement configurées. Utilisez le script de vérification des dépendances fourni pour valider votre configuration.

### Dépendances Requises

#### 1. Java Development Kit (JDK) 17

- **Version Requise** : Java 17 (LTS)
- **Pourquoi** : Le système de build du plugin nécessite Java 17 pour la compatibilité de compilation et d'exécution
- **Installation Recommandée** (SDKMAN - fonctionne sur macOS/Linux) :

    ```bash
    # Installer SDKMAN
    curl -s "https://get.sdkman.io" | bash
    source ~/.sdkman/bin/sdkman-init.sh

    # Installer et utiliser Java 17
    sdk install java 17.0.12-tem
    sdk use java 17.0.12-tem
    ```

- **Installation Alternative** :
    - macOS : `brew install openjdk@17`
    - Linux : `sudo apt install openjdk-17-jdk` ou équivalent
    - Windows : Télécharger depuis [Oracle](https://www.oracle.com/java/technologies/javase/jdk17-archive-downloads.html) ou [OpenJDK](https://openjdk.org/projects/jdk/17/)

#### 2. Sous-module VSCode

- **Emplacement** : `deps/vscode/`
- **Objectif** : Fournit les dépendances d'exécution VSCode et les API pour l'Extension Host
- **Initialisation** : Doit être initialisé avant la construction

#### 3. Node.js et pnpm

- **Node.js** : Version 20.x (comme spécifié dans package.json)
- **pnpm** : Pour la gestion de l'espace de travail et l'installation des dépendances

## Configuration Rapide

La vérification des dépendances s'exécute automatiquement dans le cadre du processus de build, mais vous pouvez aussi l'exécuter manuellement :

```bash
# Exécuter la vérification des dépendances manuellement
./jetbrains/scripts/check-dependencies.sh

# Ou dans le cadre du processus de build JetBrains host
cd jetbrains/host && pnpm run deps:check
```

**Note** : La vérification des dépendances est automatiquement intégrée dans le système de build Turbo et s'exécute avant les builds JetBrains pour garantir que toutes les dépendances sont correctement configurées.

### Corrections Rapides pour Problèmes Courants

- **"Unsupported class file major version 68"** : [Installer Java 17](#problèmes-de-version-java)
- **"slice is not valid mach-o file"** : [Reconstruire les modules natifs](#incompatibilité-darchitecture-des-modules-natifs)
- **"platform.zip file does not exist"** : [Générer les fichiers de plateforme](#platformzip-manquant)

## Configuration Manuelle

Si vous préférez configurer les dépendances manuellement :

### 1. Initialiser le Sous-module VSCode

```bash
# Depuis la racine du projet
git submodule update --init --recursive
```

### 2. Vérifier la Version Java

```bash
java -version
# Devrait afficher Java 17.x.x

javac -version
# Devrait afficher javac 17.x.x
```

### 3. Installer les Dépendances Node

```bash
# Depuis la racine du projet
pnpm install
```

## Structure du Projet

```
jetbrains/
├── host/                    # Extension Host (Node.js/TypeScript)
│   ├── src/                # Code source TypeScript
│   ├── package.json        # Dépendances Node.js
│   ├── tsconfig.json       # Configuration TypeScript
│   └── turbo.json          # Configuration de build Turbo
├── plugin/                 # Plugin IntelliJ (Kotlin/Java)
│   ├── src/main/kotlin/    # Code source Kotlin
│   ├── src/main/resources/ # Ressources du plugin et thèmes
│   ├── build.gradle.kts    # Configuration de build Gradle
│   ├── gradle.properties   # Version du plugin et paramètres de plateforme
│   ├── genPlatform.gradle  # Génération de plateforme VSCode
│   └── scripts/            # Scripts de build et utilitaires
├── resources/              # Ressources d'exécution (générées)
└── README.md              # Ce fichier
```

## Modes de Build

Le plugin prend en charge trois modes de build contrôlés par la propriété `debugMode` :

### 1. Mode Développement (`debugMode=idea`)

```bash
./gradlew prepareSandbox -PdebugMode=idea
```

- Utilisé pour le développement local et le débogage
- Crée un fichier `.env` pour l'Extension Host
- Copie les ressources de thème vers l'emplacement de débogage
- Active le rechargement à chaud pour l'intégration du plugin VSCode

### 2. Mode Release (`debugMode=release`)

```bash
./gradlew prepareSandbox -PdebugMode=release
```

- Utilisé pour les builds de production
- Nécessite le fichier `platform.zip` (généré via la tâche `genPlatform`)
- Crée un package de déploiement entièrement autonome
- Inclut toutes les dépendances d'exécution et node_modules

### 3. Mode Léger (`debugMode=none`, par défaut)

```bash
./gradlew prepareSandbox
```

- Utilisé pour les tests et l'intégration continue
- Préparation minimale des ressources
- Aucune dépendance d'exécution VSCode
- Adapté pour l'analyse statique et les tests unitaires

## Construction du Plugin

### Build de Développement

```bash
# Depuis la racine du projet
pnpm jetbrains:run

# Ou manuellement :
cd jetbrains/plugin
./gradlew runIde -PdebugMode=idea
```

### Build de Production

```bash
# Générer d'abord les fichiers de plateforme (si nécessaire)
cd jetbrains/plugin
./gradlew genPlatform

# Construire le plugin
./gradlew buildPlugin -PdebugMode=release
```

### Extension Host Seulement

```bash
# Depuis le répertoire jetbrains/host
pnpm build

# Ou avec Turbo depuis la racine du projet
pnpm --filter @kilo-code/jetbrains-host build
```

## Intégration Turbo

Le projet utilise Turborepo pour des builds efficaces et la mise en cache :

- **`jetbrains:bundle`** : Construit le bundle complet du plugin
- **`jetbrains:run-bundle`** : Exécute le plugin en mode bundle
- **`jetbrains:run`** : Exécute le plugin en mode développement

Turbo gère automatiquement :

- L'initialisation du sous-module VSCode (`deps:check`)
- Le patch des dépendances (`deps:patch`)
- La mise en cache et la parallélisation des builds

## Problèmes Courants et Dépannage

### Problèmes de Version Java

**Problème** : Le build échoue avec "Unsupported class file major version 68" ou des erreurs similaires de version Java
**Cause Racine** : Exécution de Java 24+ au lieu du Java 17 requis

**Solution** :

#### Option 1 : Utiliser SDKMAN (Recommandé pour macOS/Linux)

```bash
# Installer SDKMAN si pas déjà installé
curl -s "https://get.sdkman.io" | bash
source ~/.sdkman/bin/sdkman-init.sh

# Installer et utiliser Java 17
sdk install java 17.0.12-tem
sdk use java 17.0.12-tem

# Rendre Java 17 par défaut (optionnel)
sdk default java 17.0.12-tem

# Vérifier la version
java -version  # Devrait afficher OpenJDK 17.x.x
```

#### Option 2 : Utiliser Homebrew (Alternative macOS)

```bash
# Installer Java 17
brew install openjdk@17

# Définir JAVA_HOME pour la session actuelle
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

# Ajouter au profil du shell pour la persistance
echo 'export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home' >> ~/.zshrc

# Vérifier la version
java -version
```

#### Option 3 : Configuration Manuel de JAVA_HOME

```bash
# Trouver l'installation Java 17
/usr/libexec/java_home -V

# Définir JAVA_HOME vers le chemin Java 17
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
```

### Sous-module VSCode Non Initialisé

**Problème** : Le build échoue avec des dépendances VSCode manquantes
**Solution** :

```bash
# Initialiser le sous-module
git submodule update --init --recursive

# Vérifier que le sous-module est peuplé
ls deps/vscode/src  # Devrait contenir les fichiers source VSCode
```

### platform.zip Manquant

**Problème** : Le build de release échoue avec "platform.zip file does not exist"
**Solution** :

```bash
cd jetbrains/plugin
./gradlew genPlatform  # Ceci va télécharger et générer platform.zip
```

### Incompatibilité de Version Node.js

**Problème** : Le build de l'Extension Host échoue avec des erreurs de compatibilité Node.js
**Solution** :

```bash
# Utiliser Node.js 20.x
nvm use 20  # si vous utilisez nvm
# ou
node --version  # devrait afficher v20.x.x
```

### Incompatibilité d'Architecture des Modules Natifs

**Problème** : Le plugin échoue à se charger avec des erreurs "slice is not valid mach-o file" pour les modules natifs comme `@vscode/spdlog` ou `native-watchdog`
**Cause Racine** : Les modules natifs Node.js ont été compilés pour la mauvaise architecture CPU (par exemple, x86_64 vs ARM64)

**Solution** :

```bash
# Naviguer vers le répertoire resources et reconstruire les modules natifs
cd jetbrains/resources

# Nettoyer les modules existants
rm -rf node_modules package-lock.json

# Copier package.json depuis host
cp ../host/package.json .

# Installer les dépendances avec npm (pas pnpm pour éviter les conflits d'espace de travail)
npm install

# Vérifier que les modules natifs sont construits pour la bonne architecture
file node_modules/@vscode/spdlog/build/Release/spdlog.node
file node_modules/native-watchdog/build/Release/watchdog.node
# Devrait afficher "Mach-O 64-bit bundle arm64" sur Apple Silicon ou l'architecture appropriée

# Mettre à jour la liste des dépendances de production
cd ../plugin
npm ls --omit=dev --all --parseable --prefix ../resources > ./prodDep.txt

# Reconstruire le plugin
./gradlew buildPlugin -PdebugMode=none
```

**Prévention** : Lors de la mise à jour des dépendances ou du changement d'architecture, reconstruisez toujours les modules natifs dans le répertoire `jetbrains/resources/`.

### Problèmes de Build Gradle

**Problème** : Les tâches Gradle échouent ou se bloquent
**Solution** :

```bash
# Nettoyer et reconstruire
./gradlew clean
./gradlew build --refresh-dependencies

# Vérifier le démon Gradle
./gradlew --stop
./gradlew build
```

## Workflow de Développement

1. **Configuration Initiale** : Les dépendances sont automatiquement vérifiées lorsque vous exécutez n'importe quelle commande de build JetBrains
2. **Développement** : Utilisez `pnpm jetbrains:run` pour le développement en direct (inclut la vérification automatique des dépendances)
3. **Tests** : Build avec `debugMode=none` pour l'intégration continue/les tests
4. **Release** : Générez les fichiers de plateforme et build avec `debugMode=release`

**Gestion Automatique des Dépendances** : Le système de build vérifie et configure maintenant automatiquement toutes les dépendances requises (Java 17, sous-module VSCode, Node.js, etc.) avant chaque build, garantissant une expérience de développement fluide.

## Variables d'Environnement

Le plugin respecte ces variables d'environnement :

- `JAVA_HOME` : Répertoire d'installation Java
- `debugMode` : Mode de build (idea/release/none)
- `vscodePlugin` : Nom du plugin (par défaut : kilocode)
- `vscodeVersion` : Version VSCode pour la génération de plateforme (par défaut : 1.100.0)

## Support de Plateforme

Le plugin prend en charge plusieurs plateformes via le système de génération de plateforme :

- **Windows** : x64
- **macOS** : x64 et ARM64 (Apple Silicon)
- **Linux** : x64

Les dépendances spécifiques à la plateforme sont automatiquement gérées durant le processus de build.

**Support Multi-Architecture** : Le système de génération de plateforme inclut maintenant une gestion améliorée des modules natifs consciente de l'architecture, créant automatiquement des chargeurs d'exécution qui détectent la plateforme actuelle et chargent les modules natifs corrects pour chaque architecture.

## Contribution

Lors de modifications au plugin JetBrains :

1. Assurez-vous que toutes les dépendances sont correctement configurées
2. Testez d'abord en mode développement (`debugMode=idea`)
3. Vérifiez que les builds fonctionnent dans les trois modes
4. Mettez à jour ce README si vous ajoutez de nouvelles dépendances ou exigences
5. Exécutez le script de vérification des dépendances pour valider la configuration

## Scripts

- `jetbrains/scripts/check-dependencies.sh` : Vérification et configuration complètes des dépendances
- `jetbrains/plugin/scripts/sync_version.js` : Utilitaire de synchronisation de version

Pour plus d'informations détaillées sur le build, consultez les fichiers `package.json` et `build.gradle.kts` individuels dans les répertoires respectifs.
