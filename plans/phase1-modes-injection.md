# Phase 1: Minimal Modes Injection

## Background: Kilo Code Fork of Opencode

Kilo Code is a fork of [Opencode](https://github.com/anomalyco/opencode). As a fork, we need to:

1. **Maintain upstream compatibility** - Keep the ability to merge changes from Opencode
2. **Preserve Kilo Code features** - Users have existing configurations (modes, rules, workflows, MCPs) that need to work
3. **Minimize divergence** - Use Opencode's native mechanisms rather than forking config systems

### The Problem

Kilo Code users have configurations stored in:
- `custom_modes.yaml` / `.kilocodemodes` - Custom agent modes
- `.kilocode/rules/` - Custom instruction rules
- `.kilocode/workflows/` - Reusable task workflows
- `mcp_settings.json` - MCP server configurations
- VSCode `globalState`/`secrets` - Provider settings

Opencode has its own config system with different formats:
- `opencode.json` / `opencode.jsonc` - Main config
- `.opencode/agent/*.md` - Agent definitions
- `.opencode/command/*.md` - Custom commands
- `OPENCODE_CONFIG_CONTENT` env var - Runtime config injection

### The Solution

Rather than forking Opencode's config system, we use `OPENCODE_CONFIG_CONTENT` to inject Kilo Code configurations at runtime. This:

- ✅ Keeps Opencode's config system unchanged (easier merges)
- ✅ Allows gradual migration of Kilo Code features
- ✅ Can be removed later when users migrate to native Opencode config
- ✅ Isolates Kilo-specific code in a dedicated `kilocode/` directory

### Isolation Strategy

All Kilo Code-specific code lives in `packages/opencode/src/kilocode/` and is marked with `kilocode_change` comments. This makes it easy to:
- Identify Kilo-specific code during upstream merges
- Remove the migration layer when no longer needed
- Keep the main Opencode codebase clean

---

## Goal

Create a minimal implementation that:
1. Reads Kilocode modes from `custom_modes.yaml` and `.kilocodemodes`
2. Converts them to Opencode agent format
3. Injects via `OPENCODE_CONFIG_CONTENT` when spawning CLI

## Scope

- ✅ Modes migration (custom + filtered defaults)
- ❌ Authentication/secrets (deferred)
- ❌ Rules migration (Phase 2)
- ❌ Workflows migration (Phase 2)
- ❌ MCP migration (Phase 2)
- ❌ Provider settings (Phase 2)

---

## Implementation Plan

### Step 1: Create the Migrator Module

**File: `packages/opencode/src/kilocode/modes-migrator.ts`**

```typescript
// kilocode_change - new file

import * as yaml from "yaml"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { Config } from "../config/config"

export namespace ModesMigrator {
  // Kilocode mode structure
  export interface KilocodeMode {
    slug: string
    name: string
    roleDefinition: string
    groups: Array<string | [string, { fileRegex?: string; description?: string }]>
    customInstructions?: string
    whenToUse?: string
    description?: string
    source?: "global" | "project" | "organization"
  }

  export interface KilocodeModesFile {
    customModes: KilocodeMode[]
  }

  // Migration actions
  export type MigrationAction = "skip_native" | "skip_redundant" | "migrate"

  // Default mode mappings
  const DEFAULT_MODE_ACTIONS: Record<string, MigrationAction> = {
    code: "skip_native",        // Maps to opencode 'build'
    orchestrator: "skip_redundant", // All agents can spawn subagents
    architect: "migrate",
    ask: "migrate",
    debug: "migrate",
  }

  // Group to permission mapping
  const GROUP_TO_PERMISSION: Record<string, string> = {
    read: "read",
    edit: "edit",
    browser: "bash",
    command: "bash",
    mcp: "mcp",
  }

  export function classifyMode(slug: string): MigrationAction {
    return DEFAULT_MODE_ACTIONS[slug] ?? "migrate"
  }

  export function convertPermissions(
    groups: KilocodeMode["groups"]
  ): Config.Permission {
    const permission: Record<string, any> = {}

    for (const group of groups) {
      if (typeof group === "string") {
        const permKey = GROUP_TO_PERMISSION[group] ?? group
        permission[permKey] = "allow"
      } else if (Array.isArray(group)) {
        const [groupName, config] = group
        const permKey = GROUP_TO_PERMISSION[groupName] ?? groupName
        
        if (config?.fileRegex) {
          permission[permKey] = {
            [config.fileRegex]: "allow",
            "*": "deny",
          }
        } else {
          permission[permKey] = "allow"
        }
      }
    }

    return permission
  }

  export function convertMode(mode: KilocodeMode): Config.Agent {
    const prompt = [mode.roleDefinition, mode.customInstructions]
      .filter(Boolean)
      .join("\n\n")

    return {
      mode: "primary",
      description: mode.description ?? mode.whenToUse ?? `${mode.name}`,
      prompt,
      permission: convertPermissions(mode.groups),
    }
  }

  export async function readModesFile(filepath: string): Promise<KilocodeMode[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = yaml.parse(content) as KilocodeModesFile
      return parsed?.customModes ?? []
    } catch (err: any) {
      if (err.code === "ENOENT") return []
      throw err
    }
  }

  export interface MigrationResult {
    agents: Record<string, Config.Agent>
    skipped: Array<{ slug: string; reason: string }>
  }

  export async function migrate(options: {
    projectDir: string
    globalSettingsDir?: string
  }): Promise<MigrationResult> {
    const result: MigrationResult = {
      agents: {},
      skipped: [],
    }

    // Collect modes from all sources
    const allModes: KilocodeMode[] = []

    // 1. Global custom_modes.yaml
    const globalModesPath = path.join(
      options.globalSettingsDir ?? path.join(os.homedir(), ".kilocode-agent", "settings"),
      "custom_modes.yaml"
    )
    allModes.push(...(await readModesFile(globalModesPath)))

    // 2. Project .kilocodemodes
    const projectModesPath = path.join(options.projectDir, ".kilocodemodes")
    allModes.push(...(await readModesFile(projectModesPath)))

    // 3. Home directory .kilocodemodes
    const homeModesPath = path.join(os.homedir(), ".kilocodemodes")
    if (homeModesPath !== projectModesPath) {
      allModes.push(...(await readModesFile(homeModesPath)))
    }

    // Deduplicate by slug (later entries win)
    const modesBySlug = new Map<string, KilocodeMode>()
    for (const mode of allModes) {
      modesBySlug.set(mode.slug, mode)
    }

    // Process each mode
    for (const [slug, mode] of modesBySlug) {
      const action = classifyMode(slug)

      switch (action) {
        case "skip_native":
          result.skipped.push({
            slug,
            reason: "Maps to native opencode agent (use 'build' instead)",
          })
          break

        case "skip_redundant":
          result.skipped.push({
            slug,
            reason: "Redundant - all opencode agents can spawn subagents",
          })
          break

        case "migrate":
          result.agents[slug] = convertMode(mode)
          break
      }
    }

    return result
  }
}
```

### Step 2: Create the Config Injector

**File: `packages/opencode/src/kilocode/config-injector.ts`**

```typescript
// kilocode_change - new file

import { Config } from "../config/config"
import { ModesMigrator } from "./modes-migrator"

export namespace KilocodeConfigInjector {
  export interface InjectionResult {
    configJson: string
    warnings: string[]
  }

  export async function buildConfig(options: {
    projectDir: string
    globalSettingsDir?: string
  }): Promise<InjectionResult> {
    const warnings: string[] = []

    // Migrate modes
    const modesMigration = await ModesMigrator.migrate(options)

    // Log skipped modes
    for (const skipped of modesMigration.skipped) {
      warnings.push(`Mode '${skipped.slug}' skipped: ${skipped.reason}`)
    }

    // Build config object
    const config: Partial<Config.Info> = {}

    if (Object.keys(modesMigration.agents).length > 0) {
      config.agent = modesMigration.agents
    }

    return {
      configJson: JSON.stringify(config),
      warnings,
    }
  }

  export function getEnvVars(configJson: string): Record<string, string> {
    return {
      OPENCODE_CONFIG_CONTENT: configJson,
    }
  }
}
```

### Step 3: Create Index Export

**File: `packages/opencode/src/kilocode/index.ts`**

```typescript
// kilocode_change - new file

export { ModesMigrator } from "./modes-migrator"
export { KilocodeConfigInjector } from "./config-injector"
```

### Step 4: Integration Point

Where the CLI is spawned, add the injection:

```typescript
import { KilocodeConfigInjector } from "./kilocode"

async function spawnOpencodeProcess(options: SpawnOptions) {
  // Build kilocode config injection
  const injection = await KilocodeConfigInjector.buildConfig({
    projectDir: options.workingDirectory,
  })

  // Log warnings
  for (const warning of injection.warnings) {
    console.log(`[kilocode] ${warning}`)
  }

  // Spawn with injected config
  const proc = spawn("opencode", args, {
    env: {
      ...process.env,
      ...KilocodeConfigInjector.getEnvVars(injection.configJson),
    },
  })
}
```

---

## File Structure

```
packages/opencode/src/kilocode/
├── index.ts              # Public exports
├── modes-migrator.ts     # Mode conversion logic
└── config-injector.ts    # Config building and env var generation
```

---

## Testing Plan

### Unit Tests

**File: `packages/opencode/test/kilocode/modes-migrator.test.ts`**

```typescript
import { describe, test, expect } from "bun:test"
import { ModesMigrator } from "../../src/kilocode/modes-migrator"

describe("ModesMigrator", () => {
  test("classifies 'code' as skip_native", () => {
    expect(ModesMigrator.classifyMode("code")).toBe("skip_native")
  })

  test("classifies 'orchestrator' as skip_redundant", () => {
    expect(ModesMigrator.classifyMode("orchestrator")).toBe("skip_redundant")
  })

  test("classifies 'architect' as migrate", () => {
    expect(ModesMigrator.classifyMode("architect")).toBe("migrate")
  })

  test("classifies custom modes as migrate", () => {
    expect(ModesMigrator.classifyMode("my-custom-mode")).toBe("migrate")
  })

  test("converts simple groups to permissions", () => {
    const groups = ["read", "edit", "command"]
    const permissions = ModesMigrator.convertPermissions(groups)
    
    expect(permissions.read).toBe("allow")
    expect(permissions.edit).toBe("allow")
    expect(permissions.bash).toBe("allow")
  })

  test("converts fileRegex groups to restricted permissions", () => {
    const groups: ModesMigrator.KilocodeMode["groups"] = [
      "read",
      ["edit", { fileRegex: "\\.md$", description: "Markdown only" }],
    ]
    const permissions = ModesMigrator.convertPermissions(groups)
    
    expect(permissions.read).toBe("allow")
    expect(permissions.edit).toEqual({
      "\\.md$": "allow",
      "*": "deny",
    })
  })

  test("converts full mode to agent config", () => {
    const mode: ModesMigrator.KilocodeMode = {
      slug: "architect",
      name: "Architect",
      roleDefinition: "You are a planner...",
      customInstructions: "Create detailed plans.",
      groups: ["read", ["edit", { fileRegex: "\\.md$" }]],
    }

    const agent = ModesMigrator.convertMode(mode)

    expect(agent.mode).toBe("primary")
    expect(agent.prompt).toBe("You are a planner...\n\nCreate detailed plans.")
    expect(agent.permission?.read).toBe("allow")
    expect(agent.permission?.edit).toEqual({
      "\\.md$": "allow",
      "*": "deny",
    })
  })
})
```

---

## Implementation Checklist

- [ ] Create `packages/opencode/src/kilocode/` directory
- [ ] Implement `modes-migrator.ts`
- [ ] Implement `config-injector.ts`
- [ ] Create `index.ts` exports
- [ ] Add unit tests
- [ ] Find integration point where CLI is spawned
- [ ] Add injection call at spawn point
- [ ] Test with real kilocode config files
- [ ] Verify modes appear in opencode agent list

---

## Expected Behavior

### Before (Kilocode `.kilocodemodes`)

```yaml
customModes:
  - slug: architect
    name: Architect
    roleDefinition: You are Kilo Code, an experienced technical leader...
    groups:
      - read
      - - edit
        - fileRegex: "\\.md$"
    customInstructions: Create detailed plans...
```

### After (Opencode sees via `OPENCODE_CONFIG_CONTENT`)

```json
{
  "agent": {
    "architect": {
      "mode": "primary",
      "description": "Architect",
      "prompt": "You are Kilo Code, an experienced technical leader...\n\nCreate detailed plans...",
      "permission": {
        "read": "allow",
        "edit": {
          "\\.md$": "allow",
          "*": "deny"
        }
      }
    }
  }
}
```

### Console Output

```
[kilocode] Mode 'code' skipped: Maps to native opencode agent (use 'build' instead)
[kilocode] Mode 'orchestrator' skipped: Redundant - all opencode agents can spawn subagents
```

---

## Next Steps (Phase 2)

After Phase 1 is working:
1. Add rules migration (`instructions` array)
2. Add workflows migration (`command` config)
3. Add MCP migration (`mcp` config)
4. Add provider settings (with env var API keys)

---

## Feature Migration Roadmap

Based on the original requirements from the Kilo Code documentation:

| Feature | Global | Project | Phase | Notes |
|---------|--------|---------|-------|-------|
| **Modes** | ✅ | ✅ | **Phase 1** | This plan |
| **Rules** | ✅ | ✅ | Phase 2 | Map to `instructions` array |
| **Workflows** | ✅ | ✅ | Phase 2 | Migrate to custom slash commands |
| **MCPs** | ✅ | ✅ | Phase 2 | Merge configs, opencode reads latest |
| **Skills** | ❌ | ❌ | N/A | Not supported in opencode |
| **Model Config** | - | - | Phase 2 | Via `provider` and `model` config |

### Key Differences from Kilo Code

1. **No Orchestrator Mode**: Opencode's `task` tool lets any agent spawn subagents via `general` or `explore`. The dedicated orchestrator mode is redundant.

2. **No Skills**: Opencode doesn't have a skills concept. Skills would need to be converted to agents or commands.

3. **Workflows → Commands**: Kilo Code workflows become Opencode custom slash commands with similar functionality.

4. **Rules → Instructions**: Kilo Code rules files map to Opencode's `instructions` array in config.

---

## References

- **Opencode Config Docs**: https://opencode.ai/docs/config
- **Opencode Agents Docs**: https://opencode.ai/docs/agents
- **Opencode Commands Docs**: https://opencode.ai/docs/commands
- **Kilo Code Source**: `/Users/marius/Documents/git/kilocode`
- **Opencode Fork (kilo-cli)**: `/Users/marius/Documents/git/kilo-cli` (this repo)
- **Opencode Config Source**: [`packages/opencode/src/config/config.ts`](packages/opencode/src/config/config.ts)
- **Opencode Agent Source**: [`packages/opencode/src/agent/agent.ts`](packages/opencode/src/agent/agent.ts)
