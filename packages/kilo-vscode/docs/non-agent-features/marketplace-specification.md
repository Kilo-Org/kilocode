# Marketplace Feature Specification

This document describes the complete marketplace functionality as implemented in the Kilo Code VS Code extension, intended as a reference for reimplementing it with feature parity in a new extension.

---

## Table of Contents

1. [Overview](#overview)
2. [Item Types](#item-types)
3. [Data Model](#data-model)
4. [API & Data Fetching](#api--data-fetching)
5. [UI Structure](#ui-structure)
6. [Filtering & Search](#filtering--search)
7. [Installation Flow](#installation-flow)
8. [Uninstallation Flow](#uninstallation-flow)
9. [Installation Detection (Metadata)](#installation-detection-metadata)
10. [File Storage Locations](#file-storage-locations)
11. [Organization Integration](#organization-integration)
12. [IPC Message Protocol](#ipc-message-protocol)
13. [Telemetry](#telemetry)
14. [Caching & Retry](#caching--retry)
15. [Post-Install Behavior](#post-install-behavior)

---

## Overview

The marketplace is a browsable catalog of installable extensions for the Kilo Code agent. It allows users to discover, install, and remove three types of items — **MCP Servers**, **Modes**, and **Skills** — into either a project-scoped or global-scoped configuration.

Key architectural properties:

- Items are fetched from a remote API and displayed in a tabbed UI
- Installation writes directly to the extension's existing configuration files (no separate database)
- Installation status is detected dynamically by scanning config files each time
- Items are fetched lazily (on-demand when the marketplace tab is opened), not at startup
- There is a 5-minute in-memory cache for API responses

---

## Item Types

### MCP Servers (`type: "mcp"`)

MCP (Model Context Protocol) servers provide additional tools and capabilities to the AI agent. Each MCP marketplace item contains either a single JSON configuration string or an array of named installation methods (e.g., "Docker", "NPX", "Local"), each with their own configuration template and parameters.

### Modes (`type: "mode"`)

Modes define custom agent behaviors/personas. Each mode marketplace item contains YAML content that defines the mode's configuration (slug, name, role definition, allowed tools, etc.).

### Skills (`type: "skill"`)

Skills are downloadable instruction sets packaged as directories containing a `SKILL.md` file and supporting files. They are distributed as `.tar.gz` tarballs and extracted to a skills directory.

---

## Data Model

### Base Fields (shared by all item types)

```typescript
{
  id: string           // Unique identifier, min 1 char
  name: string         // Display name, min 1 char
  description: string  // Item description
  author?: string      // Author name (optional)
  authorUrl?: string   // Author URL, must be valid URL (optional)
  tags?: string[]      // Array of tag strings for filtering (optional)
  prerequisites?: string[]  // List of prerequisites (optional)
}
```

### MCP Server Item

```typescript
{
  type: "mcp"
  ...baseFields
  url: string                                          // URL to the MCP server project/repo (required, valid URL)
  content: string | McpInstallationMethod[]            // Single JSON config OR array of named methods
  parameters?: McpParameter[]                          // Global parameters (applied to all methods)
}
```

**McpParameter:**

```typescript
{
  name: string        // Display name for the parameter
  key: string         // Template key, used as {{key}} in content for substitution
  placeholder?: string // Placeholder text for the input field
  optional?: boolean  // Whether the parameter can be left empty (defaults to false)
}
```

**McpInstallationMethod:**

```typescript
{
  name: string               // Display name (e.g., "Docker", "NPX")
  content: string            // JSON configuration template
  parameters?: McpParameter[] // Method-specific parameters (merged with global)
  prerequisites?: string[]   // Method-specific prerequisites (merged with global)
}
```

### Mode Item

```typescript
{
  type: "mode"
  ...baseFields
  content: string    // YAML string containing the full mode configuration
}
```

The YAML content contains a mode object with fields like `slug`, `name`, `roleDefinition`, `groups` (allowed tool groups), etc.

### Skill Item

```typescript
{
  type: "skill"
  ...baseFields
  category: string        // Category identifier (kebab-case, e.g., "code-quality")
  githubUrl: string       // URL to the skill's GitHub repository
  content: string         // URL to the .tar.gz tarball for download
  displayName: string     // Computed: kebab-to-Title-Case of id (e.g., "my-skill" -> "My Skill")
  displayCategory: string // Computed: kebab-to-Title-Case of category
}
```

### Installation Options

```typescript
{
  target?: "global" | "project"      // Scope, defaults to "project"
  parameters?: Record<string, any>   // Parameter values keyed by parameter key
}
```

The `parameters` object may also contain `_selectedIndex: number` to specify which installation method to use for MCP items with multiple methods.

### Installation Metadata

```typescript
{
	project: Record<string, { type: string }> // item ID -> { type: "mode"|"mcp"|"skill" }
	global: Record<string, { type: string }> // item ID -> { type: "mode"|"mcp"|"skill" }
}
```

This is computed dynamically by scanning config files, not stored in a database.

---

## API & Data Fetching

### Endpoints

All three endpoints return **YAML** responses (parsed with a YAML library, not JSON):

| Endpoint                               | Item Type | Response Schema                    |
| -------------------------------------- | --------- | ---------------------------------- |
| `GET {apiBase}/api/marketplace/modes`  | Modes     | `{ items: ModeMarketplaceItem[] }` |
| `GET {apiBase}/api/marketplace/mcps`   | MCPs      | `{ items: McpMarketplaceItem[] }`  |
| `GET {apiBase}/api/marketplace/skills` | Skills    | `{ items: RawSkill[] }`            |

The production API base URL is `https://api.kilo.ai`.

### Response Processing

1. YAML responses are parsed and validated against Zod schemas
2. The `type` discriminator field (`"mode"`, `"mcp"`, `"skill"`) is **added programmatically** after parsing — it is not present in the API response
3. Skills undergo a transformation from `RawSkill` to `SkillMarketplaceItem`:
    - `id` is used as both `id` and `name`
    - `displayName` is computed by converting `id` from kebab-case to Title Case
    - `displayCategory` is computed by converting `category` from kebab-case to Title Case

### Fetch Orchestration

All three item types are fetched in parallel via `Promise.all`. If `hideMarketplaceMcps` is set by the organization, the MCP fetch is skipped entirely (resolves to `[]`).

The results are concatenated: `[...modes, ...mcps, ...skills]`.

---

## UI Structure

### Top-Level Layout

The marketplace is a full-screen view with:

1. **Header**: Back button (returns to chat), title "Kilo Code Marketplace", and a 3-tab switcher
2. **Tab Content**: Renders the appropriate sub-view based on the active tab

### Tabs

| Tab    | Label    | Component                                   | Content          |
| ------ | -------- | ------------------------------------------- | ---------------- |
| MCP    | "MCP"    | `MarketplaceListView` (filterByType="mcp")  | MCP server items |
| Modes  | "Modes"  | `MarketplaceListView` (filterByType="mode") | Mode items       |
| Skills | "Skills" | `SkillsMarketplace`                         | Skill items      |

The active tab is indicated by a sliding 2px indicator bar at the bottom of the tab buttons, positioned at 0%, 33.33%, or 66.66%.

### MCP & Mode Tabs (MarketplaceListView)

These tabs share the same component with different `filterByType` props.

**Layout:**

- Filter controls at the top (search, installed status dropdown, tag multi-select)
- Below filters, a responsive grid of item cards:
    - `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3`
- Two sections when organization MCPs exist (MCP tab only):
    1. **Organization MCPs section** — with organization icon and name header
    2. **Marketplace section** — with globe icon header

**Item Card (`MarketplaceItemCard`):**

- Name (rendered as a clickable link for MCP items with valid `url`)
- Author info with type label ("Mode" or "MCP Server")
- Install/Remove button in top-right corner
- Description text
- Bottom row of badges:
    - Green "Installed" badge (if installed at project or global scope)
    - Clickable tag pills (clicking a tag toggles it in the active filter)

### Skills Tab (SkillsMarketplace)

This tab uses a separate, simpler component.

**Layout:**

- Search input at the top
- Category toggle buttons (derived from the set of categories across all skills, with an "All" button to reset)
- Vertical list (not grid) of skill cards

**Skill Card (`SkillItemCard`):**

- Display name (clickable link to `githubUrl`)
- Install/Remove button
- Description text
- "Installed" badge + category badge

### Loading State

When `isFetching` is true, the list views show a loading indicator. The initial state starts with `isFetching: true`.

### Empty State

When there are no items to display after filtering, an appropriate empty message is shown.

---

## Filtering & Search

### MCP & Mode Tab Filters

Three filter controls, all applying client-side filtering:

1. **Search input**: Free-text filter, case-insensitive match against `item.name` OR `item.description`
2. **Installed status dropdown**: Three options:
    - "All Items" (default)
    - "Installed" — only items found in installation metadata
    - "Not Installed" — only items NOT in installation metadata
3. **Tag multi-select**: A searchable combobox/popover with checkboxes. Tags are aggregated from all items in the current tab, deduplicated, and sorted. Selected tags filter items using OR logic (item must have at least one selected tag).

Filter changes dispatch an `UPDATE_FILTERS` state transition which:

1. Updates the filter state
2. Re-filters `displayItems` and `displayOrganizationMcps` from `allItems`
3. Sends a `filterMarketplaceItems` message to the extension host (for potential server-side filtering, though current implementation does filtering client-side)

### Skill Tab Filters

Skills use local component state for filtering (not the shared state manager):

1. **Search input**: Case-insensitive match against `id`, `description`, and `category`
2. **Category buttons**: Toggle buttons for each category. Derived from `skill.category` with `skill.displayCategory` for labels. "All" button clears the category filter.

### Sorting

There is no sorting implemented. Items are displayed in the order returned by the API.

### Pagination

There is no pagination. All items are rendered at once.

---

## Installation Flow

### MCP & Mode Items

1. User clicks "Install" button on an item card
2. A telemetry event `MARKETPLACE_INSTALL_BUTTON_CLICKED` is captured with `itemId`, `itemType`, `itemName`
3. The **Install Modal** opens as a dialog with the following configuration options:

    **a. Scope Selection** (radio buttons):
    - "Project" (default if workspace is open; disabled if no workspace)
    - "Global"

    **b. Installation Method** (dropdown, only shown for MCP items with multiple `McpInstallationMethod` entries):
    - Lists all method names from the `content` array
    - Defaults to the first method (index 0)
    - Changing method updates the displayed parameters and prerequisites

    **c. Prerequisites** (read-only list, shown if any exist):
    - Combined from global `prerequisites` and method-specific `prerequisites`, deduplicated

    **d. Parameters** (dynamic form, shown if any exist):
    - Input fields for each `McpParameter`
    - Label shows `param.name`, with "(optional)" suffix if `param.optional`
    - Placeholder text from `param.placeholder`
    - Parameters are merged: global item parameters + method-specific parameters, with method-specific overriding on key collision

4. User clicks "Install" button in the modal
5. **Validation**: All non-optional parameters must be non-empty. Validation error shown inline if missing.
6. An IPC message is sent to the extension host:
    ```typescript
    {
      type: "installMarketplaceItem",
      mpItem: MarketplaceItem,
      mpInstallOptions: {
        target: "project" | "global",
        parameters: {
          [paramKey]: paramValue,  // user-provided values
          _selectedIndex: number | undefined  // which installation method
        }
      }
    }
    ```
7. The modal waits for a `marketplaceInstallResult` message (matched by `message.slug === item.id`)
8. **On success**: Shows a green checkmark with "Installed" text and post-install action buttons
9. **On failure**: Shows the error message inline in red
10. After success, the webview sends `fetchMarketplaceData` to refresh the catalog and installation metadata

### Skill Items

1. User clicks "Install" button on a skill card
2. A simplified dialog opens with only scope selection (project/global radio buttons)
3. On "Install" click, the same `installMarketplaceItem` IPC message is sent
4. Same result handling as MCP/Mode items

### Backend Installation Logic

#### Mode Installation

1. Parse the YAML `content` field to get the mode object
2. If `CustomModesManager` is available (preferred path):
    - Wrap the parsed mode in `{ customModes: [modeData] }`
    - Call `customModesManager.importModeWithRules()` which handles deduplication, file writing, and rules folder management
3. Fallback (if no CustomModesManager):
    - Read existing YAML file (or create new `{ customModes: [] }`)
    - If the file exists but has invalid YAML, throw an error (do NOT overwrite)
    - Remove any existing mode with the same `slug`
    - Append the new mode to the `customModes` array
    - Write back to file with `yaml.stringify(data, { lineWidth: 0 })`
4. Return `{ filePath, line }` where `line` is the 1-based line number where the mode's `slug:` appears

#### MCP Installation

1. Determine which content to use:
    - If `content` is a string, use it directly
    - If `content` is an array, select the method at `_selectedIndex` (or index 0)
2. Merge parameters: global `item.parameters` + method-specific `parameters`, deduplicated by key
3. **Template substitution**: Replace all `{{key}}` placeholders in the content string with provided parameter values
4. If `_selectedIndex` is in the parameters object and content is an array, re-select the method and re-apply parameter substitution
5. Parse the resulting content as JSON
6. Read existing `mcp.json` (or create new `{ mcpServers: {} }`)
    - If file has invalid JSON, throw an error (do NOT overwrite)
7. Set `existingData.mcpServers[item.id] = parsedMcpData`
8. Write back as pretty-printed JSON (`JSON.stringify(data, null, 2)`)
9. Return `{ filePath, line }` where `line` is the line containing `"item.id"`

#### Skill Installation

1. Validate that `item.content` (the tarball URL) exists
2. Determine destination: `{skillsDir}/{item.id}/`
3. Download the tarball:
    - `fetch(tarballUrl)` to get the `.tar.gz` file
    - Write to a temp file in `os.tmpdir()`
4. Extract with `tar-fs`:
    - `pipeline(createReadStream(tempFile), zlib.createGunzip(), tarFs.extract(destDir, { strip: 1 }))`
    - `strip: 1` removes the top-level directory from the tarball
5. Verify `SKILL.md` exists at the root of the extracted directory
6. **Rollback on failure**: If extraction started but fails, remove the partially extracted directory
7. Clean up temp file
8. Return `{ filePath: "{skillDir}/SKILL.md", line: 1 }`

---

## Uninstallation Flow

### UI Flow (all item types)

1. User clicks "Remove" button on an installed item card
2. A confirmation dialog (`AlertDialog`) appears with type-specific message
3. On confirm, an IPC message is sent:
    ```typescript
    {
      type: "removeInstalledMarketplaceItem",
      mpItem: MarketplaceItem,
      mpInstallOptions: { target: "project" | "global" }
    }
    ```
4. The UI listens for `marketplaceRemoveResult` message
5. On success, `fetchMarketplaceData` is sent to refresh the view
6. On failure, error is shown

### Determining Remove Target

The remove target (project vs global) is determined by checking which scope the item is installed in. If installed in both, the UI uses the more specific scope. The "Remove" button is only shown for installed items.

### Backend Removal Logic

#### Mode Removal

1. Parse the mode's YAML `content` to extract the `slug`
2. Call `customModesManager.deleteCustomMode(slug, true)` — this also handles deleting associated rules folders

#### MCP Removal

1. Read the `mcp.json` file for the target scope
2. `delete existingData.mcpServers[item.id]`
3. Write the file back (even if `mcpServers` is now empty)

#### Skill Removal

1. Determine the skill directory path: `{skillsDir}/{item.id}/`
2. Check that the directory exists and is indeed a directory
3. `fs.rm(skillDir, { recursive: true })` to delete the entire directory tree
4. After skill removal, the backend explicitly refreshes the SkillsManager cache via `skillsManager.discoverSkills()` and re-sends skills data to the webview

---

## Installation Detection (Metadata)

Installation status is detected dynamically by scanning configuration files. There is no persistent installation database.

### Project-Level Detection

| Item Type | Config File                               | Detection Logic                                          |
| --------- | ----------------------------------------- | -------------------------------------------------------- |
| Modes     | `{workspace}/.kilocodemodes`              | Parse YAML, record each `mode.slug` from `customModes[]` |
| MCPs      | `{workspace}/.kilocode/mcp.json`          | Parse JSON, record each key in `mcpServers`              |
| Skills    | `{workspace}/.kilocode/skills/*/SKILL.md` | Scan directories, check for `SKILL.md` presence          |

### Global-Level Detection

| Item Type | Config File                             | Detection Logic                      |
| --------- | --------------------------------------- | ------------------------------------ |
| Modes     | `{globalSettingsDir}/custom_modes.yaml` | Same YAML parse logic as project     |
| MCPs      | `{globalSettingsDir}/mcp_settings.json` | Same JSON parse logic as project     |
| Skills    | `~/.kilocode/skills/*/SKILL.md`         | Same directory scan logic as project |

### Important Implication

Since detection is file-based, manually editing config files (adding/removing entries) will be reflected in the marketplace UI. There is no out-of-band tracking.

---

## File Storage Locations

### Project Scope

| Type   | Path                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| Modes  | `{workspace}/.kilocodemodes` (YAML, `{ customModes: [...] }`)                  |
| MCPs   | `{workspace}/.kilocode/mcp.json` (JSON, `{ mcpServers: { [id]: config } }`)    |
| Skills | `{workspace}/.kilocode/skills/{skill-id}/` (directory with `SKILL.md` + files) |

### Global Scope

| Type   | Path                                                                 |
| ------ | -------------------------------------------------------------------- |
| Modes  | `{globalSettingsDir}/custom_modes.yaml` (YAML)                       |
| MCPs   | `{globalSettingsDir}/mcp_settings.json` (JSON)                       |
| Skills | `~/.kilocode/skills/{skill-id}/` (directory with `SKILL.md` + files) |

Where:

- `{globalSettingsDir}` is the VS Code extension's global storage directory
- `~/.kilocode/` is the global Kilo Code directory (via `getGlobalRooDirectory()`)

---

## Organization Integration

Organizations (via `CloudService`) can customize the marketplace:

### Organization Settings

```typescript
{
  hideMarketplaceMcps?: boolean     // If true, hide ALL public marketplace MCPs
  hiddenMcps?: string[]             // Array of MCP item IDs to hide
  mcps?: McpMarketplaceItem[]       // Organization-provided MCP servers
}
```

### Behavior

1. **`hideMarketplaceMcps: true`**: Skips the MCP API fetch entirely; no public MCPs are shown
2. **`hiddenMcps` array**: Filters out specific MCPs by ID from the marketplace results
3. **Organization MCPs** (`mcps` array): Displayed in a separate "Organization" section above the marketplace section on the MCP tab, with an organization icon and name header

Organization settings are loaded from `CloudService` when the user is authenticated.

---

## IPC Message Protocol

### Webview → Extension Host

| Message Type                     | Purpose                        | Key Fields                                                                 |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `fetchMarketplaceData`           | Request fresh marketplace data | —                                                                          |
| `filterMarketplaceItems`         | Send current filter state      | `filters: { type?, search?, tags[] }`                                      |
| `installMarketplaceItem`         | Install a marketplace item     | `mpItem: MarketplaceItem, mpInstallOptions: InstallMarketplaceItemOptions` |
| `removeInstalledMarketplaceItem` | Remove an installed item       | `mpItem: MarketplaceItem, mpInstallOptions: { target }`                    |

### Extension Host → Webview

| Message Type                      | Purpose                        | Key Fields                                                                                                                         |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `marketplaceData`                 | Bulk marketplace data response | `organizationMcps: MarketplaceItem[], marketplaceItems: MarketplaceItem[], marketplaceInstalledMetadata: {...}, errors?: string[]` |
| `marketplaceInstallResult`        | Install success/failure        | `success: boolean, slug: string, error?: string`                                                                                   |
| `marketplaceRemoveResult`         | Remove success/failure         | `success: boolean, slug: string, error?: string`                                                                                   |
| `state` (with marketplace fields) | Periodic state broadcast       | Includes `marketplaceItems` and `marketplaceInstalledMetadata` in `state` object                                                   |

### Data Flow

```
User opens Marketplace tab
    → Webview sends "fetchMarketplaceData"
    → Extension fetches items from API + scans config files for metadata (in parallel)
    → Extension sends "marketplaceData" with items + organizationMcps + installedMetadata
    → Webview state manager updates allItems, displayItems, and installedMetadata
    → UI renders

User clicks Install
    → Webview sends "installMarketplaceItem" with item + options
    → Extension installs to config file, sends VS Code notifications
    → Extension sends "marketplaceInstallResult" {success, slug}
    → Webview shows success/error state
    → On success, webview sends "fetchMarketplaceData" to refresh

User clicks Remove
    → Webview sends "removeInstalledMarketplaceItem" with item + target
    → Extension removes from config file
    → Extension sends "marketplaceRemoveResult" {success, slug}
    → On success, webview sends "fetchMarketplaceData" to refresh
```

---

## Telemetry

Four telemetry events are tracked:

| Event Name                           | When                                         | Properties                                                                                     |
| ------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Marketplace Tab Viewed`             | Tab switches to marketplace                  | —                                                                                              |
| `Marketplace Install Button Clicked` | User clicks Install on a card (before modal) | `itemId`, `itemType`, `itemName`                                                               |
| `Marketplace Item Installed`         | Successful installation (backend)            | `itemId`, `itemType`, `itemName`, `target`, optional `hasParameters`, `installationMethodName` |
| `Marketplace Item Removed`           | Successful removal (backend)                 | `itemId`, `itemType`, `itemName`, `target`                                                     |

---

## Caching & Retry

### API Response Caching

- **In-memory** `Map<string, { data, timestamp }>` with three cache keys: `"modes"`, `"mcps"`, `"skills"`
- **TTL**: 5 minutes (300,000 ms)
- Cache is checked before each fetch; stale entries are evicted
- Cache can be cleared manually via `cleanup()` / `clearCache()`

### HTTP Retry Logic

- **Max retries**: 3 attempts per endpoint
- **Backoff**: Exponential — 1 second, 2 seconds, 4 seconds
- **Timeout**: 10 seconds per request
- **Headers**: `Accept: application/json`, `Content-Type: application/json`
- Uses `axios` for HTTP requests

---

## Post-Install Behavior

After successful installation:

1. The extension shows a VS Code information notification: "Installing {itemName}..." then "Successfully installed {itemName}"
2. The modified configuration file is opened in the editor, with the cursor positioned at the line where the new content was added
3. The install modal transitions to a success state showing:
    - A green checkmark with "Installed" text
    - A "Done" button to close the modal
    - For mode items: a "Go to Modes Settings" button that navigates to the modes settings tab
    - For MCP items: the "Go to MCP Settings" button is hidden (via `display: none`)

After successful removal:

1. The extension shows VS Code information notifications
2. The marketplace view refreshes to reflect the updated installation status
