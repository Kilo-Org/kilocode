# Skills Tarball Installation Implementation Plan

## Context

We're extending the skills marketplace functionality to support installing skills from tarballs (`.tar.gz` files) instead of just downloading a single `SKILL.md` file. This allows skills to include multiple files (scripts, assets, etc.) alongside the main `SKILL.md`.

### Current State (after PRs #5031 and #5197)

The current implementation:

1. **PR #5031**: Added Skills tab to marketplace with browse/search functionality
2. **PR #5197**: Added skill installation by downloading `SKILL.md` from `rawUrl`

Current skill schema (`packages/types/src/skill.ts`):

```typescript
export const skillMarketplaceItemSchema = z.object({
	type: z.literal("skill"),
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	// ... other fields
	category: z.string(),
	githubUrl: z.string(),
	rawUrl: z.string(), // URL to SKILL.md
	displayName: z.string(),
	displayCategory: z.string(),
})
```

Current installation flow (`SimpleInstaller.installSkill`):

1. Fetch `SKILL.md` content from `rawUrl`
2. Create directory `.kilocode/skills/{skill-id}/`
3. Write `SKILL.md` to that directory

### Proposed Change

Add a `content` field to the skill schema that contains a URL to a tarball. The installer will:

1. Download the tarball from `content` URL
2. Extract it to `.kilocode/skills/{skill-id}/`
3. The tarball must contain a `SKILL.md` at the root level

Example tarball structure:

```
artifacts-builder/
├── SKILL.md
├── LICENSE.txt
└── scripts/
    ├── bundle-artifact.sh
    ├── init-artifact.sh
    └── shadcn-components.tar.gz
```

## Implementation Plan

### Phase 1: Schema Changes (packages/types/src/skill.ts)

**Goal**: Add `content` field to skill schema.

The backend will continue to provide `rawUrl` for backwards compatibility, but we will only use `content` for installation. The schema must accept `rawUrl` to avoid parsing errors, but the code will ignore it.

```typescript
export const skillMarketplaceItemSchema = z.object({
	type: z.literal("skill"),
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	// ... other fields
	category: z.string(),
	githubUrl: z.string(),
	rawUrl: z.string(), // Still in API response for backwards compat, ignored in code
	content: z.string(), // URL to tarball (.tar.gz) - used for installation
	displayName: z.string(),
	displayCategory: z.string(),
})
```

### Phase 2: SimpleInstaller Changes (src/services/marketplace/SimpleInstaller.ts)

**Goal**: Update `installSkill` to use `content` (tarball URL) instead of `rawUrl`.

```typescript
private async installSkill(
  item: SkillMarketplaceItem,
  target: "project" | "global",
): Promise<{ filePath: string; line?: number }> {
  const skillsDir = await this.getSkillsDirectoryPath(target)
  const skillDir = path.join(skillsDir, item.id)

  await this.extractTarball(item.content, skillDir)

  const skillFilePath = path.join(skillDir, "SKILL.md")
  return { filePath: skillFilePath, line: 1 }
}
```

### Phase 3: Tarball Extraction Implementation

Use `tar-fs` with `zlib`. `tar-fs` is already a transitive dependency via multiple paths:

- `puppeteer-chromium-resolver → @puppeteer/browsers → tar-fs`
- `puppeteer-core → @puppeteer/browsers → tar-fs`
- `@vscode/vsce → keytar → prebuild-install → tar-fs`

```typescript
import * as tarFs from "tar-fs"
import * as zlib from "zlib"
import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"
import { createWriteStream, createReadStream } from "fs"
import { pipeline } from "stream/promises"

private async extractTarball(tarballUrl: string, destDir: string): Promise<void> {
  // Download tarball
  const response = await fetch(tarballUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch skill tarball: ${response.statusText}`)
  }

  // Write to temp file
  const tempFile = path.join(os.tmpdir(), `skill-${Date.now()}.tar.gz`)
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(tempFile, buffer)

  // Track if extraction started (for rollback on failure)
  let extractionStarted = false

  try {
    // Create destination directory
    await fs.mkdir(destDir, { recursive: true })
    extractionStarted = true

    // Extract tarball with strip: 1 to remove top-level directory
    await pipeline(
      createReadStream(tempFile),
      zlib.createGunzip(),
      tarFs.extract(destDir, { strip: 1 })
    )

    // Verify SKILL.md exists
    await fs.access(path.join(destDir, "SKILL.md"))
  } catch (error) {
    // Rollback: remove partially extracted directory
    if (extractionStarted) {
      await fs.rm(destDir, { recursive: true }).catch(() => {})
    }
    throw error
  } finally {
    // Clean up temp file
    await fs.unlink(tempFile).catch(() => {})
  }
}
```

### Phase 4: Dependencies

**Add `tar-fs` as a direct dependency** to make the import explicit and ensure it's available at runtime (not just as a transitive dev dependency):

```json
// src/package.json
{
	"dependencies": {
		"tar-fs": "^3.1.1"
	}
}
```

Also add TypeScript types:

```json
// src/package.json
{
	"devDependencies": {
		"@types/tar-fs": "^2.0.4"
	}
}
```

Note: `zlib` is built into Node.js, no dependency needed.

### Phase 5: Test Updates

Update `src/services/marketplace/__tests__/SimpleInstaller.skill.spec.ts`:

- Mock `tar-fs.extract` instead of `fetch` for text content
- Test tarball extraction with strip option
- Test rollback on extraction failure
- Test error handling for missing SKILL.md in tarball

## Summary of Changes

| File                                                               | Change Type | Description                                                          |
| ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------- |
| `packages/types/src/skill.ts`                                      | Modify      | Add `content` field (tarball URL)                                    |
| `src/services/marketplace/SimpleInstaller.ts`                      | Modify      | Use `content` for tarball extraction instead of `rawUrl`             |
| `src/package.json`                                                 | Modify      | Add `tar-fs` as direct dependency, `@types/tar-fs` as dev dependency |
| `src/services/marketplace/__tests__/SimpleInstaller.skill.spec.ts` | Modify      | Update tests for tarball extraction                                  |

## Diff Reduction Summary

By using `content` (tarball URL) for installation:

- **Keep**: `rawUrl` in schema (API still returns it for backwards compat) but ignore it in code
- **Simplify**: Single installation path (tarball only)
- **Net change**: ~+40 lines for tarball extraction, -15 lines for removing rawUrl usage = ~+25 lines net

The total diff impact is minimal because:

1. We're replacing one download mechanism with another
2. The tarball extraction adds ~40 lines (including rollback logic)
3. Schema changes are minimal (add `content` field)

## Confirmed Assumptions

1. **Backend always provides `content` (tarball URL)** - The API will always include this field
2. **Backend continues to provide `rawUrl`** - For backwards compatibility, but we ignore it
3. **Tarball structure** (verified with `artifacts-builder.tar.gz`):
    ```
    artifacts-builder/           # Top-level directory (stripped with strip: 1)
    ├── SKILL.md                 # Required at root after extraction
    ├── LICENSE.txt
    └── scripts/
        ├── bundle-artifact.sh
        ├── init-artifact.sh
        └── shadcn-components.tar.gz
    ```
4. **Only `.tar.gz` format** - We only need to support gzipped tarballs
5. **Tarballs are trusted** - We control the API and tarball creation, so no security validation needed
6. **Reinstallation not needed** - Install button is hidden for already-installed skills
