# Tasks: Rename Extension from kilo-code to cmbt-agent

## Phase 1: Package Metadata Updates

- [x] 1.1 Update src/package.json

    - [x] 1.1.1 Change "name" from "kilo-code" to "cmbt-agent"
    - [x] 1.1.2 Update all viewsContainers IDs (kilo-code-ActivityBar → cmbt-agent-ActivityBar)
    - [x] 1.1.3 Update all views IDs (kilo-code.SidebarProvider → cmbt-agent.SidebarProvider)
    - [x] 1.1.4 Update all command IDs (kilo-code._ → cmbt-agent._)
    - [x] 1.1.5 Update all menu references (kilo-code.contextMenu → cmbt-agent.contextMenu)
    - [x] 1.1.6 Update all configuration property keys (kilo-code._ → cmbt-agent._)
    - [x] 1.1.7 Update context keys in keybindings (kilocode._ → cmbtagent._)
    - [x] 1.1.8 Update scripts section (kilo-code#bundle → cmbt-agent#bundle)
    - [x] 1.1.9 Update vsix script (kilo-code-_.vsix → cmbt-agent-_.vsix)

- [x] 1.2 Update root package.json

    - [x] 1.2.1 Update any references to kilo-code in scripts or config

- [x] 1.3 Update webview-ui/package.json

    - [x] 1.3.1 Update pretest script (kilo-code#bundle → cmbt-agent#bundle)

- [x] 1.4 Update apps/vscode-nightly/package.json

    - [x] 1.4.1 Update any kilo-code references

- [x] 1.5 Update apps/vscode-e2e/package.json
    - [x] 1.5.1 Update any kilo-code references

## Phase 2: TypeScript/JavaScript Command Registrations

- [x] 2.1 Update src/activate/registerCommands.ts

    - [x] 2.1.1 Update focusChatInput command execution

- [x] 2.2 Update src/services/commit-message/CommitMessageProvider.ts

    - [x] 2.2.1 Update vsc.generateCommitMessage command registration
    - [x] 2.2.2 Update jetbrains.generateCommitMessage command registration

- [x] 2.3 Update src/services/autocomplete/index.ts

    - [x] 2.3.1 Update autocomplete.reload command
    - [x] 2.3.2 Update autocomplete.codeActionQuickFix command
    - [x] 2.3.3 Update autocomplete.generateSuggestions command
    - [x] 2.3.4 Update autocomplete.showIncompatibilityExtensionPopup command
    - [x] 2.3.5 Update autocomplete.disable command

- [x] 2.4 Update src/services/autocomplete/AutocompleteCodeActionProvider.ts

    - [x] 2.4.1 Update command reference in action.command

- [x] 2.5 Update src/services/autocomplete/AutocompleteJetbrainsBridge.ts

    - [x] 2.5.1 Update GET_INLINE_COMPLETIONS_COMMAND constant

- [x] 2.6 Update src/services/autocomplete/AutocompleteServiceManager.ts

    - [x] 2.6.1 Update autocomplete.disable command execution

- [ ] 2.7 Update src/services/terminal-welcome/TerminalWelcomeService.ts

    - [x] 2.7.1 Update getKeybindingForCommand call

- [ ] 2.8 Update src/extension.ts

    - [x] 2.8.1 Update SidebarProvider.focus command execution

- [ ] 2.9 Update src/utils/autoLaunchingTask.ts

    - [x] 2.9.1 Update SidebarProvider.focus command execution
    - [x] 2.9.2 Update newTask command execution

- [ ] 2.10 Update src/core/webview/webviewMessageHandler.ts

    - [x] 2.10.1 Update openGlobalKeybindings command execution
    - [x] 2.10.2 Update all autocomplete.reload command executions (5 occurrences)

- [ ] 2.11 Update src/core/kilocode/agent-manager/AgentManagerProvider.ts

    - [x] 2.11.1 Update viewType constant

- [ ] 2.12 Update packages/agent-runtime/src/host/ExtensionHost.ts
    - [x] 2.12.1 Update webviewProviders.get call

## Phase 3: Test Files

- [ ] 3.1 Update src/services/settings-sync/**tests**/SettingsSyncService.spec.ts

    - [x] 3.1.1 Update all global state key references (10+ occurrences)

- [ ] 3.2 Update apps/vscode-e2e/src/suite/index.ts

    - [x] 3.2.1 Update SidebarProvider.focus command execution

- [ ] 3.3 Update apps/vscode-e2e/src/suite/extension.test.ts

    - [x] 3.3.1 Update command prefix in test assertions

- [x] 3.4 Update benchmark/src/utils.ts
    - [x] 3.4.1 Update SidebarProvider.focus command execution

## Phase 4: Configuration Files

- [x] 4.1 Update .vscode/tasks.json
    - [x] 4.1.1 Update install-dev-extension task command

## Phase 5: Localization Files

- [ ] 5.1 Update src/package.nls.json (English)

    - [x] 5.1.1 Update all kilo-code references in descriptions

- [ ] 5.2 Update src/package.nls.hi.json (Hindi)

    - [x] 5.2.1 Update all kilo-code references

- [ ] 5.3 Update src/package.nls.ja.json (Japanese)

    - [x] 5.3.1 Update all kilo-code references

- [ ] 5.4 Update src/package.nls.zh-CN.json (Chinese)

    - [x] 5.4.1 Update all kilo-code references

- [ ] 5.5 Update any other .nls.\*.json files
    - [x] 5.5.1 Search and update all remaining localization files

## Phase 6: Documentation

- [ ] 6.1 Update AGENTS.md

    - [x] 6.1.1 Update changeset example

- [ ] 6.2 Update DEVELOPMENT.md
    - [x] 6.2.1 Update installation command
    - [x] 6.2.2 Update type generation reference

## Phase 7: Build and Verification

- [ ] 7.1 Build extension

    - [x] 7.1.1 Run `cd src && pnpm bundle`
    - [x] 7.1.2 Run `cd src && pnpm vsix`
    - [x] 7.1.3 Verify bin/cmbt-agent-\*.vsix is created

- [ ] 7.2 Run type checking

    - [x] 7.2.1 Run `pnpm check-types`
    - [x] 7.2.2 Fix any type errors

- [ ] 7.3 Run linting

    - [x] 7.3.1 Run `pnpm lint`
    - [x] 7.3.2 Fix any lint errors

- [ ] 7.4 Run tests

    - [x] 7.4.1 Run backend tests: `cd src && pnpm test`
    - [x] 7.4.2 Run webview tests: `cd webview-ui && pnpm test`
    - [x] 7.4.3 Run E2E tests: `cd apps/vscode-e2e && pnpm test`

- [ ] 7.5 Manual testing
    - [x] 7.5.1 Install extension locally
    - [x] 7.5.2 Verify extension activates without errors
    - [x] 7.5.3 Verify all commands are registered
    - [x] 7.5.4 Test sidebar opens correctly
    - [x] 7.5.5 Test autocomplete functionality
    - [x] 7.5.6 Test settings are accessible
    - [x] 7.5.7 Test keybindings work

## Phase 8: Create Changeset

- [x] 8.1 Create changeset
    - [x] 8.1.1 Run `pnpm changeset`
    - [x] 8.1.2 Select "major" (breaking change)
    - [x] 8.1.3 Write changeset description

## Notes

- This is a breaking change that requires a major version bump
- Users will need to update their custom keybindings and settings
- Consider creating a migration guide for users
