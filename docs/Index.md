# Kilocode Documentation

**Quick Navigation for AI Agents**

---

## Modules

| Module | Description | Documentation |
|--------|-------------|---------------|
| **[core](./core/)** | Task, tools, context, config, prompts, agent manager | [Features](./core/Feature-Index.md) |
| **[services](./services/)** | MCP, code-index, skills, browser, tree-sitter | [Features](./services/Feature-Index.md) |
| **[api-providers](./api-providers/)** | 50+ AI model providers (Anthropic, OpenAI, etc.) | [Features](./api-providers/Feature-Index.md) |
| **[integrations](./integrations/)** | VS Code integrations (editor, terminal, diagnostics) | [Features](./integrations/Feature-Index.md) |
| **[webview-ui](./webview-ui/)** | React frontend (chat, settings, UI components) | [Features](./webview-ui/Feature-Index.md) |
| **[cli](./cli/)** | CLI application (commands, auth, services) | [Features](./cli/Feature-Index.md) |
| **[packages](./packages/)** | Shared packages (cloud, telemetry, types) | [Features](./packages/Feature-Index.md) |
| **[shared](./shared/)** | Shared utilities (messages, modes, tools) | [Features](./shared/Feature-Index.md) |

---

## By Feature Keyword

| If you need... | Go to |
|----------------|-------|
| task, task state, task management, run task | [core/features/task/](./core/features/task/) |
| tools, file read, file write, edit file | [core/features/tools/](./core/features/tools/) |
| read file, ReadFileTool | [core/features/tools/file-tools/](./core/features/tools/file-tools/) |
| diff, patch, apply changes, ApplyDiff | [core/features/tools/diff-patch-tools/](./core/features/tools/diff-patch-tools/) |
| search, codebase search, grep | [core/features/tools/search-tools/](./core/features/tools/search-tools/) |
| execute command, shell, terminal tool | [core/features/tools/execution-tools/](./core/features/tools/execution-tools/) |
| browser, web, screenshot | [core/features/tools/browser-tools/](./core/features/tools/browser-tools/) |
| MCP tools, use mcp, access resource | [core/features/tools/mcp-tools/](./core/features/tools/mcp-tools/) |
| context, mentions, @file, @url | [core/features/context/](./core/features/context/) |
| modes, custom modes, roles, permissions | [core/features/config/](./core/features/config/) |
| provider settings, API config | [core/features/config/](./core/features/config/) |
| prompts, system prompt, instructions | [core/features/prompts/](./core/features/prompts/) |
| checkpoints, save state, restore | [core/features/checkpoints/](./core/features/checkpoints/) |
| auto-approve, approval, auto-approval | [core/features/auto-approval/](./core/features/auto-approval/) |
| agent manager, CLI process, parallel | [core/features/agent-manager/](./core/features/agent-manager/) |
| messages, message parser, assistant message | [core/features/messages/](./core/features/messages/) |
| ignore, .rooignore, protected files | [core/features/ignore-protect/](./core/features/ignore-protect/) |
| MCP, model context protocol, servers | [services/features/mcp/](./services/features/mcp/) |
| embeddings, code search, indexing, vector | [services/features/code-index/](./services/features/code-index/) |
| skills, custom functions, user skills | [services/features/skills/](./services/features/skills/) |
| browser automation, web scraping | [services/features/browser/](./services/features/browser/) |
| tree-sitter, AST, syntax parsing | [services/features/tree-sitter/](./services/features/tree-sitter/) |
| ripgrep, fast search | [services/features/ripgrep/](./services/features/ripgrep/) |
| Claude, Anthropic, claude-3 | [api-providers/features/anthropic/](./api-providers/features/anthropic/) |
| OpenAI, GPT, gpt-4 | [api-providers/features/openai/](./api-providers/features/openai/) |
| Gemini, Google, vertex | [api-providers/features/google/](./api-providers/features/google/) |
| Bedrock, AWS | [api-providers/features/aws/](./api-providers/features/aws/) |
| Ollama, LMStudio, local models | [api-providers/features/local-models/](./api-providers/features/local-models/) |
| OpenRouter | [api-providers/features/openrouter/](./api-providers/features/openrouter/) |
| editor, diff view, decorations | [integrations/features/editor/](./integrations/features/editor/) |
| terminal, shell integration | [integrations/features/terminal/](./integrations/features/terminal/) |
| OAuth, authentication, claude-code | [integrations/features/claude-code/](./integrations/features/claude-code/) |
| chat UI, chat view, messages UI | [webview-ui/features/chat/](./webview-ui/features/chat/) |
| settings UI, provider UI | [webview-ui/features/settings/](./webview-ui/features/settings/) |
| CLI commands, /help, /config | [cli/features/commands/](./cli/features/commands/) |
| CLI auth, login | [cli/features/auth/](./cli/features/auth/) |
| cloud, sync, share | [packages/features/cloud/](./packages/features/cloud/) |
| telemetry, analytics | [packages/features/telemetry/](./packages/features/telemetry/) |
| ExtensionMessage, WebviewMessage | [shared/features/messages/](./shared/features/messages/) |

---

## Navigation Pattern

```
1. Read this Index.md
   ↓ Identify module/keyword

2. Go to {module}/Feature-Index.md
   ↓ Identify feature

3. Go to features/{feature}/{feature}-Index.md
   ↓ See components and quick reference

4. Load specific detailed file (Types.md, Implementation.md, etc.)
```

---

## Quick Stats

- **Core Features**: 12 (task, tools, context, config, prompts, etc.)
- **Services**: 15 (mcp, code-index, skills, browser, etc.)
- **Tools**: 30+ built-in tools
- **AI Providers**: 50+
- **CLI Commands**: 20

---

## Key Files Reference

| File | Size | Purpose |
|------|------|---------|
| `src/core/task/Task.ts` | 184KB | Central task management |
| `src/services/mcp/McpHub.ts` | 70KB | MCP orchestration |
| `src/core/kilocode/agent-manager/AgentManagerProvider.ts` | 67KB | Agent management |
| `src/core/config/CustomModesManager.ts` | 41KB | Custom modes |
| `src/core/config/ProviderSettingsManager.ts` | 34KB | Provider settings |

---

**Last Updated**: 2025-01-16
**Documentation Version**: 1.0.0
