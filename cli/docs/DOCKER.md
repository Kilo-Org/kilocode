# Kilo Code CLI - Docker

A containerized version of the Kilo Code CLI with full browser automation support.

## Quick Start Examples

### Build the Image

```bash
pnpm install
pnpm cli:bundle
```

### Debian-based Image

```bash
cd cli
docker build \
  --target debian \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  --build-arg VERSION=$(jq -r '.version' package.json) \
  -t kiloai/cli:$(jq -r '.version' package.json) \
  -t kiloai/cli:latest \
  .
```

### Alpine-based Image

```bash
cd cli
docker build \
  --target alpine \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  --build-arg VERSION=$(jq -r '.version' package.json) \
  -t kiloai/cli:$(jq -r '.version' package.json) \
  -t kiloai/cli:latest-alpine \
  .
```

### 1. Basic Interactive Mode

Run the CLI interactively in your current directory:

```bash
docker run -it --rm -v $(pwd):/workspace kiloai/cli
```

### 2. Architect Mode

Start in architect mode for planning and design:

```bash
docker run -it --rm -v $(pwd):/workspace kiloai/cli --mode architect
```

### 3. One-Shot Autonomous Mode

Execute a single task and exit automatically:

```bash
docker run --rm -v $(pwd):/workspace kiloai/cli --auto "Run tests and fix any issues"
```

### 4. With Local Configuration

Mount your existing Kilo Code configuration to avoid setup prompts:

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  kiloai/cli
```

---

## Additional Options

### Custom Workspace Path

```bash
docker run -it --rm -v /path/to/project:/workspace kiloai/cli
```

### Mount Git Configuration

For commit operations:

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  -v ~/.gitconfig:/home/kilocode/.gitconfig:ro \
  kiloai/cli
```

### Environment Variables

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e KILOCODE_MODE=code \
  kiloai/cli
```

### With Timeout

```bash
docker run --rm \
  -v $(pwd):/workspace \
  kiloai/cli /usr/local/bin/kilocode --timeout 300 --auto "Run tests"
```

## Configuration

### Persistent Configuration

The CLI stores configuration in `~/.kilocode/config.json`. You can:

**Option 1: Mount local config** (recommended)

```bash
-v ~/.kilocode:/home/kilocode/.kilocode
```

**Option 2: Use Docker volume for isolated config**

```bash
docker volume create kilocode-config
docker run -it --rm \
  -v $(pwd):/workspace \
  -v kilocode-config:/home/kilocode/.kilocode \
  kiloai/cli
```

### Terminal Colors and Theme

If you experience text visibility issues (text blending with background), you can:

**Option 1: Set theme explicitly in config**

Edit `~/.kilocode/config.json`:

```json
{
	"theme": "dark" // or "light" for light terminals
}
```

**Option 2: Force color environment variables**

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e FORCE_COLOR=1 \
  -e COLORTERM=truecolor \
  kiloai/cli
```

**Option 3: Pass terminal info**

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e TERM=$TERM \
  kiloai/cli
```
