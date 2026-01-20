#!/bin/bash

build_extension() {
  echo "🔨 Building the Kilo Code extension..."
  pnpm -w vsix -- --out ../bin/kilo-code-$(git rev-parse --short HEAD).vsix || exit 1
  code --install-extension ../../bin/kilo-code-$(git rev-parse --short HEAD).vsix || exit 1
  cd evals
}

check_docker_services() {
  echo "🐳 Checking Docker services..."

  if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop and try again."
    exit 1
  fi

  if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
  fi

  if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please ensure Docker Desktop is properly installed."
    exit 1
  fi

  local services_to_start=()

  if ! nc -z localhost 5432 2>/dev/null; then
    echo "📦 PostgreSQL not running on port 5432"
    services_to_start+=("db")
  else
    echo "✅ PostgreSQL is running"
  fi

  if ! nc -z localhost 6379 2>/dev/null; then
    echo "📦 Redis not running on port 6379"
    services_to_start+=("redis")
  else
    echo "✅ Redis is running"
  fi

  if [ ${#services_to_start[@]} -gt 0 ]; then
    echo "🚀 Starting Docker services: ${services_to_start[*]}"

    echo "🧹 Cleaning up stale Docker state..."
    docker compose down --remove-orphans &>/dev/null || true
    docker network prune -f &>/dev/null || true

    if docker compose --profile server up -d "${services_to_start[@]}"; then
      echo "✅ Docker services started successfully"

      echo "⏳ Waiting for services to be ready..."
      local timeout=30
      local elapsed=0
      local all_ready=false

      while [ $elapsed -lt $timeout ]; do
        all_ready=true

        for service in "${services_to_start[@]}"; do
          if [[ "$service" == "db" ]] && ! nc -z localhost 5432 2>/dev/null; then
            all_ready=false
            break
          elif [[ "$service" == "redis" ]] && ! nc -z localhost 6379 2>/dev/null; then
            all_ready=false
            break
          fi
        done

        if [ "$all_ready" = true ]; then
          echo "✅ All services are ready"
          break
        fi

        sleep 1
        elapsed=$((elapsed + 1))

        if [ $((elapsed % 5)) -eq 0 ]; then
          echo "   Still waiting... (${elapsed}s/${timeout}s)"
        fi
      done

      if [ "$all_ready" = false ]; then
        echo "❌ Timeout: Services failed to start within ${timeout} seconds"
        echo "   Please check Docker logs: docker compose logs"
        exit 1
      fi
    else
      echo "❌ Failed to start Docker services even after cleanup. Please check your docker-compose.yml file."
      exit 1
    fi
  else
    echo "✅ All required Docker services are already running"
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "⚠️ Only macOS is currently supported."
  echo "The Roo Code evals system can also be run with Docker on any platform."
  echo "See https://github.com/RooCodeInc/Roo-Code/blob/main/packages/evals/README.md for instructions."
  exit 1
fi

if ! command -v brew &>/dev/null; then
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    echo "⚠️ Homebrew is installed but not in your PATH"
    exit 1
  fi

  read -p "🍺 Homebrew (https://brew.sh) is required. Install it? (Y/n): " install_brew

  if [[ "$install_brew" =~ ^[Yy]|^$ ]]; then
    echo "🍺 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || exit 1
    # Can be undone with:
    # /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/uninstall.sh)" && sudo rm -rvf /opt/homebrew

    if [[ "$SHELL" == "/bin/zsh" ]] && ! grep -q 'eval "$(/opt/homebrew/bin/brew shellenv)"' ~/.zprofile; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && eval "$(/opt/homebrew/bin/brew shellenv)"' >>~/.zprofile
    elif [[ "$SHELL" == "/bin/bash" ]] && ! grep -q 'eval "$(/opt/homebrew/bin/brew shellenv)"' ~/.bash_profile; then
      echo '[[ -s "/opt/homebrew/bin/brew" ]] && eval "$(/opt/homebrew/bin/brew shellenv)"' >>~/.bash_profile
    fi

    if [[ "$SHELL" == "/bin/zsh" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ "$SHELL" == "/bin/bash" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi

    BREW_VERSION=$(brew --version)
    echo "✅ Homebrew is installed ($BREW_VERSION)"
  else
    exit 1
  fi
else
  BREW_VERSION=$(brew --version)
  echo "✅ Homebrew is installed ($BREW_VERSION)"
fi

if ! command -v mise &>/dev/null; then
  read -p "🛠️ mise (https://mise.jdx.dev) is required. Install it? (Y/n): " install_mise

  if [[ "$install_mise" =~ ^[Yy]|^$ ]]; then
    echo "🛠️ Installing mise..."
    brew install mise || exit 1
    # Can be undone with:
    # brew uninstall mise
    # rm -rvf ~/.local/share/mise ~/.config/mise

    eval "$(mise activate bash)"

    if [[ "$SHELL" == "/bin/zsh" ]] && ! grep -q 'mise activate zsh' ~/.zprofile; then
      echo 'eval "$(mise activate zsh)"' >>~/.zprofile
    elif [[ "$SHELL" == "/bin/bash" ]] && ! grep -q 'mise activate bash' ~/.bash_profile; then
      echo 'eval "$(mise activate bash)"' >>~/.bash_profile
    fi

    MISE_VERSION=$(mise --version)
    echo "✅ mise is installed ($MISE_VERSION)"
  else
    exit 1
  fi
else
  MISE_VERSION=$(mise --version)
  echo "✅ mise is installed ($MISE_VERSION)"
  eval "$(mise activate bash)"
fi

if ! command -v gh &>/dev/null; then
  read -p "👨‍💻 GitHub cli is needed to submit evals results. Install it? (Y/n): " install_gh

  if [[ "$install_gh" =~ ^[Yy]|^$ ]]; then
    brew install gh || exit 1
    GH_VERSION=$(gh --version | head -n 1)
    echo "✅ gh is installed ($GH_VERSION)"
    gh auth status || gh auth login -w -p https
  fi
else
  GH_VERSION=$(gh --version | head -n 1)
  echo "✅ gh is installed ($GH_VERSION)"
fi

# Install language runtimes via mise
if ! command -v node &>/dev/null; then
  echo "📦 Installing Node.js via mise..."
  mise install node@20.20.0 || exit 1
  mise use --global node@20.20.0 || exit 1
  eval "$(mise activate bash)"
  NODE_VERSION=$(node --version)
  echo "✅ Node.js is installed ($NODE_VERSION)"
else
  NODE_VERSION=$(node --version)
  echo "✅ Node.js is installed ($NODE_VERSION)"
fi

if [[ $(node --version) != "v20.20.0" ]]; then
  NODE_VERSION=$(node --version)
  echo "🚨 You have the wrong version of node installed ($NODE_VERSION)."
  echo "💡 If you are using nvm then run 'nvm install' to install the version specified by the repo's .nvmrc."
  exit 1
fi

if ! command -v python &>/dev/null; then
  echo "📦 Installing Python via mise..."
  mise install python@3.13.2 || exit 1
  mise use --global python@3.13.2 || exit 1
  eval "$(mise activate bash)"
  PYTHON_VERSION=$(python --version)
  echo "✅ Python is installed ($PYTHON_VERSION)"
else
  PYTHON_VERSION=$(python --version)
  echo "✅ Python is installed ($PYTHON_VERSION)"
fi

if ! command -v uv &>/dev/null; then
  brew install uv || exit 1
  UV_VERSION=$(uv --version)
  echo "✅ uv is installed ($UV_VERSION)"
else
  UV_VERSION=$(uv --version)
  echo "✅ uv is installed ($UV_VERSION)"
fi

if ! command -v go &>/dev/null; then
  echo "📦 Installing Go via mise..."
  mise install go@1.24.2 || exit 1
  mise use --global go@1.24.2 || exit 1
  eval "$(mise activate bash)"
  GO_VERSION=$(go version)
  echo "✅ Go is installed ($GO_VERSION)"
else
  GO_VERSION=$(go version)
  echo "✅ Go is installed ($GO_VERSION)"
fi

if ! command -v rustc &>/dev/null; then
  echo "📦 Installing Rust via mise..."
  mise install rust@1.85.1 || exit 1
  mise use --global rust@1.85.1 || exit 1
  eval "$(mise activate bash)"
  RUST_VERSION=$(rustc --version)
  echo "✅ Rust is installed ($RUST_VERSION)"
else
  RUST_VERSION=$(rustc --version)
  echo "✅ Rust is installed ($RUST_VERSION)"
fi

if ! command -v javac &>/dev/null || ! javac --version &>/dev/null; then
  echo "☕ Installing Java via mise..."
  mise install java@openjdk-17 || exit 1
  mise use --global java@openjdk-17 || exit 1
  eval "$(mise activate bash)"
  JAVA_VERSION=$(javac --version | head -n 1)
  echo "✅ Java is installed ($JAVA_VERSION)"
else
  JAVA_VERSION=$(javac --version | head -n 1)
  echo "✅ Java is installed ($JAVA_VERSION)"
fi

if ! command -v pnpm &>/dev/null; then
  brew install pnpm || exit 1
  PNPM_VERSION=$(pnpm --version)
  echo "✅ pnpm is installed ($PNPM_VERSION)"
else
  PNPM_VERSION=$(pnpm --version)
  echo "✅ pnpm is installed ($PNPM_VERSION)"
fi

pnpm install --silent || exit 1

if ! command -v code &>/dev/null; then
  echo "⚠️ Visual Studio Code cli is not installed"
  exit 1
else
  VSCODE_VERSION=$(code --version | head -n 1)
  echo "✅ Visual Studio Code is installed ($VSCODE_VERSION)"
fi

# To reset VSCode:
# rm -rvf ~/.vscode && rm -rvf ~/Library/Application\ Support/Code
echo -n "🔌 Installing Visual Studio Code extensions... "
code --install-extension golang.go &>/dev/null || exit 1
code --install-extension dbaeumer.vscode-eslint&>/dev/null || exit 1
code --install-extension redhat.java &>/dev/null || exit 1
code --install-extension ms-python.python&>/dev/null || exit 1
code --install-extension rust-lang.rust-analyzer &>/dev/null || exit 1

if ! code --list-extensions 2>/dev/null | grep -q "kilocode.Kilo-Code"; then
  code --install-extension kilocode.Kilo-Code &>/dev/null || exit 1
fi

echo "✅ Done"

if [[ ! -d "../../../evals" ]]; then
  echo -n "🔗 Cloning evals repository... "
  git clone https://github.com/RooCodeInc/Roo-Code-Evals.git ../../../evals || exit 1
  echo "✅ Done"
else
  echo -n "🔄 Updating evals repository... "

  (cd ../../../evals && \
    git checkout -f &>/dev/null && \
    git clean -f -d &>/dev/null && \
    git checkout main &>/dev/null && \
    git pull &>/dev/null) || { echo "❌ Failed to update evals repository."; exit 1; }

  echo "✅ Done"
fi

if [[ ! -s .env.local ]]; then
  touch .env.local || exit 1
fi

# Check and start Docker services before database operations
check_docker_services

echo -n "🗄️ Syncing Kilo Code evals database... "
pnpm --filter @roo-code/evals db:push --force &>/dev/null || exit 1
echo "✅ Done"

if ! grep -q "OPENROUTER_API_KEY" .env.local; then
  read -p "🔐 Enter your OpenRouter API key (sk-or-v1-...): " openrouter_api_key
  echo "🔑 Validating..."
  curl --silent --fail https://openrouter.ai/api/v1/key -H "Authorization: Bearer $openrouter_api_key" &>/dev/null || exit 1
  echo "OPENROUTER_API_KEY=$openrouter_api_key" >> .env.local || exit 1
fi

current_version=$(code --list-extensions --show-versions 2>/dev/null | grep kilocode)
read -p "💻 Do you want to build a new version of the Kilo Code extension? [currently $current_version] (y/N): " build_extension

if [[ "$build_extension" =~ ^[Yy]$ ]]; then
  build_extension
fi

echo -e "\n🚀 You're ready to rock and roll! \n"

if ! nc -z localhost 3446; then
  read -p "🌐 Would you like to start the evals web app? (Y/n): " start_evals

  if [[ "$start_evals" =~ ^[Yy]|^$ ]]; then
    pnpm --filter @roo-code/web-evals dev
  else
    echo "💡 You can start it anytime with 'pnpm --filter @roo-code/web-evals dev'."
  fi
else
  echo "👟 The evals web app is running at http://localhost:3446"
fi
