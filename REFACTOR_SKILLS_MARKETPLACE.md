# Skills Marketplace Refactoring Task

## Overview

This task addresses PR review comments on PR #5031 that request consolidating the skills marketplace implementation to reuse existing patterns instead of creating duplicate code paths.

## Problem Statement

The current implementation creates separate, parallel code paths for skills fetching that duplicate existing patterns used for modes and MCPs:

1. **Separate state properties** in `MarketplaceViewStateManager.ts`:

    - `skills: Skill[]` - separate from `allItems: MarketplaceItem[]`
    - `isFetchingSkills: boolean` - separate from `isFetching: boolean`

2. **Separate transitions** in `MarketplaceViewStateManager.ts`:

    - `FETCH_SKILLS` - duplicates `FETCH_ITEMS`
    - `FETCH_SKILLS_COMPLETE` - duplicates `FETCH_COMPLETE`
    - `FETCH_SKILLS_ERROR` - duplicates `FETCH_ERROR`

3. **Separate message handler** in `webviewMessageHandler.ts`:

    - `fetchSkillsMarketplaceData` case - separate from `fetchMarketplaceData`

4. **Separate ClineProvider method**:
    - `fetchSkillsMarketplaceData()` - duplicates logic that should be in `RemoteConfigLoader`

## Reviewer Comments

1. **MarketplaceViewStateManager.ts line 25**: "cant we reuse the generic one?" + "and use src/services/marketplace/RemoteConfigLoader.ts"
2. **MarketplaceViewStateManager.ts line 46**: "same here, why not reuse the generic ones?"
3. **webviewMessageHandler.ts line 3608**: "i would expect this to be integrated with fetchMarketplaceData as well"
4. **ClineProvider.ts line 2006**: "integrate into remoteconfigloader"

## Current Architecture

### RemoteConfigLoader.ts (already has skills support)

```typescript
// Already has loadSkills() method that fetches from /api/marketplace/skills
// Has separate skillsCache for skills (different type than MarketplaceItem)
async loadSkills(): Promise<Skill[]> {
  // Check cache first
  // Fetch from API
  // Parse YAML and validate with Zod schema
  // Cache and return
}
```

### ClineProvider.ts (duplicate implementation)

```typescript
// This duplicates RemoteConfigLoader logic - should be removed
async fetchSkillsMarketplaceData() {
  // Fetches from /api/marketplace/skills
  // Parses YAML
  // Sends skillsMarketplaceData message
}
```

### webviewMessageHandler.ts

```typescript
// Existing handler for modes/MCPs
case "fetchMarketplaceData": {
  await provider.fetchMarketplaceData()
  break
}

// Separate handler for skills - should be integrated
case "fetchSkillsMarketplaceData": {
  await provider.fetchSkillsMarketplaceData()
  break
}
```

### MarketplaceViewStateManager.ts

```typescript
// Generic state for modes/MCPs
allItems: MarketplaceItem[]
isFetching: boolean

// Separate state for skills - should be integrated
skills: Skill[]
isFetchingSkills: boolean

// Generic transitions
FETCH_ITEMS, FETCH_COMPLETE, FETCH_ERROR

// Separate transitions for skills - should be removed
FETCH_SKILLS, FETCH_SKILLS_COMPLETE, FETCH_SKILLS_ERROR
```

## Required Changes

### 1. Update RemoteConfigLoader.ts

The `loadAllItems()` method should optionally include skills:

```typescript
interface LoadAllItemsOptions {
  hideMarketplaceMcps?: boolean
  includeSkills?: boolean
}

async loadAllItems(options: LoadAllItemsOptions = {}): Promise<{
  items: MarketplaceItem[]
  skills?: Skill[]
}> {
  const { hideMarketplaceMcps = false, includeSkills = false } = options

  const modesPromise = this.fetchModes()
  const mcpsPromise = hideMarketplaceMcps ? Promise.resolve([]) : this.fetchMcps()
  const skillsPromise = includeSkills ? this.loadSkills() : Promise.resolve(undefined)

  const [modes, mcps, skills] = await Promise.all([modesPromise, mcpsPromise, skillsPromise])

  return {
    items: [...modes, ...mcps],
    skills,
  }
}
```

### 2. Update ClineProvider.ts

Remove the separate `fetchSkillsMarketplaceData()` method and integrate skills into `fetchMarketplaceData()`:

```typescript
async fetchMarketplaceData() {
  try {
    const hideMarketplaceMcps = this.getGlobalState("hideMarketplaceMcps") ?? false
    const includeSkills = SKILLS_MARKETPLACE_ENABLED

    const { items, skills } = await this.remoteConfigLoader.loadAllItems({
      hideMarketplaceMcps,
      includeSkills,
    })

    // ... existing code for organization MCPs and installed metadata ...

    this.postMessageToWebview({
      type: "marketplaceData",
      marketplaceItems: items,
      organizationMcps,
      marketplaceInstalledMetadata,
      skills: skills || [], // Include skills in the same message
    })
  } catch (error) {
    // ... error handling ...
  }
}
```

Delete the `fetchSkillsMarketplaceData()` method entirely.

### 3. Update webviewMessageHandler.ts

Remove the separate `fetchSkillsMarketplaceData` case - skills will be fetched as part of `fetchMarketplaceData`.

```typescript
// DELETE this case:
case "fetchSkillsMarketplaceData": {
  await provider.fetchSkillsMarketplaceData()
  break
}
```

### 4. Update MarketplaceViewStateManager.ts

#### 4.1 Remove separate skills state properties

Keep `skills: Skill[]` in ViewState but remove `isFetchingSkills: boolean` - use the generic `isFetching` instead.

```typescript
export interface ViewState {
	allItems: MarketplaceItem[]
	organizationMcps: MarketplaceItem[]
	displayItems?: MarketplaceItem[]
	displayOrganizationMcps?: MarketplaceItem[]
	skills: Skill[] // Keep this - skills have different type than MarketplaceItem
	// REMOVE: isFetchingSkills: boolean
	isFetching: boolean
	activeTab: "mcp" | "mode" | "skills"
	// ... rest unchanged
}
```

#### 4.2 Remove separate skills transitions

Delete these from `TransitionPayloads`:

- `FETCH_SKILLS`
- `FETCH_SKILLS_COMPLETE`
- `FETCH_SKILLS_ERROR`

#### 4.3 Update transition handlers

Remove the `FETCH_SKILLS`, `FETCH_SKILLS_COMPLETE`, and `FETCH_SKILLS_ERROR` case handlers.

#### 4.4 Update handleMessage to process skills from marketplaceData

The `marketplaceData` message handler already includes skills - just ensure it updates the skills state:

```typescript
if (message.type === "marketplaceData") {
	const marketplaceItems = message.marketplaceItems
	const organizationMcps = message.organizationMcps || []
	const marketplaceInstalledMetadata = message.marketplaceInstalledMetadata
	const skills = message.skills || []

	// ... existing filtering logic ...

	this.state = {
		...this.state,
		isFetching: false,
		allItems: items,
		organizationMcps: orgMcps,
		displayItems: newDisplayItems,
		displayOrganizationMcps: newDisplayOrganizationMcps,
		installedMetadata: marketplaceInstalledMetadata || this.state.installedMetadata,
		skills: [...skills], // Already included
	}
}
```

Remove the separate `skillsMarketplaceData` handler.

### 5. Update MarketplaceView.tsx

Change the skills fetch trigger to use the generic `fetchMarketplaceData`:

```typescript
// BEFORE:
useEffect(() => {
	if (SKILLS_MARKETPLACE_ENABLED && state.activeTab === "skills" && state.skills.length === 0) {
		vscode.postMessage({ type: "fetchSkillsMarketplaceData" })
	}
}, [state.activeTab, state.skills.length])

// AFTER:
// Skills are now fetched as part of fetchMarketplaceData, so this effect can be removed
// or changed to trigger a generic refresh if needed
```

### 6. Update ExtensionMessage.ts

Remove the separate `skillsMarketplaceData` message type since skills are now included in `marketplaceData`:

```typescript
// REMOVE from type union:
| "skillsMarketplaceData"
```

### 7. Update WebviewMessage.ts

Remove the separate `fetchSkillsMarketplaceData` message type:

```typescript
// REMOVE from type union:
| "fetchSkillsMarketplaceData"
```

## Files to Modify

1. `src/services/marketplace/RemoteConfigLoader.ts` - Update `loadAllItems()` signature
2. `src/core/webview/ClineProvider.ts` - Remove `fetchSkillsMarketplaceData()`, update `fetchMarketplaceData()`
3. `src/core/webview/webviewMessageHandler.ts` - Remove `fetchSkillsMarketplaceData` case
4. `webview-ui/src/components/marketplace/MarketplaceViewStateManager.ts` - Remove separate skills transitions and state
5. `webview-ui/src/components/marketplace/MarketplaceView.tsx` - Update skills fetch trigger
6. `src/shared/ExtensionMessage.ts` - Remove `skillsMarketplaceData` type
7. `src/shared/WebviewMessage.ts` - Remove `fetchSkillsMarketplaceData` type

## Testing

After making these changes:

1. Run existing marketplace tests: `cd src && pnpm test services/marketplace`
2. Run webview tests: `cd webview-ui && pnpm test`
3. Manually test the skills tab in development mode to ensure skills load correctly
4. Verify that modes and MCPs still load correctly (no regression)

## Notes

- The `Skill` type is different from `MarketplaceItem`, so we need to keep a separate `skills` array in state
- The key insight is that the _fetching mechanism_ should be unified, not necessarily the data structures
- Skills should be fetched alongside modes/MCPs in a single API call pattern, even if stored separately
- The `SKILLS_MARKETPLACE_ENABLED` feature flag should still control whether skills are fetched and displayed
