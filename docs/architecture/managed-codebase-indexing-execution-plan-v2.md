# Managed Codebase Indexing - Execution Plan v2

## Executive Summary

This plan outlines a **delta-based, client-driven** Managed Codebase Indexing system for Kilo Code organization users. The system uses:

- **Line-based chunking** (simple, fast, no tree-sitter)
- **Delta indexing** (only changed files on feature branches)
- **Client-driven search** (client sends deleted files list)
- **Functional architecture** (stateless functions, Go-style)
- **Server-side embeddings** (no client computation)

## Git Branch Strategy (Simplified)

### Core Principle

**Main branch**: Full index (shared across organization)
**Feature branches**: Only index changed files (delta from main)
**Search**: Client-driven preference with deleted files exclusion

### How It Works

#### 1. Main Branch Indexing

```typescript
// Full index of main branch (done once, shared by all)
async function indexMainBranch(config: Config): Promise<void> {
	const allFiles = await scanWorkspace(config.workspacePath)

	for (const file of allFiles) {
		const chunks = await chunkFile(file, config)
		chunks.forEach((chunk) => {
			chunk.gitBranch = "main"
			chunk.isBaseBranch = true
		})
		await upsertChunks(chunks, config)
	}
}

// Result: ~10,000 files = ~200,000 chunks indexed on main
```

#### 2. Feature Branch Indexing (Delta Only)

```typescript
// Only index files that changed from main
async function indexFeatureBranch(config: Config): Promise<void> {
	// 1. Get git diff from main
	const diff = await getGitDiff(config.gitBranch, "main", config.workspacePath)
	// Returns: { added: [5 files], modified: [3 files], deleted: [2 files] }

	// 2. Index only added + modified files (NOT deleted)
	const filesToIndex = [...diff.added, ...diff.modified]

	for (const file of filesToIndex) {
		const chunks = await chunkFile(file, config)
		chunks.forEach((chunk) => {
			chunk.gitBranch = config.gitBranch // 'feature/new-api'
			chunk.isBaseBranch = false
		})
		await upsertChunks(chunks, config)
	}

	// 3. Store deleted files list in client cache (NOT on server)
	await saveToClientCache({
		gitBranch: config.gitBranch,
		deletedFiles: diff.deleted, // Just file paths
	})
}

// Result: Only 8 files = ~160 chunks indexed
// 99.92% reduction vs full index!
```

#### 3. Client-Driven Search

````typescript

### Git Commit SHA: Do We Need It?

**Short answer**: Optional for v1, useful for future enhancements.

#### Current Use Cases

**1. Debugging & Auditing**:
```typescript
// Track when/what was indexed
{
  filePath: "src/api.ts",
  gitBranch: "feature/new-api",
  gitCommitSha: "abc123def456",  // Helps debug: "what version was indexed?"
  lastIndexed: "2024-01-15T10:30:00Z"
}
````

**2. Stale Detection** (optional):

```typescript
// Detect if indexed version is behind current commit
async function isIndexStale(config: Config): Promise<boolean> {
	const currentSha = await getCurrentCommitSha(config.workspacePath)
	const indexedSha = clientCache.gitCommitSha

	return currentSha !== indexedSha
}
```

**3. Multi-Client Coordination** (optional):

```typescript
// Two developers on same branch, different commits
// Developer A: commit abc123
// Developer B: commit def456 (ahead of A)

// Server can detect: "B's index is newer, skip A's upload"
if (incomingCommitSha < existingCommitSha) {
	return { skipped: true, reason: "stale commit" }
}
```

#### Recommendation: Make It Optional

**Minimal v1 (no commit SHA)**:

```typescript
export interface ManagedCodeChunk {
	id: string
	organizationId: string
	projectId: string
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	chunkHash: string
	gitBranch: string // Required
	// gitCommitSha: REMOVED - not needed for basic functionality
	isBaseBranch: boolean
}
```

---

## Server Manifest: Deep Dive

### What Is It?

The server manifest is a **lightweight index of what files are currently indexed** for a given organization/project/branch. It's essentially a "table of contents" for the embeddings database.

### Purpose

1. **Avoid redundant indexing**: Client can check what's already indexed before uploading
2. **Multi-client coordination**: Multiple developers don't re-index the same files
3. **Sync on startup**: Client can quickly determine what needs updating
4. **Deleted file detection**: Find files that exist on server but not locally

### API Endpoint

```typescript
GET /api/codebase-indexing/manifest?organizationId={id}&projectId={id}&gitBranch={branch}

Response: {
  organizationId: string
  projectId: string
  gitBranch: string
  files: Array<{
    filePath: string
    fileHash: string        // SHA-256 of file content
    chunkCount: number      // How many chunks for this file
    lastIndexed: string     // ISO timestamp
    indexedBy?: string      // Optional: which user/client indexed it
  }>
  totalFiles: number
  totalChunks: number
  lastUpdated: string       // When manifest was last modified
}
```

### Example Response

```json
{
	"organizationId": "org-123",
	"projectId": "proj-456",
	"gitBranch": "main",
	"files": [
		{
			"filePath": "src/app.ts",
			"fileHash": "a1b2c3d4e5f6...",
			"chunkCount": 25,
			"lastIndexed": "2024-01-15T10:30:00Z",
			"indexedBy": "user-789"
		},
		{
			"filePath": "src/utils.ts",
			"fileHash": "f6e5d4c3b2a1...",
			"chunkCount": 18,
			"lastIndexed": "2024-01-15T10:31:00Z",
			"indexedBy": "user-789"
		}
		// ... 9,998 more files
	],
	"totalFiles": 10000,
	"totalChunks": 200000,
	"lastUpdated": "2024-01-15T10:45:00Z"
}
```

### Database Schema

```sql
-- Manifest table (separate from chunks for performance)
CREATE TABLE indexed_file_manifest (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  git_branch VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  chunk_count INTEGER NOT NULL,
  last_indexed TIMESTAMP NOT NULL,
  indexed_by VARCHAR(255),

  -- Ensure one entry per file per branch
  UNIQUE(organization_id, project_id, git_branch, file_path)
);

-- Fast manifest queries
CREATE INDEX idx_manifest_lookup
  ON indexed_file_manifest(organization_id, project_id, git_branch);

-- Fast file lookup
CREATE INDEX idx_manifest_file
  ON indexed_file_manifest(organization_id, project_id, git_branch, file_path);
```

### How Client Uses Manifest

#### Scenario 1: Initial Scan

```typescript
async function performInitialScan(config: Config): Promise<void> {
	// 1. Get server manifest
	const manifest = await getServerManifest(config.organizationId, config.projectId, config.gitBranch)

	// 2. Get local files
	const localFiles = await scanWorkspace(config.workspacePath)

	// 3. Compare and determine what to index
	const filesToIndex: string[] = []
	const filesToDelete: string[] = []

	for (const localFile of localFiles) {
		const localHash = await getFileHash(localFile)
		const manifestEntry = manifest.files.find((f) => f.filePath === localFile)

		if (!manifestEntry) {
			// File not on server - needs indexing
			filesToIndex.push(localFile)
		} else if (manifestEntry.fileHash !== localHash) {
			// File changed - needs re-indexing
			filesToIndex.push(localFile)
		}
		// else: file unchanged, skip
	}

	// Find files on server but not local (deleted)
	for (const manifestEntry of manifest.files) {
		if (!localFiles.includes(manifestEntry.filePath)) {
			filesToDelete.push(manifestEntry.filePath)
		}
	}

	// 4. Execute operations
	console.log(`Need to index: ${filesToIndex.length} files`)
	console.log(`Need to delete: ${filesToDelete.length} files`)

	if (filesToDelete.length > 0) {
		await deleteFiles(filesToDelete, config)
	}

	if (filesToIndex.length > 0) {
		await indexFiles(filesToIndex, config)
	}
}
```

#### Scenario 2: Multi-Client Coordination

**Problem**: Two developers on same branch might try to index same files

**Solution**: Manifest provides coordination

```typescript
// Developer A starts indexing at 10:00 AM
// Developer B starts indexing at 10:05 AM

// Developer B's client:
async function smartScan(config: Config): Promise<void> {
	// 1. Get fresh manifest
	const manifest = await getServerManifest(config)

	// 2. Check each file
	for (const localFile of localFiles) {
		const localHash = await getFileHash(localFile)
		const manifestEntry = manifest.files.find((f) => f.filePath === localFile)

		if (manifestEntry && manifestEntry.fileHash === localHash) {
			// Another client already indexed this file with same hash
			console.log(`Skipping ${localFile} - already indexed by ${manifestEntry.indexedBy}`)

			// Update local cache to reflect server state
			clientCache.files[localFile] = {
				hash: localHash,
				lastIndexed: Date.parse(manifestEntry.lastIndexed),
				chunkCount: manifestEntry.chunkCount,
			}

			continue // Skip this file
		}

		// File needs indexing
		await indexFile(localFile, config)
	}
}
```

**Result**: Developer B skips files already indexed by Developer A, saving time and server resources!

#### Scenario 3: Incremental Sync

**Problem**: Client was offline, needs to catch up

**Solution**: Manifest shows what changed

```typescript
async function syncAfterOffline(config: Config): Promise<void> {
	// 1. Load client cache (last known state)
	const clientCache = await loadClientCache(config.gitBranch)

	// 2. Get current server manifest
	const manifest = await getServerManifest(config)

	// 3. Find discrepancies
	const needsUpdate: string[] = []

	for (const [filePath, cacheEntry] of Object.entries(clientCache.files)) {
		const manifestEntry = manifest.files.find((f) => f.filePath === filePath)

		if (!manifestEntry) {
			// File was deleted on server (by another client)
			needsUpdate.push(filePath)
		} else if (manifestEntry.fileHash !== cacheEntry.hash) {
			// File was updated on server (by another client)
			needsUpdate.push(filePath)
		}
	}

	// 4. Re-scan affected files
	for (const filePath of needsUpdate) {
		await indexFile(filePath, config)
	}
}
```

### Manifest Update Flow

```typescript
// When client upserts chunks
async function upsertChunks(chunks: ManagedCodeChunk[]): Promise<void> {
	// 1. Upsert chunks to embeddings table
	await db.upsertChunks(chunks)

	// 2. Update manifest (grouped by file)
	const fileGroups = groupChunksByFile(chunks)

	for (const [filePath, fileChunks] of fileGroups) {
		await db.upsertManifestEntry({
			organizationId: chunks[0].organizationId,
			projectId: chunks[0].projectId,
			gitBranch: chunks[0].gitBranch,
			filePath,
			fileHash: calculateFileHash(fileChunks),
			chunkCount: fileChunks.length,
			lastIndexed: new Date(),
			indexedBy: getCurrentUserId(),
		})
	}
}

// When client deletes files
async function deleteFiles(filePaths: string[], config: Config): Promise<void> {
	// 1. Delete chunks
	await db.deleteChunks({
		organizationId: config.organizationId,
		projectId: config.projectId,
		gitBranch: config.gitBranch,
		filePaths,
	})

	// 2. Delete manifest entries
	await db.deleteManifestEntries({
		organizationId: config.organizationId,
		projectId: config.projectId,
		gitBranch: config.gitBranch,
		filePaths,
	})
}
```

### Manifest Caching

**Server-side caching** (optional optimization):

```typescript
// Cache manifest in Redis for fast retrieval
async function getServerManifest(organizationId: string, projectId: string, gitBranch: string): Promise<Manifest> {
	const cacheKey = `manifest:${organizationId}:${projectId}:${gitBranch}`

	// Try cache first
	const cached = await redis.get(cacheKey)
	if (cached) {
		return JSON.parse(cached)
	}

	// Query database
	const manifest = await db.getManifest(organizationId, projectId, gitBranch)

	// Cache for 5 minutes
	await redis.setex(cacheKey, 300, JSON.stringify(manifest))

	return manifest
}

// Invalidate cache when manifest changes
async function onManifestUpdate(organizationId: string, projectId: string, gitBranch: string): Promise<void> {
	const cacheKey = `manifest:${organizationId}:${projectId}:${gitBranch}`
	await redis.del(cacheKey)
}
```

### Manifest Size Considerations

**For large codebases** (100,000+ files):

**Option 1: Paginated manifest**:

```typescript
GET /api/codebase-indexing/manifest?page=1&pageSize=1000

Response: {
  files: [...],  // 1000 files
  totalFiles: 100000,
  page: 1,
  pageSize: 1000,
  totalPages: 100
}
```

**Option 2: Hash-only manifest**:

```typescript
// Just file paths and hashes (no chunk counts, timestamps)
GET /api/codebase-indexing/manifest/hashes

Response: {
  "src/app.ts": "a1b2c3...",
  "src/utils.ts": "f6e5d4...",
  // ... 99,998 more
}
// Much smaller payload (~2MB vs ~10MB)
```

**Option 3: Incremental manifest**:

```typescript
// Only get changes since last sync
GET /api/codebase-indexing/manifest/delta?since=2024-01-15T10:00:00Z

Response: {
  added: [{ filePath: "src/new.ts", fileHash: "..." }],
  modified: [{ filePath: "src/app.ts", fileHash: "..." }],
  deleted: ["src/old.ts"]
}
```

### When Manifest Is Fetched

```typescript
// 1. On workspace open (if not in cache)
async function onWorkspaceOpen(config: Config): Promise<void> {
	const manifest = await getServerManifest(config)
	// Use manifest to determine what to index
}

// 2. On branch switch
async function onBranchSwitch(newBranch: string, config: Config): Promise<void> {
	const manifest = await getServerManifest({
		...config,
		gitBranch: newBranch,
	})
	// Sync with new branch's manifest
}

// 3. On manual refresh (user clicks "Refresh Index")
async function onManualRefresh(config: Config): Promise<void> {
	const manifest = await getServerManifest(config)
	// Force sync with server state
}

// 4. Periodically (optional background sync)
setInterval(
	async () => {
		const manifest = await getServerManifest(config)
		// Check for changes made by other clients
	},
	5 * 60 * 1000,
) // Every 5 minutes
```

### Manifest vs Client Cache

**Client Cache** (local, fast):

- Stored on disk
- Instant access
- Tracks local state
- May be stale

**Server Manifest** (remote, authoritative):

- Stored in database
- Requires API call
- Tracks server state
- Always current

**Best practice**: Use client cache for quick decisions, sync with server manifest periodically.

### Example: Startup Flow

```typescript
async function onStartup(config: Config): Promise<void> {
	// 1. Load client cache (instant)
	const clientCache = await loadClientCache(config.gitBranch)
	console.log(`Client cache: ${Object.keys(clientCache.files).length} files`)

	// 2. Get server manifest (1 API call)
	const manifest = await getServerManifest(config)
	console.log(`Server manifest: ${manifest.totalFiles} files`)

	// 3. Compare
	const localFiles = await scanWorkspace(config.workspacePath)

	const needsIndexing = localFiles.filter((file) => {
		const localHash = getFileHashSync(file)
		const manifestEntry = manifest.files.find((f) => f.filePath === file)
		const cacheEntry = clientCache.files[file]

		// Index if:
		// - Not in manifest (new file)
		// - Hash mismatch with manifest (changed file)
		// - Not in client cache (cache miss)
		return !manifestEntry || manifestEntry.fileHash !== localHash || !cacheEntry
	})

	console.log(`Need to index: ${needsIndexing.length} files`)

	// 4. Index only what's needed
	if (needsIndexing.length > 0) {
		await indexFiles(needsIndexing, config, clientCache)
	}

	// 5. Update client cache to match server
	for (const manifestEntry of manifest.files) {
		if (!clientCache.files[manifestEntry.filePath]) {
			clientCache.files[manifestEntry.filePath] = {
				hash: manifestEntry.fileHash,
				lastIndexed: Date.parse(manifestEntry.lastIndexed),
				chunkCount: manifestEntry.chunkCount,
			}
		}
	}

	await saveClientCache(clientCache)
}
```

### Manifest Benefits

**Without manifest**:

```typescript
// Client must index everything it finds locally
// No way to know what's already on server
// Lots of redundant work
const allFiles = await scanWorkspace()
await indexFiles(allFiles) // Could be 10,000 files!
```

**With manifest**:

```typescript
// Client only indexes what's missing or changed
const manifest = await getServerManifest()
const needsIndexing = compareWithManifest(localFiles, manifest)
await indexFiles(needsIndexing) // Maybe only 10 files!
```

**Time savings**:

- Without manifest: 30-60 minutes (full scan)
- With manifest: 30-60 seconds (delta scan)
- **60x faster!**

### Manifest Maintenance

**Server automatically maintains manifest**:

```typescript
// On chunk upsert
async function onChunkUpsert(chunks: ManagedCodeChunk[]): Promise<void> {
	// Group chunks by file
	const fileGroups = groupBy(chunks, (c) => c.filePath)

	for (const [filePath, fileChunks] of fileGroups) {
		// Calculate file hash from chunks
		const fileHash = calculateFileHashFromChunks(fileChunks)

		// Upsert manifest entry
		await db.query(
			`
      INSERT INTO indexed_file_manifest (
        organization_id, project_id, git_branch, file_path,
        file_hash, chunk_count, last_indexed, indexed_by
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      ON CONFLICT (organization_id, project_id, git_branch, file_path)
      DO UPDATE SET
        file_hash = EXCLUDED.file_hash,
        chunk_count = EXCLUDED.chunk_count,
        last_indexed = NOW(),
        indexed_by = EXCLUDED.indexed_by
    `,
			[
				chunks[0].organizationId,
				chunks[0].projectId,
				chunks[0].gitBranch,
				filePath,
				fileHash,
				fileChunks.length,
				getCurrentUserId(),
			],
		)
	}
}

// On file deletion
async function onFileDelete(
	filePaths: string[],
	organizationId: string,
	projectId: string,
	gitBranch: string,
): Promise<void> {
	// Delete manifest entries
	await db.query(
		`
    DELETE FROM indexed_file_manifest
    WHERE organization_id = $1
      AND project_id = $2
      AND git_branch = $3
      AND file_path = ANY($4)
  `,
		[organizationId, projectId, gitBranch, filePaths],
	)
}
```

### Manifest Query Performance

**Optimizations**:

1. **Indexed queries**: Fast lookups by org/project/branch
2. **Caching**: Redis cache for frequently accessed manifests
3. **Compression**: Gzip response for large manifests
4. **Pagination**: For very large codebases (100k+ files)

**Query performance**:

```sql
-- Fast: Uses index
SELECT * FROM indexed_file_manifest
WHERE organization_id = 'org-123'
  AND project_id = 'proj-456'
  AND git_branch = 'main';
-- Returns 10,000 rows in ~50ms

-- Even faster: Count only
SELECT COUNT(*), SUM(chunk_count)
FROM indexed_file_manifest
WHERE organization_id = 'org-123'
  AND project_id = 'proj-456'
  AND git_branch = 'main';
-- Returns in ~10ms
```

### Alternative: No Manifest (Simpler)

**Could we skip the manifest?**

Yes, but with trade-offs:

**Without manifest**:

```typescript
// Client must index everything locally
// No coordination between clients
// More redundant work
// Simpler server (no manifest table)
```

**With manifest**:

```typescript
// Client only indexes what's needed
// Multi-client coordination
// Less redundant work
// Slightly more complex server
```

**Recommendation**: **Include manifest** - the performance and coordination benefits far outweigh the small complexity cost.

**Why it's not essential**:

1. File hash already provides change detection
2. Branch name provides isolation
3. Client cache handles staleness locally
4. Simpler API and database schema

**When to add it back**:

- Multi-client coordination needed
- Historical search features wanted
- Audit trail requirements
- Commit-based cache invalidation

**Recommendation**: Start without it, add later if needed. The file hash + branch name are sufficient for the core functionality.

// Client determines what to exclude and sends with search
async function searchCode(query: string, config: Config): Promise<SearchResult[]> {
// 1. Get deleted files from client cache
const cache = await loadClientCache(config.gitBranch)
const deletedFiles = cache.deletedFiles || []

    // 2. Single search request with preferences
    const results = await apiClient.search({
    	query,
    	organizationId: config.organizationId,
    	projectId: config.projectId,
    	preferBranch: config.gitBranch, // Prefer feature branch
    	fallbackBranch: "main", // Fall back to main
    	excludeFiles: deletedFiles, // Omit deleted files
    })

    return results

}

````

#### 4. Server-Side Search Logic

```typescript
// Server handles preference-based search
async function searchWithPreferences(request: SearchRequest): Promise<SearchResult[]> {
	const { query, preferBranch, fallbackBranch, excludeFiles } = request

	// 1. Search both branches in parallel
	const [preferResults, fallbackResults] = await Promise.all([
		vectorSearch(query, preferBranch),
		vectorSearch(query, fallbackBranch),
	])

	// 2. Combine with preference logic
	const resultMap = new Map<string, SearchResult>()

	// Add fallback results (lower priority)
	for (const result of fallbackResults) {
		if (!excludeFiles.includes(result.filePath)) {
			resultMap.set(result.filePath, result)
		}
	}

	// Override with preferred branch (higher priority)
	for (const result of preferResults) {
		resultMap.set(result.filePath, {
			...result,
			fromPreferredBranch: true,
		})
	}

	// 3. Sort by score and return
	return Array.from(resultMap.values()).sort((a, b) => b.score - a.score)
}
````

### Data Model

```typescript
export interface ManagedCodeChunk {
	id: string
	organizationId: string
	projectId: string
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	chunkHash: string
	gitBranch: string // 'main' or 'feature/xyz'
	gitCommitSha: string
	isBaseBranch: boolean // true for main, false for features
}

export interface ClientCache {
	gitBranch: string
	gitCommitSha: string
	deletedFiles: string[] // Files deleted on this branch vs main
	files: Record<
		string,
		{
			hash: string
			lastIndexed: number
			chunkCount: number
		}
	>
}
```

### Example Scenarios

#### Scenario 1: File Deleted on Feature Branch

**Setup**:

- Main has `utils.ts` (indexed)
- Feature branch deletes `utils.ts`

**What happens**:

```typescript
// 1. Git diff detects deletion
const diff = await getGitDiff("feature/refactor", "main")
// diff.deleted = ['src/utils.ts']

// 2. Client stores in cache (NOT sent to server)
clientCache.deletedFiles = ["src/utils.ts"]

// 3. Search on feature branch
const results = await searchCode("utils", config)
// Client sends: excludeFiles: ['src/utils.ts']
// Server searches main, excludes utils.ts
// Returns: No utils.ts results ✓
```

**Storage**:

- Main: utils.ts chunks still indexed (for other branches)
- Feature: No chunks stored (just client cache entry)
- Cost: 0 additional chunks!

#### Scenario 2: File Modified on Feature Branch

**Setup**:

- Main has `api.ts` with old code (indexed)
- Feature branch modifies `api.ts`

**What happens**:

```typescript
// 1. Git diff detects modification
const diff = await getGitDiff("feature/improve-api", "main")
// diff.modified = ['src/api.ts']

// 2. Re-index entire file on feature branch
const chunks = await chunkFile("src/api.ts", config)
chunks.forEach((c) => (c.gitBranch = "feature/improve-api"))
await upsertChunks(chunks, config)

// 3. Search on feature branch
const results = await searchCode("api", config)
// Server searches:
//   - feature/improve-api: finds new api.ts chunks
//   - main: finds old api.ts chunks
// Preference logic: feature branch wins for api.ts
// Returns: New implementation from feature branch ✓
```

**Storage**:

- Main: Old api.ts chunks (~20 chunks)
- Feature: New api.ts chunks (~20 chunks)
- Cost: 20 additional chunks (not 200,000!)

#### Scenario 3: File Added on Feature Branch

**Setup**:

- Main doesn't have `newFeature.ts`
- Feature branch adds `newFeature.ts`

**What happens**:

```typescript
// 1. Git diff detects addition
const diff = await getGitDiff("feature/new-api", "main")
// diff.added = ['src/newFeature.ts']

// 2. Index new file on feature branch
const chunks = await chunkFile("src/newFeature.ts", config)
chunks.forEach((c) => (c.gitBranch = "feature/new-api"))
await upsertChunks(chunks, config)

// 3. Search on feature branch
const results = await searchCode("newFeature", config)
// Server searches:
//   - feature/new-api: finds newFeature.ts
//   - main: nothing
// Returns: Results from feature branch ✓
```

**Storage**:

- Main: No chunks for newFeature.ts
- Feature: newFeature.ts chunks (~20 chunks)
- Cost: 20 additional chunks

### Cost Analysis

**10,000 file codebase, 10 active feature branches**:

**Main branch**:

- 10,000 files × 20 chunks = 200,000 chunks
- Storage: ~500MB embeddings
- Index time: ~30-60 minutes (one-time)

**Feature branches** (average 10 changed files each):

- Branch 1: 10 files × 20 chunks = 200 chunks
- Branch 2: 10 files × 20 chunks = 200 chunks
- ... (8 more)
- Total: 2,000 chunks
- Storage: ~5MB embeddings
- Index time per branch: ~30-60 seconds

**Total**:

- 202,000 chunks (~505MB)
- **99% reduction** vs full index per branch
- **60x faster** feature branch indexing

### API Endpoints

#### Search with Preferences

```typescript
POST /api/codebase-indexing/search

Body: {
  query: string
  organizationId: string
  projectId: string
  preferBranch: string       // Search this branch first
  fallbackBranch: string     // Fall back to this branch
  excludeFiles: string[]     // Files to exclude (deleted on preferBranch)
  path?: string              // Optional directory filter
}

Response: Array<{
  id: string
  filePath: string
  codeChunk: string
  startLine: number
  endLine: number
  score: number
  gitBranch: string          // Which branch this result came from
  fromPreferredBranch: boolean
}>
```

#### Upsert Chunks

```typescript
PUT / api / codebase - indexing / upsert

Body: {
	chunks: Array<{
		id: string
		organizationId: string
		projectId: string
		filePath: string
		codeChunk: string
		startLine: number
		endLine: number
		chunkHash: string
		gitBranch: string // 'main' or 'feature/xyz'
		gitCommitSha: string
		isBaseBranch: boolean
	}>
}
```

#### Delete Files (Branch-Scoped)

```typescript
DELETE /api/codebase-indexing/files

Body: {
  organizationId: string
  projectId: string
  gitBranch: string          // Only delete from this branch
  filePaths: string[]
}
```

### Database Schema

```sql
-- Single table for all chunks
CREATE TABLE code_chunks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  project_id UUID NOT NULL,
  git_branch VARCHAR(255) NOT NULL,
  git_commit_sha VARCHAR(40) NOT NULL,
  file_path TEXT NOT NULL,
  code_chunk TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  chunk_hash VARCHAR(64) NOT NULL,
  embedding VECTOR(1536),
  is_base_branch BOOLEAN NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Composite unique constraint
  UNIQUE(organization_id, project_id, git_branch, file_path, start_line, end_line)
);

-- Indexes for efficient queries
CREATE INDEX idx_chunks_search
  ON code_chunks(organization_id, project_id, git_branch)
  INCLUDE (embedding);

CREATE INDEX idx_chunks_base_branch
  ON code_chunks(organization_id, project_id)
  WHERE is_base_branch = true;
```

### Client Cache Structure

```json
{
	"gitBranch": "feature/new-api",
	"gitCommitSha": "abc123def456",
	"deletedFiles": ["src/utils.ts", "src/oldApi.ts"],
	"files": {
		"src/app.ts": {
			"hash": "file-hash-123",
			"lastIndexed": 1234567890,
			"chunkCount": 20
		}
	}
}
```

### Implementation Flow

#### Initial Setup (Main Branch)

```typescript
// 1. Organization admin or first user indexes main
async function setupOrganizationIndex(config: Config): Promise<void> {
	// Check if main is already indexed
	const manifest = await getServerManifest(config.organizationId, config.projectId, "main")

	if (manifest.totalFiles === 0) {
		// Main not indexed yet - do full scan
		await indexMainBranch(config)
	}
}
```

#### Developer Workflow

```typescript
// 1. Developer opens workspace on feature branch
async function onWorkspaceOpen(config: Config): Promise<void> {
	const currentBranch = await getCurrentBranch(config.workspacePath)

	if (currentBranch === "main") {
		// On main - ensure it's up to date
		await syncMainBranch(config)
	} else {
		// On feature branch - index delta
		await indexFeatureBranch(config)
	}
}

// 2. Developer makes changes
async function onFileChange(filePath: string, config: Config): Promise<void> {
	const currentBranch = await getCurrentBranch(config.workspacePath)

	// Re-index the entire changed file
	const chunks = await chunkFile(filePath, config)
	chunks.forEach((c) => (c.gitBranch = currentBranch))

	// Delete old chunks for this file on this branch
	await deleteFileChunks(filePath, currentBranch, config)

	// Upsert new chunks
	await upsertChunks(chunks, config)

	// Update client cache
	await updateClientCache(filePath, fileHash, chunks.length)
}

// 3. Developer searches code
async function onSearch(query: string, config: Config): Promise<SearchResult[]> {
	const currentBranch = await getCurrentBranch(config.workspacePath)

	if (currentBranch === "main") {
		// Simple search on main
		return await searchCode({ query, gitBranch: "main", ...config })
	} else {
		// Get deleted files from git diff
		const diff = await getGitDiff(currentBranch, "main", config.workspacePath)

		// Search with preferences
		return await searchCode({
			query,
			preferBranch: currentBranch,
			fallbackBranch: "main",
			excludeFiles: diff.deleted, // Client sends this!
			...config,
		})
	}
}
```

### Benefits of This Approach

1. **Simple**: No complex delta composition on server
2. **Efficient**: Feature branches only store changed files
3. **Client-driven**: Client knows git state, sends what's needed
4. **Scalable**: Supports unlimited feature branches
5. **Fast**: Feature branch indexing in seconds
6. **Cost-effective**: Minimal storage and compute

### Storage Comparison

**Scenario**: Developer working on feature branch with 10 changed files

**Full index approach**:

- Main: 200,000 chunks
- Feature: 200,000 chunks
- Total: 400,000 chunks

**Delta approach** (this plan):

- Main: 200,000 chunks (shared)
- Feature: 200 chunks (only changed files)
- Total: 200,200 chunks
- **99.95% savings!**

---

## Line-Based Chunking Algorithm

### Simple, Fast, Language-Agnostic

```typescript
export function chunkFile(
	filePath: string,
	content: string,
	fileHash: string,
	organizationId: string,
	projectId: string,
	config: ChunkerConfig,
): ManagedCodeChunk[] {
	const lines = content.split("\n")
	const chunks: ManagedCodeChunk[] = []

	let currentChunk: string[] = []
	let currentChunkChars = 0
	let startLine = 1

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const lineLength = line.length + 1 // +1 for newline

		// Check if adding this line would exceed max
		if (currentChunkChars + lineLength > config.maxChunkChars && currentChunk.length > 0) {
			if (currentChunkChars >= config.minChunkChars) {
				// Finalize current chunk
				chunks.push(createChunk(currentChunk, startLine, i, filePath, fileHash, organizationId, projectId))

				// Start next chunk with overlap
				const overlapStart = Math.max(0, currentChunk.length - config.overlapLines)
				currentChunk = currentChunk.slice(overlapStart)
				currentChunkChars = currentChunk.join("\n").length
				startLine = i - (currentChunk.length - 1)
			}
		}

		currentChunk.push(line)
		currentChunkChars += lineLength
	}

	// Finalize last chunk
	if (currentChunk.length > 0 && currentChunkChars >= config.minChunkChars) {
		chunks.push(createChunk(currentChunk, startLine, lines.length, filePath, fileHash, organizationId, projectId))
	}

	return chunks
}
```

**Configuration**:

- Max chunk: 1000 characters
- Min chunk: 200 characters
- Overlap: 5 lines

**Performance**: 3-5x faster than tree-sitter

---

## Implementation Phases

### Phase 1: Core Types & Git Integration

**Create**: `src/services/code-index/managed/types.ts`

```typescript
export interface ManagedCodeChunk {
	id: string
	organizationId: string
	projectId: string
	filePath: string
	codeChunk: string
	startLine: number
	endLine: number
	chunkHash: string
	gitBranch: string
	gitCommitSha: string
	isBaseBranch: boolean
}

export interface ChunkerConfig {
	maxChunkChars: number
	minChunkChars: number
	overlapLines: number
}

export interface GitDiff {
	added: string[]
	modified: string[]
	deleted: string[]
}

export interface ClientCache {
	gitBranch: string
	gitCommitSha: string
	deletedFiles: string[]
	files: Record<
		string,
		{
			hash: string
			lastIndexed: number
			chunkCount: number
		}
	>
}
```

**Create**: `src/services/code-index/managed/git-utils.ts`

```typescript
import { execSync } from "child_process"

export async function getCurrentBranch(workspacePath: string): Promise<string> {
	return execSync("git rev-parse --abbrev-ref HEAD", {
		cwd: workspacePath,
		encoding: "utf8",
	}).trim()
}

export async function getCurrentCommitSha(workspacePath: string): Promise<string> {
	return execSync("git rev-parse HEAD", {
		cwd: workspacePath,
		encoding: "utf8",
	}).trim()
}

export async function getGitDiff(featureBranch: string, baseBranch: string, workspacePath: string): Promise<GitDiff> {
	// Get merge base
	const mergeBase = execSync(`git merge-base ${baseBranch} ${featureBranch}`, {
		cwd: workspacePath,
		encoding: "utf8",
	}).trim()

	// Get diff
	const diffOutput = execSync(`git diff --name-status ${mergeBase}..${featureBranch}`, {
		cwd: workspacePath,
		encoding: "utf8",
	})

	const added: string[] = []
	const modified: string[] = []
	const deleted: string[] = []

	for (const line of diffOutput.split("\n")) {
		if (!line) continue
		const [status, ...pathParts] = line.split("\t")
		const filePath = pathParts.join("\t")

		switch (status[0]) {
			case "A":
				added.push(filePath)
				break
			case "M":
				modified.push(filePath)
				break
			case "D":
				deleted.push(filePath)
				break
		}
	}

	return { added, modified, deleted }
}
```

### Phase 2: Line-Based Chunker

**Create**: `src/services/code-index/managed/chunker.ts`

(Implementation as shown in Line-Based Chunking Algorithm section above)

### Phase 3: API Client

**Create**: `src/services/code-index/managed/api-client.ts`

```typescript
import axios from "axios"
import { getKiloBaseUriFromToken } from "../../../shared/kilocode/token"
import { ManagedCodeChunk } from "./types"

export async function upsertChunks(chunks: ManagedCodeChunk[], kilocodeToken: string): Promise<void> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	await axios.put(
		`${baseUrl}/api/codebase-indexing/upsert`,
		{ chunks },
		{
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		},
	)
}

export async function searchCode(
	request: {
		query: string
		organizationId: string
		projectId: string
		preferBranch: string
		fallbackBranch: string
		excludeFiles: string[]
		path?: string
	},
	kilocodeToken: string,
): Promise<SearchResult[]> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	const response = await axios.post(`${baseUrl}/api/codebase-indexing/search`, request, {
		headers: {
			Authorization: `Bearer ${kilocodeToken}`,
			"Content-Type": "application/json",
		},
	})

	return response.data
}

export async function deleteFileChunks(
	filePath: string,
	gitBranch: string,
	organizationId: string,
	projectId: string,
	kilocodeToken: string,
): Promise<void> {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	await axios.delete(`${baseUrl}/api/codebase-indexing/files`, {
		data: {
			organizationId,
			projectId,
			gitBranch,
			filePaths: [filePath],
		},
		headers: {
			Authorization: `Bearer ${kilocodeToken}`,
		},
	})
}
```

### Phase 4: Scanner

**Create**: `src/services/code-index/managed/scanner.ts`

```typescript
import { listFiles } from "../../glob/list-files"
import { chunkFile } from "./chunker"
import { upsertChunks } from "./api-client"
import { getGitDiff, getCurrentBranch } from "./git-utils"
import pLimit from "p-limit"

export async function scanDirectory(
	config: ManagedIndexingConfig,
	clientCache: ClientCache,
	onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
	const currentBranch = await getCurrentBranch(config.workspacePath)
	const isMainBranch = currentBranch === "main"

	let filesToIndex: string[]

	if (isMainBranch) {
		// Full scan of all files
		const [allPaths] = await listFiles(config.workspacePath, true, 50000)
		filesToIndex = filterSupportedFiles(allPaths)
	} else {
		// Only scan changed files
		const diff = await getGitDiff(currentBranch, "main", config.workspacePath)
		filesToIndex = [...diff.added, ...diff.modified]

		// Store deleted files in client cache
		clientCache.deletedFiles = diff.deleted
	}

	// Process files in parallel
	const limit = pLimit(10)
	let filesProcessed = 0
	let chunksIndexed = 0

	const promises = filesToIndex.map((filePath) =>
		limit(async () => {
			// Check cache
			const fileHash = await getFileHash(filePath)
			const cached = clientCache.files[filePath]

			if (cached && cached.hash === fileHash) {
				return // Skip unchanged
			}

			// Chunk and index
			const chunks = await chunkFile(filePath, fileHash, config)
			await upsertChunks(chunks, config.kilocodeToken)

			// Update cache
			clientCache.files[filePath] = {
				hash: fileHash,
				lastIndexed: Date.now(),
				chunkCount: chunks.length,
			}

			filesProcessed++
			chunksIndexed += chunks.length

			onProgress?.({
				filesProcessed,
				filesTotal: filesToIndex.length,
				chunksIndexed,
			})
		}),
	)

	await Promise.all(promises)

	return {
		success: true,
		filesProcessed,
		chunksIndexed,
	}
}
```

### Phase 5: File Watcher

**Create**: `src/services/code-index/managed/watcher.ts`

```typescript
import * as vscode from "vscode"
import { chunkFile } from "./chunker"
import { upsertChunks, deleteFileChunks } from "./api-client"
import { getCurrentBranch } from "./git-utils"

export function createFileWatcher(config: ManagedIndexingConfig, clientCache: ClientCache): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher("**/*")
	const changeQueue: FileChange[] = []
	let debounceTimer: NodeJS.Timeout | null = null

	const handleChange = (uri: vscode.Uri, type: "created" | "changed" | "deleted") => {
		changeQueue.push({ uri, type, timestamp: Date.now() })

		if (debounceTimer) clearTimeout(debounceTimer)

		debounceTimer = setTimeout(async () => {
			await processChanges(changeQueue, config, clientCache)
			changeQueue.length = 0
		}, 500)
	}

	watcher.onDidCreate((uri) => handleChange(uri, "created"))
	watcher.onDidChange((uri) => handleChange(uri, "changed"))
	watcher.onDidDelete((uri) => handleChange(uri, "deleted"))

	return watcher
}

async function processChanges(
	changes: FileChange[],
	config: ManagedIndexingConfig,
	clientCache: ClientCache,
): Promise<void> {
	const currentBranch = await getCurrentBranch(config.workspacePath)

	for (const change of changes) {
		const filePath = change.uri.fsPath

		if (change.type === "deleted") {
			// Delete from server
			await deleteFileChunks(filePath, currentBranch, config)
			delete clientCache.files[filePath]

			// Add to deleted files if on feature branch
			if (currentBranch !== "main") {
				if (!clientCache.deletedFiles.includes(filePath)) {
					clientCache.deletedFiles.push(filePath)
				}
			}
		} else {
			// Re-index entire file
			const fileHash = await getFileHash(filePath)
			const chunks = await chunkFile(filePath, fileHash, config)

			// Delete old chunks first
			await deleteFileChunks(filePath, currentBranch, config)

			// Upsert new chunks
			await upsertChunks(chunks, config.kilocodeToken)

			// Update cache
			clientCache.files[filePath] = {
				hash: fileHash,
				lastIndexed: Date.now(),
				chunkCount: chunks.length,
			}
		}
	}

	await saveClientCache(clientCache)
}
```

---

## Summary

This simplified approach:

1. ✅ **Main branch**: Full index (shared by organization)
2. ✅ **Feature branches**: Only changed files indexed
3. ✅ **Deleted files**: Tracked in client cache, sent with search
4. ✅ **Search**: Server prefers feature branch, falls back to main
5. ✅ **Simple**: No complex server-side delta composition
6. ✅ **Efficient**: 99%+ storage savings vs full indexes
7. ✅ **Fast**: Feature branch indexing in seconds

The client drives the intelligence (knows git state), the server provides simple preference-based search.
