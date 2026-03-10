# Marketplace (Installable Modes, MCP Servers, Skills)

**Priority:** P2
**Status:** ❌ Not started

## What Exists

- Toolbar button registered (`kilo-code.new.marketplaceButtonClicked`) with `$(extensions)` icon
- Renders `<DummyView title="Marketplace" />` — a placeholder with no functionality

## Reference Specification

A detailed specification of the old extension's marketplace implementation is available at [`marketplace-specification.md`](marketplace-specification.md). This covers the complete data model, API protocol, UI structure, installation/uninstallation flows, IPC messages, file storage locations, organization integration, caching, and telemetry as implemented in the legacy extension.

## Architecture Differences (New Extension)

In the old extension, the marketplace wrote directly to extension-owned config files. In the new extension, the CLI backend manages configuration at runtime, but the extension can still write directly to CLI-compatible config files for marketplace installation. CLI endpoints can be added later if needed.

- **No `CustomModesManager`**: The old extension had a `CustomModesManager` class for mode YAML file management. The extension must write mode YAML directly to CLI-compatible config locations.
- **Skills runtime is CLI-side**: The CLI has a skills runtime; the extension manages skill paths/URLs via config and writes skill files to CLI-compatible directories.

### Adaptation Strategy

The marketplace UI (catalog browsing, search, filtering, install modal) can be reimplemented largely as-is in the webview. The backend installation logic writes directly to CLI config files:

| Item Type | Old Extension                                    | New Extension                                                  |
| --------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Modes     | Direct YAML file write via `CustomModesManager`  | Direct write to CLI-compatible mode config file                |
| MCPs      | Direct JSON write to `mcp.json`                  | Direct write to CLI-compatible MCP config file                 |
| Skills    | Download tarball, extract to skills directory     | Download tarball, extract to CLI-compatible skills directory    |

## Remaining Work

### 1. API & Data Layer

- [ ] Marketplace API client — fetch modes, MCPs, and skills from the remote catalog API
- [ ] In-memory cache with 5-minute TTL (three cache keys: `"modes"`, `"mcps"`, `"skills"`)
- [ ] HTTP retry logic (3 attempts, exponential backoff: 1s/2s/4s, 10s timeout per request)
- [ ] Installation metadata detection — scan CLI config files to determine what's already installed (see [Installation Detection](#installation-detection) below)

### 2. UI — Tabbed Catalog

- [ ] Three tabs: **MCP Servers**, **Modes**, **Skills**
- [ ] MCP & Modes tabs share a component with `filterByType` prop; Skills tab uses a separate simpler component
- [ ] Item cards showing: name (clickable link for MCPs), author, type label, description, install/remove button, installed badge, clickable tag pills
- [ ] Loading state (spinner when fetching)
- [ ] Empty state when no items match filters

### 3. Filtering & Search

- [ ] **MCP & Modes tabs**: free-text search (name + description), installed-status dropdown (All/Installed/Not Installed), tag multi-select with OR logic
- [ ] **Skills tab**: free-text search (id + description + category), category toggle buttons

### 4. Installation Flow

- [ ] **Install modal** with:
  - Scope selection (Project / Global radio buttons; Project disabled if no workspace)
  - Installation method dropdown (MCP items with multiple methods only)
  - Prerequisites display (read-only, merged from global + method-specific)
  - Dynamic parameter form (labels, optional markers, placeholders; merged global + method params)
  - Validation: all non-optional parameters must be non-empty
- [ ] **MCP installation**: template substitution (`{{key}}` → param values), write directly to CLI-compatible MCP config file
- [ ] **Mode installation**: parse YAML content, write directly to CLI-compatible mode config file (project or global scope)
- [ ] **Skill installation**: download `.tar.gz` from `content` URL, extract with `strip: 1` to skills directory, verify `SKILL.md` exists, rollback on failure
- [ ] Post-install: open config file in editor at insertion line, show success state with "Done" button and navigation shortcuts (e.g., "Go to Modes Settings")

### 5. Uninstallation Flow

- [ ] Confirmation dialog before removal
- [ ] **Mode removal**: remove mode by slug from config, clean up associated rules
- [ ] **MCP removal**: remove server entry from config
- [ ] **Skill removal**: delete skill directory tree, refresh skills cache
- [ ] Post-removal: refresh marketplace view to update installation status

### 6. Organization Integration

- [ ] Load organization settings from cloud service (when authenticated)
- [ ] Support `hideMarketplaceMcps` flag (skip MCP API fetch entirely)
- [ ] Support `hiddenMcps` array (filter specific MCPs by ID)
- [ ] Display organization-provided MCPs in a separate section with org icon/name header

### 7. IPC Messages

Webview → Extension Host:

| Message                          | Purpose                        |
| -------------------------------- | ------------------------------ |
| `fetchMarketplaceData`           | Request fresh catalog + metadata |
| `filterMarketplaceItems`         | Send current filter state      |
| `installMarketplaceItem`         | Install item with options      |
| `removeInstalledMarketplaceItem` | Remove installed item          |

Extension Host → Webview:

| Message                     | Purpose                  |
| --------------------------- | ------------------------ |
| `marketplaceData`           | Catalog + install metadata |
| `marketplaceInstallResult`  | Install success/failure  |
| `marketplaceRemoveResult`   | Remove success/failure   |

### 8. Telemetry

- [ ] `Marketplace Tab Viewed` — on tab switch
- [ ] `Marketplace Install Button Clicked` — on card install click (before modal)
- [ ] `Marketplace Item Installed` — on successful install (with `itemId`, `itemType`, `itemName`, `target`, optional `hasParameters`, `installationMethodName`)
- [ ] `Marketplace Item Removed` — on successful removal

### 9. Post-Install Behavior

- [ ] VS Code notification on install/remove success
- [ ] Open modified config file in editor, cursor at insertion line
- [ ] Install modal success state: green checkmark, "Done" button, type-specific navigation buttons

## Installation Detection

Installation status is detected dynamically by scanning config files — there is no persistent database.

### Project-Level

| Item Type | Config File                               | Detection Logic                                           |
| --------- | ----------------------------------------- | --------------------------------------------------------- |
| Modes     | CLI project mode config                   | Parse config, record each mode slug                       |
| MCPs      | CLI project MCP config                    | Parse config, record each server key                      |
| Skills    | `{workspace}/.kilocode/skills/*/SKILL.md` | Scan directories, check for `SKILL.md` presence           |

### Global-Level

| Item Type | Config File                       | Detection Logic                      |
| --------- | --------------------------------- | ------------------------------------ |
| Modes     | CLI global mode config            | Same parse logic as project          |
| MCPs      | CLI global MCP config             | Same parse logic as project          |
| Skills    | `~/.kilocode/skills/*/SKILL.md`   | Same directory scan logic as project |

> **Note**: Exact config file paths depend on CLI's configuration layout. The old extension used `{workspace}/.kilocodemodes` (YAML), `{workspace}/.kilocode/mcp.json` (JSON), `{globalSettingsDir}/custom_modes.yaml`, and `{globalSettingsDir}/mcp_settings.json`. The new extension must use whatever paths the CLI expects.
