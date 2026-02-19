# Design: Rename Extension from kilo-code to cmbt-agent

## 1. Overview

This design document outlines the approach for renaming the VS Code extension from "kilo-code" to "cmbt-agent". The refactoring will be executed systematically across multiple file types to ensure all references are updated consistently.

## 2. Architecture

### 2.1 Naming Convention Strategy

The rename follows these patterns:

| Old Pattern  | New Pattern   | Example               |
| ------------ | ------------- | --------------------- |
| `kilo-code`  | `cmbt-agent`  | Package name          |
| `kilo-code.` | `cmbt-agent.` | Command IDs           |
| `kilo-code-` | `cmbt-agent-` | View container IDs    |
| `kilocode.`  | `cmbtagent.`  | Context keys          |
| `kilo-code#` | `cmbt-agent#` | Turbo task references |

### 2.2 File Categories

Files are grouped by type for systematic updates:

1. **Package Metadata** - package.json files
2. **TypeScript/JavaScript** - Command registrations and references
3. **Configuration** - VS Code settings and tasks
4. **Localization** - All .nls.\*.json files
5. **Documentation** - Markdown files
6. **Build Scripts** - esbuild, turbo configs

## 3. Implementation Plan

### 3.1 Phase 1: Package Metadata

**Files to update:**

- `src/package.json` - Main extension manifest
- `package.json` - Root package.json
- `webview-ui/package.json` - Webview package
- `apps/vscode-nightly/package.json` - Nightly build config
- `apps/vscode-e2e/package.json` - E2E test config

**Changes:**

```json
{
	"name": "cmbt-agent", // was: "kilo-code"
	"contributes": {
		"viewsContainers": {
			"activitybar": [
				{
					"id": "cmbt-agent-ActivityBar" // was: "kilo-code-ActivityBar"
				}
			]
		},
		"views": {
			"cmbt-agent-ActivityBar": [
				{
					// was: "kilo-code-ActivityBar"
					"id": "cmbt-agent.SidebarProvider" // was: "kilo-code.SidebarProvider"
				}
			]
		},
		"commands": [
			{
				"command": "cmbt-agent.plusButtonClicked" // was: "kilo-code.plusButtonClicked"
			}
			// ... all 30+ commands
		],
		"configuration": {
			"properties": {
				"cmbt-agent.allowedCommands": {} // was: "kilo-code.allowedCommands"
				// ... all configuration keys
			}
		},
		"keybindings": [
			{
				"command": "cmbt-agent.focusChatInput", // was: "kilo-code.focusChatInput"
				"when": "cmbtagent.autocomplete.hasSuggestions" // was: "kilocode.autocomplete.hasSuggestions"
			}
		]
	},
	"scripts": {
		"pretest": "turbo run cmbt-agent#bundle --cwd .." // was: "kilo-code#bundle"
	}
}
```

### 3.2 Phase 2: TypeScript/JavaScript Files

**Command Registration Files:**

- `src/activate/registerCommands.ts`
- `src/services/commit-message/CommitMessageProvider.ts`
- `src/services/autocomplete/index.ts`
- `src/services/autocomplete/AutocompleteCodeActionProvider.ts`
- `src/services/autocomplete/AutocompleteJetbrainsBridge.ts`
- `src/services/autocomplete/AutocompleteServiceManager.ts`

**Command Execution Files:**

- `src/extension.ts`
- `src/utils/autoLaunchingTask.ts`
- `src/core/webview/webviewMessageHandler.ts`
- `src/core/kilocode/agent-manager/AgentManagerProvider.ts`
- `packages/agent-runtime/src/host/ExtensionHost.ts`

**Test Files:**

- `src/services/settings-sync/__tests__/SettingsSyncService.spec.ts`
- `apps/vscode-e2e/src/suite/index.ts`
- `apps/vscode-e2e/src/suite/extension.test.ts`
- `benchmark/src/utils.ts`

**Pattern replacements:**

```typescript
// Command registration
vscode.commands.registerCommand("cmbt-agent.plusButtonClicked", ...)  // was: "kilo-code.plusButtonClicked"

// Command execution
await vscode.commands.executeCommand("cmbt-agent.SidebarProvider.focus")  // was: "kilo-code.SidebarProvider.focus"

// View type constants
public static readonly viewType = "cmbt-agent.AgentManagerPanel"  // was: "kilo-code.AgentManagerPanel"

// Provider references
this.webviewProviders.get("cmbt-agent.SidebarProvider")  // was: "kilo-code.SidebarProvider"

// Global state keys
"cmbt-agent.allowedCommands"  // was: "kilo-code.allowedCommands"

// Context keys in when clauses
"cmbtagent.autocomplete.hasSuggestions"  // was: "kilocode.autocomplete.hasSuggestions"
```

### 3.3 Phase 3: Configuration Files

**Files to update:**

- `.vscode/tasks.json` - Build and install tasks
- `turbo.json` - Turbo task definitions (if exists)

**Changes:**

```json
{
	"command": "code --install-extension \"$(ls -1v bin/cmbt-agent-*.vsix | tail -n1)\""
}
```

### 3.4 Phase 4: Localization Files

**Pattern:** All `src/package.nls.*.json` files

**Files to update:**

- `src/package.nls.json` (English)
- `src/package.nls.hi.json` (Hindi)
- `src/package.nls.ja.json` (Japanese)
- `src/package.nls.zh-CN.json` (Chinese)
- All other language files

**Changes:**

```json
{
	"settings.autoImportSettingsPath.description": "Path to cmbt-agent settings file..."
}
```

### 3.5 Phase 5: Documentation

**Files to update:**

- `AGENTS.md` - Project documentation
- `DEVELOPMENT.md` - Development guide
- `README.md` - Main readme (if exists)

**Changes:**

- Update installation commands
- Update package references
- Update changeset examples

### 3.6 Phase 6: Build Scripts

**Files to update:**

- `src/package.json` scripts section
- Any shell scripts referencing the extension name

**Changes:**

```json
{
	"scripts": {
		"vsix": "mkdirp ../bin && vsce package --no-dependencies --out ../bin",
		"vsix:unpacked": "mkdirp ../bin-unpacked && unzip -q -o ../bin/cmbt-agent-*.vsix -d ../bin-unpacked"
	}
}
```

## 4. Testing Strategy

### 4.1 Build Verification

```bash
cd src
pnpm bundle
pnpm vsix
# Verify: bin/cmbt-agent-*.vsix is created
```

### 4.2 Installation Test

```bash
code --install-extension "$(ls -1v bin/cmbt-agent-*.vsix | tail -n1)"
# Verify: Extension appears in VS Code extensions list
```

### 4.3 Command Registration Test

```typescript
// In VS Code developer console
vscode.commands.getCommands().then((cmds) => console.log(cmds.filter((c) => c.startsWith("cmbt-agent."))))
// Verify: All 30+ commands are registered
```

### 4.4 Functional Tests

- Open sidebar: `cmbt-agent.SidebarProvider.focus`
- Test autocomplete: `cmbt-agent.autocomplete.generateSuggestions`
- Test settings: Verify `cmbt-agent.*` configuration keys work
- Test keybindings: Verify shortcuts still work

### 4.5 E2E Tests

```bash
cd apps/vscode-e2e
pnpm test
# Verify: All tests pass with new command names
```

## 5. Migration Considerations

### 5.1 User Settings Migration

Users with existing settings will need to migrate:

**Old settings:**

```json
{
  "kilo-code.allowedCommands": [...],
  "kilo-code.deniedCommands": [...]
}
```

**New settings:**

```json
{
  "cmbt-agent.allowedCommands": [...],
  "cmbt-agent.deniedCommands": [...]
}
```

**Migration approach:**

- Document the breaking change in CHANGELOG
- Provide migration script or manual instructions
- Consider auto-migration in extension activation

### 5.2 Keybinding Migration

Users with custom keybindings will need to update:

**Old:**

```json
{
	"key": "cmd+shift+a",
	"command": "kilo-code.focusChatInput"
}
```

**New:**

```json
{
	"key": "cmd+shift+a",
	"command": "cmbt-agent.focusChatInput"
}
```

### 5.3 Global State Migration

Extension may need to migrate global state keys on first activation:

```typescript
// Pseudo-code for migration
const oldKeys = [
	"kilo-code.allowedCommands",
	"kilo-code.deniedCommands",
	// ... all keys
]

for (const oldKey of oldKeys) {
	const value = context.globalState.get(oldKey)
	if (value !== undefined) {
		const newKey = oldKey.replace("kilo-code.", "cmbt-agent.")
		await context.globalState.update(newKey, value)
		await context.globalState.update(oldKey, undefined) // Clear old key
	}
}
```

## 6. Rollout Plan

### 6.1 Pre-release Checklist

- [ ] All files updated
- [ ] Extension builds successfully
- [ ] All tests pass
- [ ] Documentation updated
- [ ] Migration guide created

### 6.2 Release Steps

1. Create changeset with breaking change notice
2. Update version to next major version (breaking change)
3. Build and test .vsix package
4. Publish to marketplace
5. Update documentation and website

### 6.3 Post-release Support

- Monitor for issues related to command registration
- Provide support for users migrating settings
- Update any external documentation or tutorials

## 7. Risk Mitigation

### 7.1 Risks

| Risk                       | Impact | Mitigation                               |
| -------------------------- | ------ | ---------------------------------------- |
| Missing command references | High   | Comprehensive grep search before release |
| Settings not migrating     | Medium | Provide clear migration guide            |
| Keybindings broken         | Medium | Document in release notes                |
| Build failures             | High   | Test build process thoroughly            |
| E2E test failures          | High   | Update and run all tests                 |

### 7.2 Rollback Plan

If critical issues are discovered:

1. Revert to previous version
2. Unpublish broken version from marketplace
3. Fix issues in development
4. Re-test thoroughly before re-release

## 8. Success Criteria

The refactoring is successful when:

- [ ] Extension builds without errors
- [ ] All 30+ commands are registered correctly
- [ ] Extension can be installed and activated
- [ ] All E2E tests pass
- [ ] Settings and configuration work correctly
- [ ] Autocomplete functionality works
- [ ] Keybindings respond correctly
- [ ] No console errors on activation
- [ ] Documentation is updated

## 9. Correctness Properties

### Property 1: Command Registration Completeness

**Description:** All commands defined in package.json are successfully registered in VS Code.

**Validation:**

```typescript
// Test that verifies all package.json commands are registered
const packageCommands = getCommandsFromPackageJson()
const registeredCommands = await vscode.commands.getCommands()
const ourCommands = registeredCommands.filter((c) => c.startsWith("cmbt-agent."))

assert.equal(ourCommands.length, packageCommands.length)
packageCommands.forEach((cmd) => {
	assert.ok(ourCommands.includes(cmd), `Command ${cmd} should be registered`)
})
```

### Property 2: Configuration Key Consistency

**Description:** All configuration keys in package.json match the keys used in code.

**Validation:**

```typescript
// Test that configuration keys are consistent
const configKeys = getConfigKeysFromPackageJson() // e.g., "cmbt-agent.allowedCommands"
const codeReferences = findConfigReferencesInCode() // grep for configuration.get calls

configKeys.forEach((key) => {
	assert.ok(codeReferences.includes(key), `Config key ${key} should be used in code`)
})
```

### Property 3: View Provider ID Consistency

**Description:** View provider IDs in package.json match the IDs used in provider implementations.

**Validation:**

```typescript
// Test that view IDs are consistent
const viewIds = getViewIdsFromPackageJson() // e.g., "cmbt-agent.SidebarProvider"
const providerIds = getProviderIdsFromCode() // from provider implementations

viewIds.forEach((id) => {
	assert.ok(providerIds.includes(id), `View ID ${id} should have a provider implementation`)
})
```

## 10. Implementation Notes

- Use find-and-replace with regex for bulk updates
- Test incrementally after each phase
- Keep a backup of original files
- Use version control to track changes
- Consider using a script for repetitive replacements
- Pay special attention to string literals in TypeScript files
- Don't forget context keys in `when` clauses
- Update both command definitions and command references
