# Requirements: Rename Extension from kilo-code to cmbt-agent

## 1. Overview

Rename the VS Code extension from "kilo-code" to "cmbt-agent" while maintaining backward compatibility for all commands and functionality.

## 2. User Stories

### 2.1 As a developer

I want the extension to be renamed from "kilo-code" to "cmbt-agent" so that it reflects the correct branding.

### 2.2 As an existing user

I want all my existing commands and keybindings to continue working after the rename so that my workflow is not disrupted.

### 2.3 As a developer

I want the extension to be installable and functional after the rename so that I can continue development without issues.

## 3. Acceptance Criteria

### 3.1 Package Metadata

- [ ] Extension name in `src/package.json` is changed from "kilo-code" to "cmbt-agent"
- [ ] Publisher remains "cmbt"
- [ ] Display name and description are updated appropriately
- [ ] All package.json files across the monorepo are updated

### 3.2 Command Identifiers

- [ ] All command IDs are updated from `kilo-code.*` to `cmbt-agent.*`
- [ ] Command registrations in TypeScript files are updated
- [ ] Command references in configuration files are updated

### 3.3 View and UI Identifiers

- [ ] Activity bar ID is updated from `kilo-code-ActivityBar` to `cmbt-agent-ActivityBar`
- [ ] Sidebar provider ID is updated from `kilo-code.SidebarProvider` to `cmbt-agent.SidebarProvider`
- [ ] Tab panel provider ID is updated from `kilo-code.TabPanelProvider` to `cmbt-agent.TabPanelProvider`
- [ ] Agent manager panel ID is updated from `kilo-code.AgentManagerPanel` to `cmbt-agent.AgentManagerPanel`
- [ ] Context menu IDs are updated from `kilo-code.contextMenu` to `cmbt-agent.contextMenu`
- [ ] Terminal menu IDs are updated from `kilo-code.terminalMenu` to `cmbt-agent.terminalMenu`

### 3.4 Configuration Keys

- [ ] All configuration keys are updated from `kilo-code.*` to `cmbt-agent.*`
- [ ] Global state keys are updated from `kilo-code.*` to `cmbt-agent.*`
- [ ] Context keys are updated (e.g., `kilocode.autocomplete.*` to `cmbtagent.autocomplete.*`)

### 3.5 File References

- [ ] All TypeScript/JavaScript files referencing `kilo-code` are updated
- [ ] All JSON configuration files are updated
- [ ] All localization files (_.nls._.json) are updated
- [ ] Documentation files (AGENTS.md, DEVELOPMENT.md) are updated
- [ ] Build scripts and tasks are updated

### 3.6 Testing

- [ ] Extension builds successfully with new name
- [ ] All commands are registered and functional
- [ ] E2E tests pass with updated command names
- [ ] Extension can be installed and activated

### 3.7 Backward Compatibility

- [ ] Document any breaking changes for users
- [ ] Consider migration path for existing users' settings

## 4. Out of Scope

- Renaming internal code references to "kilo" or "kilocode" that don't affect external APIs
- Updating asset files (icons, images)
- Changing the extension's functionality

## 5. Technical Considerations

### 5.1 Scope of Changes

The rename affects:

- Package metadata (package.json files)
- Command identifiers (all `kilo-code.*` commands)
- View and provider IDs
- Configuration keys
- Global state keys
- Context keys
- Localization files
- Documentation
- Build scripts
- Test files

### 5.2 Risk Areas

- Command registration failures
- Settings migration issues
- Keybinding conflicts
- Test failures
- Build process errors

### 5.3 Testing Strategy

- Build the extension and verify .vsix creation
- Install the extension in a test environment
- Verify all commands are registered
- Test key functionality (chat, autocomplete, settings)
- Run E2E test suite
- Verify settings sync still works

## 6. Dependencies

- No external dependencies
- Requires coordination with build and release processes
- May require updates to CI/CD pipelines

## 7. Notes

- This is a breaking change for users who have custom keybindings or scripts referencing the old command names
- Consider providing a migration guide or automatic migration script
- The internal codebase may still reference "kilo" or "kilocode" in variable names, which is acceptable
