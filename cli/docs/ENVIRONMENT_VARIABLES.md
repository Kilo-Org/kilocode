# Environment Variables Configuration

The Kilo Code CLI can be fully configured using environment variables, allowing you to run it in ephemeral environments without a `config.json` file.

## Core Configuration

| Variable         | Description                                                      | Default | Required |
| ---------------- | ---------------------------------------------------------------- | ------- | -------- |
| `KILO_MODE`      | Operation mode (code, architect, ask, debug, orchestrator, etc.) | `code`  | No       |
| `KILO_TELEMETRY` | Enable/disable telemetry (true/false)                            | `true`  | No       |
| `KILO_THEME`     | UI theme (dark, light, alpha, ansi, etc.)                        | `dark`  | No       |

## Provider Selection

| Variable             | Description                                       | Default   | Required |
| -------------------- | ------------------------------------------------- | --------- | -------- |
| `KILO_PROVIDER`      | Active provider ID                                | `default` | No       |
| `KILO_PROVIDER_TYPE` | Provider type (kilocode, anthropic, openai, etc.) | -         | Yes\*    |

\*Required when running without config.json

## Provider-Specific Configuration

### Kilocode Provider

| Variable                                        | Description                                | Required |
| ----------------------------------------------- | ------------------------------------------ | -------- |
| `KILOCODE_TOKEN`                                | API token                                  | Yes      |
| `KILOCODE_MODEL`                                | Model to use                               | Yes      |
| `KILOCODE_ORGANIZATION_ID`                      | Organization ID                            | No       |
| `KILOCODE_OPEN_ROUTER_SPECIFIC_PROVIDER`        | OpenRouter specific provider               | No       |
| `KILOCODE_OPEN_ROUTER_PROVIDER_DATA_COLLECTION` | Data collection (allow/deny)               | No       |
| `KILOCODE_OPEN_ROUTER_PROVIDER_SORT`            | Sort preference (price/throughput/latency) | No       |
| `KILOCODE_OPEN_ROUTER_ZDR`                      | Enable ZDR                                 | No       |
| `KILOCODE_TESTER_WARNINGS_DISABLED_UNTIL`       | Disable warnings until (timestamp)         | No       |

### Anthropic Provider

| Variable                         | Description                         | Required |
| -------------------------------- | ----------------------------------- | -------- |
| `KILO_API_MODEL_ID`              | Model ID                            | Yes      |
| `KILO_API_KEY`                   | API key                             | Yes      |
| `KILO_ANTHROPIC_BASE_URL`        | Base URL                            | No       |
| `KILO_ANTHROPIC_USE_AUTH_TOKEN`  | Use auth token (true/false)         | No       |
| `KILO_ANTHROPIC_BETA_1M_CONTEXT` | Enable 1M context beta (true/false) | No       |

### OpenAI Native Provider

| Variable                          | Description                               | Required |
| --------------------------------- | ----------------------------------------- | -------- |
| `KILO_API_MODEL_ID`               | Model ID                                  | Yes      |
| `KILO_OPENAI_NATIVE_API_KEY`      | API key                                   | Yes      |
| `KILO_OPENAI_NATIVE_BASE_URL`     | Base URL                                  | No       |
| `KILO_OPENAI_NATIVE_SERVICE_TIER` | Service tier (auto/default/flex/priority) | No       |

### OpenAI Provider

| Variable                        | Description                    | Required |
| ------------------------------- | ------------------------------ | -------- |
| `KILO_OPENAI_MODEL_ID`          | Model ID                       | Yes      |
| `KILO_OPENAI_API_KEY`           | API key                        | Yes      |
| `KILO_OPENAI_BASE_URL`          | Base URL                       | No       |
| `KILO_OPENAI_LEGACY_FORMAT`     | Use legacy format (true/false) | No       |
| `KILO_OPENAI_R1_FORMAT_ENABLED` | Enable R1 format (true/false)  | No       |
| `KILO_OPENAI_USE_AZURE`         | Use Azure (true/false)         | No       |
| `KILO_AZURE_API_VERSION`        | Azure API version              | No       |
| `KILO_OPENAI_STREAMING_ENABLED` | Enable streaming (true/false)  | No       |

### OpenRouter Provider

| Variable                                   | Description                                | Required |
| ------------------------------------------ | ------------------------------------------ | -------- |
| `KILO_OPENROUTER_MODEL_ID`                 | Model ID                                   | Yes      |
| `KILO_OPENROUTER_API_KEY`                  | API key                                    | Yes      |
| `KILO_OPENROUTER_BASE_URL`                 | Base URL                                   | No       |
| `KILO_OPENROUTER_SPECIFIC_PROVIDER`        | Specific provider                          | No       |
| `KILO_OPENROUTER_USE_MIDDLE_OUT_TRANSFORM` | Use middle-out transform (true/false)      | No       |
| `KILO_OPENROUTER_PROVIDER_DATA_COLLECTION` | Data collection (allow/deny)               | No       |
| `KILO_OPENROUTER_PROVIDER_SORT`            | Sort preference (price/throughput/latency) | No       |
| `KILO_OPENROUTER_ZDR`                      | Enable ZDR (true/false)                    | No       |

### Ollama Provider

| Variable               | Description  | Required |
| ---------------------- | ------------ | -------- |
| `KILO_OLLAMA_MODEL_ID` | Model ID     | Yes      |
| `KILO_OLLAMA_BASE_URL` | Base URL     | No       |
| `KILO_OLLAMA_API_KEY`  | API key      | No       |
| `KILO_OLLAMA_NUM_CTX`  | Context size | No       |

### AWS Bedrock Provider

| Variable                              | Description                             | Required |
| ------------------------------------- | --------------------------------------- | -------- |
| `KILO_API_MODEL_ID`                   | Model ID                                | Yes      |
| `KILO_AWS_ACCESS_KEY`                 | AWS access key                          | Yes\*    |
| `KILO_AWS_SECRET_KEY`                 | AWS secret key                          | Yes\*    |
| `KILO_AWS_SESSION_TOKEN`              | AWS session token                       | No       |
| `KILO_AWS_REGION`                     | AWS region                              | Yes      |
| `KILO_AWS_USE_CROSS_REGION_INFERENCE` | Use cross-region inference (true/false) | No       |
| `KILO_AWS_USE_PROMPT_CACHE`           | Use prompt cache (true/false)           | No       |
| `KILO_AWS_PROFILE`                    | AWS profile name                        | No       |
| `KILO_AWS_USE_PROFILE`                | Use AWS profile (true/false)            | No       |
| `KILO_AWS_API_KEY`                    | AWS API key (alternative auth)          | No       |
| `KILO_AWS_USE_API_KEY`                | Use API key auth (true/false)           | No       |
| `KILO_AWS_CUSTOM_ARN`                 | Custom ARN                              | No       |
| `KILO_AWS_MODEL_CONTEXT_WINDOW`       | Model context window size               | No       |
| `KILO_AWS_BEDROCK_ENDPOINT_ENABLED`   | Enable custom endpoint (true/false)     | No       |
| `KILO_AWS_BEDROCK_ENDPOINT`           | Custom Bedrock endpoint                 | No       |
| `KILO_AWS_BEDROCK_1M_CONTEXT`         | Enable 1M context (true/false)          | No       |

\*Required unless using profile or API key authentication

### Google Vertex Provider

| Variable                       | Description                                | Required |
| ------------------------------ | ------------------------------------------ | -------- |
| `KILO_API_MODEL_ID`            | Model ID                                   | Yes      |
| `KILO_VERTEX_KEY_FILE`         | Path to service account key file           | Yes\*    |
| `KILO_VERTEX_JSON_CREDENTIALS` | JSON credentials (alternative to key file) | Yes\*    |
| `KILO_VERTEX_PROJECT_ID`       | GCP project ID                             | Yes      |
| `KILO_VERTEX_REGION`           | GCP region                                 | Yes      |
| `KILO_ENABLE_URL_CONTEXT`      | Enable URL context (true/false)            | No       |
| `KILO_ENABLE_GROUNDING`        | Enable grounding (true/false)              | No       |

\*Either key file or JSON credentials required

### Other Providers

For other providers (DeepSeek, Mistral, Groq, etc.), the pattern is similar:

- Model ID: `KILO_API_MODEL_ID` or `KILO_<PROVIDER>_MODEL_ID`
- API Key: `KILO_<PROVIDER>_API_KEY`
- Base URL: `KILO_<PROVIDER>_BASE_URL` (if applicable)

## Auto-Approval Configuration

| Variable                              | Description                              | Default                      |
| ------------------------------------- | ---------------------------------------- | ---------------------------- |
| `KILO_AUTO_APPROVAL_ENABLED`          | Global auto-approval toggle              | `true`                       |
| `KILO_AUTO_APPROVAL_READ_ENABLED`     | Auto-approve read operations             | `true`                       |
| `KILO_AUTO_APPROVAL_READ_OUTSIDE`     | Auto-approve reads outside workspace     | `true`                       |
| `KILO_AUTO_APPROVAL_WRITE_ENABLED`    | Auto-approve write operations            | `true`                       |
| `KILO_AUTO_APPROVAL_WRITE_OUTSIDE`    | Auto-approve writes outside workspace    | `true`                       |
| `KILO_AUTO_APPROVAL_WRITE_PROTECTED`  | Auto-approve writes to protected files   | `false`                      |
| `KILO_AUTO_APPROVAL_BROWSER_ENABLED`  | Auto-approve browser operations          | `false`                      |
| `KILO_AUTO_APPROVAL_RETRY_ENABLED`    | Auto-approve retry operations            | `false`                      |
| `KILO_AUTO_APPROVAL_RETRY_DELAY`      | Retry delay in seconds                   | `10`                         |
| `KILO_AUTO_APPROVAL_MCP_ENABLED`      | Auto-approve MCP operations              | `true`                       |
| `KILO_AUTO_APPROVAL_MODE_ENABLED`     | Auto-approve mode switching              | `true`                       |
| `KILO_AUTO_APPROVAL_SUBTASKS_ENABLED` | Auto-approve subtask creation            | `true`                       |
| `KILO_AUTO_APPROVAL_EXECUTE_ENABLED`  | Auto-approve command execution           | `true`                       |
| `KILO_AUTO_APPROVAL_EXECUTE_ALLOWED`  | Comma-separated list of allowed commands | `ls,cat,echo,pwd`            |
| `KILO_AUTO_APPROVAL_EXECUTE_DENIED`   | Comma-separated list of denied commands  | `rm -rf,sudo rm,mkfs,dd if=` |
| `KILO_AUTO_APPROVAL_QUESTION_ENABLED` | Auto-approve followup questions          | `false`                      |
| `KILO_AUTO_APPROVAL_QUESTION_TIMEOUT` | Question timeout in seconds              | `60`                         |
| `KILO_AUTO_APPROVAL_TODO_ENABLED`     | Auto-approve todo list updates           | `true`                       |

## Minimal Configuration Example

To run the CLI in an ephemeral environment without a config.json file, you need at minimum:

### For Kilocode Provider:

```bash
export KILO_PROVIDER_TYPE=kilocode
export KILOCODE_TOKEN=your-api-token
export KILOCODE_MODEL=your-model-name
kilocode
```

### For Anthropic Provider:

```bash
export KILO_PROVIDER_TYPE=anthropic
export KILO_API_KEY=your-api-key
export KILO_API_MODEL_ID=claude-3-5-sonnet-20241022
kilocode
```

### For OpenAI Provider:

```bash
export KILO_PROVIDER_TYPE=openai
export KILO_OPENAI_API_KEY=your-api-key
export KILO_OPENAI_MODEL_ID=gpt-4o
kilocode
```

## Full Configuration Example

```bash
# Core settings
export KILO_MODE=code
export KILO_TELEMETRY=true
export KILO_THEME=dark

# Provider configuration
export KILO_PROVIDER_TYPE=kilocode
export KILOCODE_TOKEN=your-api-token
export KILOCODE_MODEL=x-ai/grok-code-fast-1
export KILOCODE_ORGANIZATION_ID=org-123

# Auto-approval settings
export KILO_AUTO_APPROVAL_ENABLED=true
export KILO_AUTO_APPROVAL_READ_ENABLED=true
export KILO_AUTO_APPROVAL_WRITE_ENABLED=true
export KILO_AUTO_APPROVAL_BROWSER_ENABLED=false
export KILO_AUTO_APPROVAL_EXECUTE_ALLOWED="ls,cat,echo,pwd,npm,yarn,pnpm"
export KILO_AUTO_APPROVAL_EXECUTE_DENIED="rm -rf,sudo"

kilocode
```

## Notes

1. **Provider Type**: When running without a config.json file, you must specify `KILO_PROVIDER_TYPE` to indicate which provider to use.

2. **Boolean Values**: Use `true` or `false` (case-insensitive) for boolean settings.

3. **Lists**: For comma-separated lists (like allowed/denied commands), use commas without spaces unless the space is part of the command pattern.

4. **Precedence**: Environment variables override values in config.json if both are present.

5. **Validation**: The CLI will validate the environment configuration and provide clear error messages if required variables are missing.

6. **Security**: Be cautious when setting API keys and tokens in environment variables. Consider using secret management tools in production environments.
