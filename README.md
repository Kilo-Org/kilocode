<p align="center">
  <a href="https://kilo.ai">
    <img src="assets/kilo-logo.svg" alt="Kilo CLI logo">
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://kilo.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://x.com/kilocode"><img alt="X" src="https://img.shields.io/badge/X-@kilocode-000000?style=flat-square&logo=x&logoColor=white" /></a>
  <a href="https://www.reddit.com/r/kilocode/"><img alt="Reddit" src="https://img.shields.io/badge/Reddit-r%2Fkilocode-FF4500?style=flat-square&logo=reddit&logoColor=white" /></a>
</p>

---

### Agents

Kilo CLI includes two built-in agents you can switch between using the `Tab` key:

- **build** - Default, full access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multi-step tasks.
This is used internally and can be invoked using `@general` in messages.

### Migrating from Kilo Code Extension

If you're coming from the Kilo Code VS Code extension, your configurations are automatically migrated:

| Kilo Code Feature                            | Kilo CLI Equivalent                          |
| -------------------------------------------- | -------------------------------------------- |
| Custom modes                                 | Converted to agents                          |
| Rules (`.kilocoderules`, `.kilocode/rules/`) | Added to `instructions` array                |
| Skills (`.kilocode/skills/`)                 | Auto-discovered alongside `.opencode/skill/` |
| Workflows (`.kilocode/workflows/`)           | Converted to commands                        |
| MCP servers                                  | Migrated to `mcp` config                     |

**Default mode mappings:**

- `code` → `build` agent
- `architect` → `plan` agent

For detailed migration information, see:

- [Migration Overview](packages/opencode/src/kilocode/docs/migration.md)
- [Rules Migration](packages/opencode/src/kilocode/docs/rules-migration.md)

### Documentation

For more info on how to configure Kilo CLI, [**head over to our docs**](https://kilo.ai/docs).

### Contributing

If you're interested in contributing, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### FAQ

#### Where did Kilo CLI come from?

Kilo CLI is a fork of [OpenCode](https://github.com/anomalyco/opencode), enhanced to work within the Kilo agentic engineering platform.

---

**Join our community** [Discord](https://kilo.ai/discord) | [X.com](https://x.com/kilocode) | [Reddit](https://reddit.com/r/kilocode)
