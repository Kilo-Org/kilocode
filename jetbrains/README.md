# JetBrains Plugin Development Setup

This directory contains the JetBrains plugin implementation for Kilo Code, including both the IntelliJ plugin (Kotlin) and the Extension Host (Node.js/TypeScript).

## Prerequisites

Before building the JetBrains plugin, ensure all dependencies are properly configured. Use the provided dependency check script to verify your setup.

### Required Dependencies

#### 1. Java Development Kit (JDK) 21

- **Required Version**: Java 21 (LTS)
- **Why**: The plugin build system requires Java 21 for compilation and runtime compatibility
- **Recommended Installation** (SDKMAN - works on macOS/Linux):

    ```bash
    # Install SDKMAN
    curl -s "https://get.sdkman.io" | bash
    source ~/.sdkman/bin/sdkman-init.sh

    # Install and use Java 21
    sdk install java 21.0.5-tem
    sdk use java 21.0.5-tem
    ```

- **Alternative Installation**:
    - macOS: `brew install openjdk@21`
    - Linux: `sudo apt install openjdk-21-jdk` or equivalent
    - Windows: Download from [Oracle](https://www.oracle.com/java/technologies/javase/jdk21-archive-downloads.html) or [OpenJDK](https://openjdk.org/projects/jdk/21/)

#### 2. VSCode Submodule

- **Location**: `deps/vscode/`
- **Purpose**: Provides VSCode runtime dependencies and APIs for the Extension Host
- **Initialization**: Must be initialized before building

#### 3. Node.js and pnpm

- **Node.js**: Version 20.x (as specified in package.json)
- **pnpm**: For workspace management and dependency installation

## Quick Setup

The dependency check runs automatically as part of the build process, but you can also run it manually:

```bash
# Run dependency check manually
./jetbrains/scripts/check-dependencies.sh

# Or as part of JetBrains host build process
cd jetbrains/host && pnpm run deps:check
```

**Note**: The dependency check is automatically integrated into the Turbo build system and runs before JetBrains builds to ensure all dependencies are properly configured.

### Quick Fixes for Common Issues

- **"Unsupported class file major version 68"**: [Install Java 21](#java-version-issues)
- **"slice is not valid mach-o file"**: [Rebuild native modules](#native-module-architecture-mismatch)
- **"platform.zip file does not exist"**: [Generate platform files](#missing-platformzip)

## Manual Setup

If you prefer to set up dependencies manually:

### 1. Initialize VSCode Submodule

```bash
# From project root
git submodule update --init --recursive
```

### 2. Verify Java Version

```bash
java -version
# Should show Java 21.x.x

javac -version
# Should show javac 21.x.x
```

### 3. Install Node Dependencies

```bash
# From project root
pnpm install
```

## Project Structure

```
jetbrains/
├── host/                    # Extension Host (Node.js/TypeScript)
│   ├── src/                # TypeScript source code
│   ├── package.json        # Node.js dependencies
│   ├── tsconfig.json       # TypeScript configuration
│   └── turbo.json          # Turbo build configuration
├── plugin/                 # IntelliJ Plugin (Kotlin/Java)
│   ├── src/main/kotlin/    # Kotlin source code
│   ├── src/main/resources/ # Plugin resources and themes
│   ├── build.gradle.kts    # Gradle build configuration
│   ├── gradle.properties   # Plugin version and platform settings
│   ├── genPlatform.gradle  # VSCode platform generation
│   └── scripts/            # Build and utility scripts
├── resources/              # Runtime resources (generated)
└── README.md              # This file
```

## Build Modes

The plugin supports three build modes controlled by the `debugMode` property:

### 1. Development Mode (`debugMode=idea`)

```bash
./gradlew prepareSandbox -PdebugMode=idea
```

- Used for local development and debugging
- Creates `.env` file for Extension Host
- Copies theme resources to debug location
- Enables hot-reloading for VSCode plugin integration

### 2. Release Mode (`debugMode=release`)

```bash
./gradlew prepareSandbox -PdebugMode=release
```

- Used for production builds
- Requires `platform.zip` file (generated via `genPlatform` task)
- Creates fully self-contained deployment package
- Includes all runtime dependencies and node_modules

### 3. Lightweight Mode (`debugMode=none`, default)

```bash
./gradlew prepareSandbox
```

- Used for testing and CI
- Minimal resource preparation
- No VSCode runtime dependencies
- Suitable for static analysis and unit tests

## Building the Plugin

### Development Build

```bash
# From project root
pnpm jetbrains:run

# Or manually:
cd jetbrains/plugin
./gradlew runIde -PdebugMode=idea
```

### Production Build

```bash
# Generate platform files first (if needed)
cd jetbrains/plugin
./gradlew genPlatform

# Build plugin
./gradlew buildPlugin -PdebugMode=release
```

### Extension Host Only

```bash
# From jetbrains/host directory
pnpm build

# Or with Turbo from project root
pnpm --filter @kilo-code/jetbrains-host build
```

## Turbo Integration

The project uses Turborepo for efficient builds and caching:

- **`jetbrains:bundle`**: Builds the complete plugin bundle
- **`jetbrains:run-bundle`**: Runs the plugin with bundle mode
- **`jetbrains:run`**: Runs the plugin in development mode

Turbo automatically handles:

- VSCode submodule initialization (`deps:check`)
- Dependency patching (`deps:patch`)
- Build caching and parallelization

## Common Issues and Troubleshooting

### Java Version Issues

**Problem**: Build fails with "Unsupported class file major version 68" or similar Java version errors
**Root Cause**: Running Java 24+ instead of required Java 21

**Solution**:

#### Option 1: Using SDKMAN (Recommended for macOS/Linux)

```bash
# Install SDKMAN if not already installed
curl -s "https://get.sdkman.io" | bash
source ~/.sdkman/bin/sdkman-init.sh

# Install and use Java 21
sdk install java 21.0.5-tem
sdk use java 21.0.5-tem

# Make Java 21 default (optional)
sdk default java 21.0.5-tem

# Verify version
java -version  # Should show OpenJDK 21.x.x
```

#### Option 2: Using Homebrew (macOS Alternative)

```bash
# Install Java 21
brew install openjdk@21

# Set JAVA_HOME for current session
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home

# Add to shell profile for persistence
echo 'export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' >> ~/.zshrc

# Verify version
java -version
```

#### Option 3: Manual JAVA_HOME Setup

```bash
# Find Java 21 installation
/usr/libexec/java_home -V

# Set JAVA_HOME to Java 21 path
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

### VSCode Submodule Not Initialized

**Problem**: Build fails with missing VSCode dependencies
**Solution**:

```bash
# Initialize submodule
git submodule update --init --recursive

# Verify submodule is populated
ls deps/vscode/src  # Should contain VSCode source files
```

### Missing platform.zip

**Problem**: Release build fails with "platform.zip file does not exist"
**Solution**:

```bash
cd jetbrains/plugin
./gradlew genPlatform  # This will download and generate platform.zip
```

### Node.js Version Mismatch

**Problem**: Extension Host build fails with Node.js compatibility errors
**Solution**:

```bash
# Use Node.js 20.x
nvm use 20  # if using nvm
# or
node --version  # should show v20.x.x
```

### Native Module Architecture Mismatch

**Problem**: Plugin fails to load with "slice is not valid mach-o file" errors for native modules like `@vscode/spdlog` or `native-watchdog`
**Root Cause**: Native Node.js modules were compiled for wrong CPU architecture (e.g., x86_64 vs ARM64)

**Solution**:

```bash
# Navigate to resources directory and rebuild native modules
cd jetbrains/resources

# Clean existing modules
rm -rf node_modules package-lock.json

# Copy package.json from host
cp ../host/package.json .

# Install dependencies with npm (not pnpm to avoid workspace conflicts)
npm install

# Verify native modules are built for correct architecture
file node_modules/@vscode/spdlog/build/Release/spdlog.node
file node_modules/native-watchdog/build/Release/watchdog.node
# Should show "Mach-O 64-bit bundle arm64" on Apple Silicon or appropriate arch

# Update production dependency list
cd ../plugin
npm ls --omit=dev --all --parseable --prefix ../resources > ./prodDep.txt

# Rebuild plugin
./gradlew buildPlugin -PdebugMode=none
```

**Prevention**: When updating dependencies or switching architectures, always rebuild native modules in the `jetbrains/resources/` directory.

### Gradle Build Issues

**Problem**: Gradle tasks fail or hang
**Solution**:

```bash
# Clean and rebuild
./gradlew clean
./gradlew build --refresh-dependencies

# Check Gradle daemon
./gradlew --stop
./gradlew build
```

## Development Workflow

1. **Initial Setup**: Dependencies are automatically checked when you run any JetBrains build command
2. **Development**: Use `pnpm jetbrains:run` for live development (includes automatic dependency check)
3. **Testing**: Build with `debugMode=none` for CI/testing
4. **Release**: Generate platform files and build with `debugMode=release`

**Automatic Dependency Management**: The build system now automatically verifies and sets up all required dependencies (Java 21, VSCode submodule, Node.js, etc.) before each build, ensuring a smooth development experience.

## Environment Variables

The plugin respects these environment variables:

- `JAVA_HOME`: Java installation directory
- `debugMode`: Build mode (idea/release/none)
- `vscodePlugin`: Plugin name (default: kilocode)
- `vscodeVersion`: VSCode version for platform generation (default: 1.100.0)

## Platform Support

The plugin supports multiple platforms through the platform generation system:

- **Windows**: x64
- **macOS**: x64 and ARM64 (Apple Silicon)
- **Linux**: x64

Platform-specific dependencies are automatically handled during the build process.

**Multi-Architecture Support**: The platform generation system now includes enhanced architecture-aware native module handling, automatically creating runtime loaders that detect the current platform and load the correct native modules for each architecture.

## Contributing

When making changes to the JetBrains plugin:

1. Ensure all dependencies are properly set up
2. Test in development mode first (`debugMode=idea`)
3. Verify builds work in all three modes
4. Update this README if adding new dependencies or requirements
5. Run the dependency check script to validate setup

## Scripts

- `jetbrains/scripts/check-dependencies.sh`: Comprehensive dependency verification and setup
- `jetbrains/plugin/scripts/sync_version.js`: Version synchronization utility

For more detailed build information, see the individual `package.json` and `build.gradle.kts` files in the respective directories.
