# Kilo Code CLI - Docker Guide

A containerized version of the Kilo Code CLI with full browser automation support.

## Quick Start Examples

### Build the Image

**Basic build** (no metadata required):

```bash
cd cli
docker build -t kilocode/cli .
```

**With build metadata** (optional, for production/CI):

```bash
docker build \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  --build-arg VERSION=$(jq -r '.version' package.json) \
  -t kilocode/cli:$(jq -r '.version' package.json) \
  -t kilocode/cli:latest \
  .
```

The build arguments are all optional and have defaults:

- `BUILD_DATE` - defaults to empty string
- `VCS_REF` - defaults to empty string
- `VERSION` - defaults to "latest"

### 1. Basic Interactive Mode

Run the CLI interactively in your current directory:

```bash
docker run -it --rm -v $(pwd):/workspace kilocode/cli
```

### 2. Architect Mode

Start in architect mode for planning and design:

```bash
docker run -it --rm -v $(pwd):/workspace kilocode/cli --mode architect
```

### 3. One-Shot Autonomous Mode

Execute a single task and exit automatically:

```bash
docker run --rm -v $(pwd):/workspace kilocode/cli --auto "Run tests and fix any issues"
```

### 4. With Local Configuration

Mount your existing Kilo Code configuration to avoid setup prompts:

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  kilocode/cli
```

---

## Additional Options

### Custom Workspace Path

```bash
docker run -it --rm -v /path/to/project:/workspace kilocode/cli
```

### Mount Git Configuration

For commit operations:

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -v ~/.kilocode:/home/kilocode/.kilocode \
  -v ~/.gitconfig:/home/kilocode/.gitconfig:ro \
  kilocode/cli
```

### Environment Variables

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e KILOCODE_MODE=code \
  kilocode/cli
```

### With Timeout

```bash
docker run --rm \
  -v $(pwd):/workspace \
  kilocode/cli /usr/local/bin/kilocode --timeout 300 --auto "Run tests"
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
  kilocode/cli
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
  kilocode/cli
```

**Option 3: Pass terminal info**

```bash
docker run -it --rm \
  -v $(pwd):/workspace \
  -e TERM=$TERM \
  kilocode/cli
```
