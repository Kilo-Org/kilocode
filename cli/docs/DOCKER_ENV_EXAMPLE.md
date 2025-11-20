# Docker Environment Variable Example

This document demonstrates how to run Kilo Code CLI in a Docker container using only environment variables, without requiring a config.json file.

## Dockerfile Example

```dockerfile
FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache git

# Install Kilo Code CLI globally
RUN npm install -g @kilocode/cli

# Set working directory
WORKDIR /workspace

# Environment variables will be passed at runtime
# No config.json needed!

# Default command
CMD ["kilocode"]
```

## Docker Compose Example

```yaml
version: "3.8"

services:
    kilocode:
        build: .
        environment:
            # Core settings
            KILO_MODE: code
            KILO_TELEMETRY: "false"
            KILO_THEME: dark

            # Provider configuration (Kilocode)
            KILO_PROVIDER_TYPE: kilocode
            KILOCODE_TOKEN: ${KILOCODE_TOKEN}
            KILOCODE_MODEL: x-ai/grok-code-fast-1

            # Auto-approval settings for CI/CD
            KILO_AUTO_APPROVAL_ENABLED: "true"
            KILO_AUTO_APPROVAL_READ_ENABLED: "true"
            KILO_AUTO_APPROVAL_WRITE_ENABLED: "true"
            KILO_AUTO_APPROVAL_EXECUTE_ENABLED: "true"
            KILO_AUTO_APPROVAL_EXECUTE_ALLOWED: "ls,cat,echo,pwd,npm,yarn,git"

        volumes:
            - ./workspace:/workspace
        stdin_open: true
        tty: true
```

## Running with Docker

### Option 1: Using docker run

```bash
docker run -it \
  -e KILO_PROVIDER_TYPE=kilocode \
  -e KILOCODE_TOKEN=your-api-token \
  -e KILOCODE_MODEL=your-model-name \
  -e KILO_MODE=code \
  -e KILO_TELEMETRY=false \
  -v $(pwd):/workspace \
  kilocode/cli
```

### Option 2: Using docker-compose

```bash
# Set your token in .env file
echo "KILOCODE_TOKEN=your-api-token" > .env

# Start the container
docker-compose up -d

# Execute commands
docker-compose exec kilocode kilocode "Create a hello world app"
```

### Option 3: Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
    name: kilocode-config
data:
    KILO_MODE: "code"
    KILO_TELEMETRY: "false"
    KILO_THEME: "dark"
    KILO_PROVIDER_TYPE: "kilocode"
    KILOCODE_MODEL: "x-ai/grok-code-fast-1"
    KILO_AUTO_APPROVAL_ENABLED: "true"
    KILO_AUTO_APPROVAL_READ_ENABLED: "true"
    KILO_AUTO_APPROVAL_WRITE_ENABLED: "true"
    KILO_AUTO_APPROVAL_EXECUTE_ENABLED: "true"
---
apiVersion: v1
kind: Secret
metadata:
    name: kilocode-secrets
type: Opaque
stringData:
    KILOCODE_TOKEN: your-api-token-here
---
apiVersion: v1
kind: Pod
metadata:
    name: kilocode
spec:
    containers:
        - name: kilocode
          image: kilocode/cli:latest
          envFrom:
              - configMapRef:
                    name: kilocode-config
              - secretRef:
                    name: kilocode-secrets
          volumeMounts:
              - name: workspace
                mountPath: /workspace
    volumes:
        - name: workspace
          emptyDir: {}
```

## CI/CD Pipeline Examples

### GitHub Actions

```yaml
name: Kilo Code CI

on: [push]

jobs:
    code-review:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v3

            - name: Setup Node.js
              uses: actions/setup-node@v3
              with:
                  node-version: "20"

            - name: Install Kilo Code CLI
              run: npm install -g @kilocode/cli

            - name: Run Kilo Code
              env:
                  KILO_PROVIDER_TYPE: kilocode
                  KILOCODE_TOKEN: ${{ secrets.KILOCODE_TOKEN }}
                  KILOCODE_MODEL: x-ai/grok-code-fast-1
                  KILO_MODE: code
                  KILO_TELEMETRY: false
                  KILO_AUTO_APPROVAL_ENABLED: true
                  KILO_AUTO_APPROVAL_READ_ENABLED: true
                  KILO_AUTO_APPROVAL_WRITE_ENABLED: true
              run: |
                  kilocode --auto "Review the code changes in this PR"
```

### GitLab CI

```yaml
kilocode-review:
    image: node:20-alpine
    before_script:
        - npm install -g @kilocode/cli
    script:
        - kilocode --auto "Review the code changes"
    variables:
        KILO_PROVIDER_TYPE: "kilocode"
        KILOCODE_TOKEN: $KILOCODE_TOKEN
        KILO_MODE: "code"
        KILO_TELEMETRY: "false"
        KILO_AUTO_APPROVAL_ENABLED: "true"
        KILO_AUTO_APPROVAL_READ_ENABLED: "true"
        KILO_AUTO_APPROVAL_WRITE_ENABLED: "true"
```

### Jenkins Pipeline

```groovy
pipeline {
    agent {
        docker {
            image 'node:20-alpine'
        }
    }

    environment {
        KILO_PROVIDER_TYPE = 'kilocode'
        KILOCODE_TOKEN = credentials('kilocode-token')
        KILOCODE_MODEL = 'x-ai/grok-code-fast-1'
        KILO_MODE = 'code'
        KILO_TELEMETRY = 'false'
        KILO_AUTO_APPROVAL_ENABLED = 'true'
        KILO_AUTO_APPROVAL_READ_ENABLED = 'true'
        KILO_AUTO_APPROVAL_WRITE_ENABLED = 'true'
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @kilocode/cli'
            }
        }

        stage('Code Review') {
            steps {
                sh 'kilocode --auto "Review the code changes"'
            }
        }
    }
}
```

## Testing Ephemeral Configuration

To test that the CLI works without config.json:

```bash
# 1. Remove any existing config
rm -rf ~/.kilocode/cli/config.json

# 2. Set environment variables
export KILO_PROVIDER_TYPE=kilocode
export KILOCODE_TOKEN=your-token-here
export KILOCODE_MODEL=your-model-name
export KILO_MODE=code

# 3. Run the CLI
kilocode --help

# 4. Verify it works without creating config.json
ls ~/.kilocode/cli/config.json  # Should not exist in ephemeral mode
```

## Security Best Practices

1. **Never commit secrets**: Use secret management tools
2. **Use secret managers**:
    - AWS Secrets Manager
    - HashiCorp Vault
    - Kubernetes Secrets
    - GitHub Secrets
3. **Rotate tokens regularly**: Set up automated rotation
4. **Limit permissions**: Use least-privilege access
5. **Audit access**: Monitor who accesses secrets

## Troubleshooting

### Issue: CLI still prompts for auth wizard

**Solution**: Ensure you have set `KILO_PROVIDER_TYPE` and the required credentials for that provider.

```bash
# Check what's missing
export KILO_PROVIDER_TYPE=kilocode
# CLI will tell you what environment variables are missing
```

### Issue: Configuration not being picked up

**Solution**: Verify environment variables are set correctly:

```bash
# List all KILO_* environment variables
env | grep KILO

# Check specific variables
echo $KILO_PROVIDER_TYPE
echo $KILOCODE_TOKEN
```

### Issue: Config file being created in ephemeral mode

**Solution**: Set `KILO_EPHEMERAL_MODE=true` to prevent file creation:

```bash
export KILO_EPHEMERAL_MODE=true
```

## Complete Example

Here's a complete working example for a Docker container:

```bash
#!/bin/bash

# Build the Docker image
docker build -t kilocode-ephemeral .

# Run with environment variables only
docker run -it --rm \
  -e KILO_PROVIDER_TYPE=kilocode \
  -e KILOCODE_TOKEN=${KILOCODE_TOKEN} \
  -e KILOCODE_MODEL=your-model-name \
  -e KILO_MODE=code \
  -e KILO_TELEMETRY=false \
  -e KILO_THEME=dark \
  -e KILO_AUTO_APPROVAL_ENABLED=true \
  -e KILO_AUTO_APPROVAL_READ_ENABLED=true \
  -e KILO_AUTO_APPROVAL_WRITE_ENABLED=true \
  -e KILO_AUTO_APPROVAL_EXECUTE_ENABLED=true \
  -e KILO_AUTO_APPROVAL_EXECUTE_ALLOWED="ls,cat,echo,pwd,npm,git" \
  -v $(pwd):/workspace \
  kilocode-ephemeral \
  kilocode --auto "Create a simple Node.js hello world app"
```

This will run Kilo Code CLI in a completely ephemeral environment without any persistent configuration files.
