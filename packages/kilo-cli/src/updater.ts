import { chmod, copyFile, cp, lstat, mkdir, readlink, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { lstatSync, realpathSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { fileURLToPath, pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import { roots } from "@opencode-ai/util/global-roots"

export const DEFAULT_CHANNEL = "kilo2-internal"

export interface UpdateManifest {
  readonly channel: string
  readonly version: string
  readonly buildId: string
  readonly platform: string
  readonly sha256: string
  readonly sizeBytes: number
  readonly url: string
  readonly releaseDate?: string
  readonly format?: "directory" | "tar.gz" | "tgz"
}

export interface UpdaterConfig {
  /** Explicit manifest URL or file:// URI. If absent and KILO_UPDATE_MANIFEST_URL is unset, updater remains inert. */
  readonly manifestUrl?: string
  /** Owned preview install root. If absent, discovered from KILO_PREVIEW_INSTALL_ROOT. */
  readonly installRoot?: string
  /** Current channel override. Defaults to "kilo2-internal". */
  readonly currentChannel?: string
  /** Current platform override for testing. Defaults to `${process.platform}-${process.arch}`. */
  readonly currentPlatform?: string
  /** Optional custom fetch implementation for loopback test fixtures. */
  readonly fetch?: typeof fetch
}

export interface InstalledBuildInfo {
  readonly installRoot: string
  readonly launcherPath: string
  readonly activeBuildDir?: string
  readonly activeBuildPath?: string
  readonly buildId: string
  readonly version?: string
  readonly channel: string
  readonly platform: string
}

export interface UpdateState {
  readonly currentBuildId: string
  readonly currentBuildDir: string
  readonly currentVersion?: string
  readonly previousBuildId?: string
  readonly previousBuildDir?: string
  readonly channel: string
  readonly lastCheckedAt?: string
  readonly lastAppliedAt?: string
  readonly lastRolledBackAt?: string
}

export type CheckResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "up-to-date"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
      readonly platform: string
    }
  | {
      readonly status: "update-available"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
      readonly platform: string
      readonly update: UpdateManifest
    }

export type ApplyResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "up-to-date"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
    }
  | {
      readonly status: "applied"
      readonly previousBuildId?: string
      readonly currentBuildId: string
      readonly version: string
      readonly restartRequired: true
    }

export type RollbackResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "rolled-back"
      readonly previousBuildId: string
      readonly currentBuildId: string
      readonly restartRequired: true
    }

export type TreeTuple =
  | ["file", string, number, number, string]
  | ["symlink", string, string]
  | ["dir", string, number]

function getPlatformString(): string {
  return `${process.platform}-${process.arch}`
}

export function isValidBuildDirName(name: string | undefined): name is string {
  if (!name || typeof name !== "string") return false
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false
  return /^build-[a-zA-Z0-9_.-]+$/.test(name)
}

export function validateBuildDirName(name: string | undefined, context = "build directory"): string {
  if (!isValidBuildDirName(name)) {
    throw new Error(`Invalid ${context} name: ${String(name)}`)
  }
  return name
}

export function verifyOwnershipAndMode(targetPath: string, description: string): void {
  const stat = lstatSync(targetPath, { throwIfNoEntry: false })
  if (!stat) return

  // POSIX owner check: must be owned by the current process user
  if (typeof process.getuid === "function") {
    const currentUid = process.getuid()
    if (stat.uid !== currentUid) {
      throw new Error(
        `Refusing ${description} owned by foreign uid ${stat.uid} (current process uid is ${currentUid}): ${targetPath}`,
      )
    }
  }

  // Permission mode check: must not be group-writable or world-writable
  if ((stat.mode & 0o022) !== 0) {
    const modeOctal = (stat.mode & 0o777).toString(8).padStart(3, "0")
    throw new Error(
      `Refusing ${description} with unsafe group/world-writable permissions (mode ${modeOctal}): ${targetPath}`,
    )
  }
}

export function isProtectedPath(targetPath: string): boolean {
  const home = os.homedir()
  const resolved = path.resolve(targetPath)
  const canonicalTarget = canonicalPath(resolved)

  const systemExact = [
    home,
    "/",
    "/bin",
    "/sbin",
    "/usr",
    "/usr/bin",
    "/usr/local/bin",
    "/etc",
    "/System",
    "/var",
  ].map(canonicalPath)

  if (systemExact.some((sys) => sys === canonicalTarget)) {
    return true
  }

  const defaultBases = [
    path.join(home, ".local", "share"),
    path.join(home, ".config"),
    path.join(home, ".cache"),
    path.join(home, ".local", "state"),
  ]

  const protectedBases = [
    ...["kilo", "opencode"].flatMap((name) => [
      ...Object.values(roots(name)),
      ...defaultBases.map((base) => path.join(base, name)),
    ]),
    ...["KILO_DB", "KILO_CONFIG_DIR", "OPENCODE_DB", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG"]
      .map((key) => process.env[key])
      .filter((value): value is string => typeof value === "string" && path.isAbsolute(value)),
  ].map(canonicalPath)

  return protectedBases.some((prot) => isSameOrDescendant(canonicalTarget, prot) || isSameOrDescendant(prot, canonicalTarget))
}

export function canonicalPath(filename: string): string {
  try {
    if (lstatSync(filename, { throwIfNoEntry: false })) {
      return realpathSync(filename)
    }
  } catch {
    // continue to parent resolution
  }
  const parent = path.dirname(filename)
  if (parent === filename) return filename
  return path.join(canonicalPath(parent), path.basename(filename))
}

function isSameOrDescendant(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

export async function verifyInstallRoot(installRoot: string): Promise<string> {
  if (!path.isAbsolute(installRoot)) {
    throw new Error(`Preview install root must be an absolute path: ${installRoot}`)
  }

  const canonical = canonicalPath(installRoot)

  const stat = await lstat(canonical).catch(() => undefined)
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Preview install root does not exist or is not a directory: ${installRoot}`)
  }

  if (isProtectedPath(canonical) || isProtectedPath(installRoot)) {
    throw new Error(`Refusing protected or stable Kilo/OpenCode directory as install root: ${installRoot}`)
  }

  // Require current process owner and non-group/world-writable permissions
  verifyOwnershipAndMode(canonical, "preview install root")

  return installRoot
}

export async function detectInstallRoot(explicit?: string): Promise<string | undefined> {
  const candidate = explicit ?? process.env.KILO_PREVIEW_INSTALL_ROOT
  if (candidate) {
    return verifyInstallRoot(candidate)
  }
  return undefined
}

export async function readUpdateState(installRoot: string): Promise<UpdateState | undefined> {
  const statePath = path.join(installRoot, "update-state.json")
  const stat = await lstat(statePath).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (!stat) return undefined

  // File exists: verify ownership and mode. Never swallow unsafe state!
  verifyOwnershipAndMode(statePath, "update-state.json")

  let raw: string
  try {
    raw = await readFile(statePath, "utf8")
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Malformed update-state.json: invalid JSON syntax at ${statePath}`)
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Malformed update-state.json: expected object, got ${typeof parsed} at ${statePath}`)
  }
  const state = parsed as Record<string, unknown>
  if (typeof state.currentBuildDir !== "string" || !isValidBuildDirName(state.currentBuildDir)) {
    throw new Error(`Malformed update-state.json: invalid currentBuildDir at ${statePath}`)
  }
  if (
    state.previousBuildDir !== undefined &&
    (typeof state.previousBuildDir !== "string" || !isValidBuildDirName(state.previousBuildDir))
  ) {
    throw new Error(`Malformed update-state.json: invalid previousBuildDir at ${statePath}`)
  }
  return state as unknown as UpdateState
}

export async function writeUpdateState(installRoot: string, state: UpdateState): Promise<void> {
  const statePath = path.join(installRoot, "update-state.json")
  const tempPath = path.join(installRoot, `.update-state-${randomUUID()}.tmp`)
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", { mode: 0o644, encoding: "utf8" })
  await rename(tempPath, statePath)
}

export async function inspectInstalledBuild(installRoot: string): Promise<InstalledBuildInfo> {
  await verifyInstallRoot(installRoot)
  const launcherPath = path.join(installRoot, "kilo2")
  const launcherStat = await lstat(launcherPath).catch(() => undefined)

  let activeBuildDir: string | undefined
  if (launcherStat && launcherStat.isFile()) {
    verifyOwnershipAndMode(launcherPath, "launcher script")
    const content = await readFile(launcherPath, "utf8")
    const match = content.match(/exec\s+"\$here\/([^"\/]+)\/app\/kilo2"/)
    if (match?.[1] && isValidBuildDirName(match[1])) {
      activeBuildDir = match[1]
    }
  }

  const state = await readUpdateState(installRoot)
  const resolvedBuildDir = activeBuildDir ?? state?.currentBuildDir
  const activeBuildPath = resolvedBuildDir ? path.join(installRoot, resolvedBuildDir, "app") : undefined

  let buildMetadata: { buildId?: string; version?: string; channel?: string; platform?: string } | undefined
  if (resolvedBuildDir) {
    const metaPath = path.join(installRoot, resolvedBuildDir, "build.json")
    try {
      const raw = await readFile(metaPath, "utf8")
      buildMetadata = JSON.parse(raw)
    } catch {
      // No build.json; fallback to directory name
    }
  }

  const rawId = resolvedBuildDir
    ? resolvedBuildDir.startsWith("build-")
      ? resolvedBuildDir.slice("build-".length)
      : resolvedBuildDir
    : "initial"
  const buildId = buildMetadata?.buildId ?? state?.currentBuildId ?? rawId
  const version = buildMetadata?.version ?? state?.currentVersion ?? "0.0.0-internal"
  const channel = buildMetadata?.channel ?? state?.channel ?? DEFAULT_CHANNEL
  const platform = buildMetadata?.platform ?? getPlatformString()

  return {
    installRoot,
    launcherPath,
    activeBuildDir: resolvedBuildDir,
    activeBuildPath,
    buildId,
    version,
    channel,
    platform,
  }
}

export function validateManifest(manifest: unknown, expectedChannel: string, expectedPlatform: string): UpdateManifest {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Update manifest must be a non-null object")
  }
  const m = manifest as Record<string, unknown>

  if (typeof m.channel !== "string" || !m.channel.trim()) {
    throw new Error("Update manifest missing required string field: channel")
  }
  if (m.channel !== expectedChannel) {
    throw new Error(`Update manifest channel mismatch: expected '${expectedChannel}', got '${m.channel}'`)
  }

  if (typeof m.platform !== "string" || !m.platform.trim()) {
    throw new Error("Update manifest missing required string field: platform")
  }
  if (m.platform !== expectedPlatform) {
    throw new Error(`Update manifest platform mismatch: expected '${expectedPlatform}', got '${m.platform}'`)
  }

  if (typeof m.buildId !== "string" || !m.buildId.trim()) {
    throw new Error("Update manifest missing required string field: buildId")
  }

  if (typeof m.version !== "string" || !m.version.trim()) {
    throw new Error("Update manifest missing required string field: version")
  }

  if (typeof m.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(m.sha256)) {
    throw new Error(`Update manifest field sha256 must be a 64-character hex string, got: ${String(m.sha256)}`)
  }

  if (typeof m.sizeBytes !== "number" || !Number.isInteger(m.sizeBytes) || m.sizeBytes < 0) {
    throw new Error(`Update manifest field sizeBytes must be a non-negative integer, got: ${String(m.sizeBytes)}`)
  }

  if (typeof m.url !== "string" || !m.url.trim()) {
    throw new Error("Update manifest missing required string field: url")
  }

  return {
    channel: m.channel,
    version: m.version,
    buildId: m.buildId,
    platform: m.platform,
    sha256: m.sha256.toLowerCase(),
    sizeBytes: m.sizeBytes,
    url: m.url,
    releaseDate: typeof m.releaseDate === "string" ? m.releaseDate : undefined,
    format: m.format === "directory" || m.format === "tar.gz" || m.format === "tgz" ? m.format : "directory",
  }
}

export async function fetchManifest(
  manifestUrl: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  if (manifestUrl.startsWith("file://") || path.isAbsolute(manifestUrl)) {
    const filePath = manifestUrl.startsWith("file://") ? fileURLToPath(manifestUrl) : manifestUrl
    const content = await readFile(filePath, "utf8")
    return JSON.parse(content)
  }
  const response = await fetchFn(manifestUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch update manifest: HTTP ${response.status} from ${manifestUrl}`)
  }
  return response.json()
}

export async function checkForUpdate(options: UpdaterConfig = {}): Promise<CheckResult> {
  const manifestUrl = options.manifestUrl ?? process.env.KILO_UPDATE_MANIFEST_URL
  if (!manifestUrl) {
    return { status: "inert", reason: "Update manifest URL is not configured (KILO_UPDATE_MANIFEST_URL is unset)" }
  }

  const installRoot = await detectInstallRoot(options.installRoot)
  if (!installRoot) {
    return { status: "inert", reason: "Preview install root is not configured" }
  }

  const currentInfo = await inspectInstalledBuild(installRoot)
  const channel = options.currentChannel ?? currentInfo.channel ?? DEFAULT_CHANNEL
  const platform = options.currentPlatform ?? currentInfo.platform ?? getPlatformString()

  const rawManifest = await fetchManifest(manifestUrl, options.fetch)
  const manifest = validateManifest(rawManifest, channel, platform)

  if (manifest.buildId === currentInfo.buildId) {
    return {
      status: "up-to-date",
      currentBuildId: currentInfo.buildId,
      currentVersion: currentInfo.version,
      channel,
      platform,
    }
  }

  return {
    status: "update-available",
    currentBuildId: currentInfo.buildId,
    currentVersion: currentInfo.version,
    channel,
    platform,
    update: manifest,
  }
}

export async function scanDirectoryEntries(rootDir: string): Promise<void> {
  const canonicalRoot = await realpath(rootDir)
  const escapes: string[] = []
  const nonRegular: string[] = []

  async function scan(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(rootDir, full)
      const info = await lstat(full)

      if (info.isSymbolicLink()) {
        const target = await realpath(full).catch(() => undefined)
        if (target === undefined || (!target.startsWith(canonicalRoot + path.sep) && target !== canonicalRoot)) {
          escapes.push(rel)
        }
        continue // Never recurse through links
      }

      if (info.isDirectory()) {
        await scan(full)
        continue
      }

      if (info.isSocket() || info.isFIFO() || info.isCharacterDevice() || info.isBlockDevice()) {
        nonRegular.push(rel)
        continue
      }
    }
  }

  await scan(rootDir)

  if (escapes.length > 0) {
    throw new Error(`Artifact contains symlink escapes outside the output dir:\n${escapes.join("\n")}`)
  }
  if (nonRegular.length > 0) {
    throw new Error(`Artifact contains non-regular special files:\n${nonRegular.join("\n")}`)
  }
}

export async function digestDirectoryTree(
  rootDir: string,
): Promise<{ sha256: string; totalBytes: number; entryCount: number; tuples: TreeTuple[] }> {
  const tuples: TreeTuple[] = []
  let totalBytes = 0

  async function walk(currentDir: string): Promise<void> {
    const list = await readdir(currentDir, { withFileTypes: true })
    for (const item of list) {
      const fullPath = path.join(currentDir, item.name)
      const relPath = path.relative(rootDir, fullPath).split(path.sep).join("/")
      const stat = await lstat(fullPath)

      if (stat.isSymbolicLink()) {
        const linkTarget = await readlink(fullPath)
        tuples.push(["symlink", relPath, linkTarget])
      } else if (stat.isDirectory()) {
        tuples.push(["dir", relPath, stat.mode & 0o7777])
        await walk(fullPath)
      } else if (stat.isFile()) {
        const bytes = await readFile(fullPath)
        totalBytes += bytes.length
        const contentHash = createHash("sha256").update(bytes).digest("hex")
        tuples.push(["file", relPath, stat.mode & 0o7777, bytes.length, contentHash])
      }
    }
  }

  await walk(rootDir)

  // Deterministic codepoint sort by relative path
  tuples.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))

  const sha256 = createHash("sha256").update(JSON.stringify(tuples)).digest("hex")
  return { sha256, totalBytes, entryCount: tuples.length, tuples }
}

export async function createLauncherScript(installRoot: string, buildDirName: string): Promise<void> {
  validateBuildDirName(buildDirName, "launcher build directory")
  const targetScript = path.join(installRoot, "kilo2")
  const tempScript = path.join(installRoot, `.kilo2-${randomUUID()}.tmp`)
  const content = `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
PATH="$here:$PATH"
export PATH
KILO_ACP_ARTIFACT=\${KILO_ACP_ARTIFACT:-"$here/../acp"}
export KILO_ACP_ARTIFACT
exec "$here/${buildDirName}/app/kilo2" "$@"
`
  await writeFile(tempScript, content, { mode: 0o755 })
  await chmod(tempScript, 0o755)

  const existingStat = await lstat(targetScript).catch(() => undefined)
  if (existingStat && existingStat.isFile()) {
    verifyOwnershipAndMode(targetScript, "launcher script")
    const backupScript = path.join(installRoot, "kilo2.previous")
    await copyFile(targetScript, backupScript)
  }

  await rename(tempScript, targetScript)
}

export async function applyUpdate(options: UpdaterConfig = {}): Promise<ApplyResult> {
  const manifestUrl = options.manifestUrl ?? process.env.KILO_UPDATE_MANIFEST_URL
  if (!manifestUrl) {
    return { status: "inert", reason: "Update manifest URL is not configured (KILO_UPDATE_MANIFEST_URL is unset)" }
  }

  const installRoot = await detectInstallRoot(options.installRoot)
  if (!installRoot) {
    return { status: "inert", reason: "Preview install root is not configured" }
  }

  const currentInfo = await inspectInstalledBuild(installRoot)
  const channel = options.currentChannel ?? currentInfo.channel ?? DEFAULT_CHANNEL
  const platform = options.currentPlatform ?? currentInfo.platform ?? getPlatformString()

  const rawManifest = await fetchManifest(manifestUrl, options.fetch)
  const manifest = validateManifest(rawManifest, channel, platform)

  if (manifest.buildId === currentInfo.buildId) {
    return {
      status: "up-to-date",
      currentBuildId: currentInfo.buildId,
      currentVersion: currentInfo.version,
      channel,
    }
  }

  // Validate manifest buildId up-front before constructing any staging or destination paths
  const targetBuildDirName = validateBuildDirName(`build-${manifest.buildId}`, "manifest buildId")
  const targetBuildDir = path.join(installRoot, targetBuildDirName)

  // Staging
  const stagingDirName = `.staging-${manifest.buildId}-${randomUUID()}`
  const stagingDir = path.join(installRoot, stagingDirName)
  await mkdir(stagingDir, { recursive: true })

  try {
    const isArchive =
      manifest.format === "tar.gz" ||
      manifest.format === "tgz" ||
      manifest.url.endsWith(".tar.gz") ||
      manifest.url.endsWith(".tgz")

    if (isArchive) {
      // Per security review and steering: tar -tf entry paths do not establish safe symlink/hardlink
      // targets inside the portable tree. Archive extraction is explicitly disabled with this diagnostic
      // until trusted unpacker tooling provides a verified safe boundary. Use verified directory staging.
      throw new Error(
        "Archive extraction (.tar.gz) is currently disabled: safe portable symlink boundary verification requires trusted unpacker tooling. Gated pending packaging tooling; use verified directory staging.",
      )
    }

    const stagingApp = path.join(stagingDir, "app")

    // Stage actual local directory or fileURL artifact (pure typed path, no HTTP JSON fixture transport)
    let sourceDir: string
    if (manifest.url.startsWith("file://")) {
      sourceDir = fileURLToPath(manifest.url)
    } else if (path.isAbsolute(manifest.url)) {
      sourceDir = manifest.url
    } else {
      throw new Error(`Unsupported payload URL: must be a file:// URI or absolute path: ${manifest.url}`)
    }

    const sourceStat = await lstat(sourceDir).catch(() => undefined)
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error(`Source payload directory not found or is not a directory: ${sourceDir}`)
    }

    await cp(sourceDir, stagingApp, { recursive: true, verbatimSymlinks: true })

    // Verify staged app boundary (no symlink escapes, no special nonregular files)
    await scanDirectoryEntries(stagingApp)

    // Verify staged app has executable kilo2 launcher (refuse non-executable, do not chmod)
    const stagedKilo2 = path.join(stagingApp, "kilo2")
    const stagedStat = await lstat(stagedKilo2).catch(() => undefined)
    if (!stagedStat || !stagedStat.isFile()) {
      throw new Error(`Update payload is missing required launcher binary at app/kilo2`)
    }
    if ((stagedStat.mode & 0o111) === 0) {
      throw new Error(
        `Update payload launcher binary at app/kilo2 is not executable (mode: 0${(stagedStat.mode & 0o777).toString(8)})`,
      )
    }

    // Deterministic tree digest verification before pointer switch!
    const tree = await digestDirectoryTree(stagingApp)
    if (tree.sha256.toLowerCase() !== manifest.sha256.toLowerCase()) {
      throw new Error(
        `Update integrity failure: SHA256 mismatch (expected ${manifest.sha256}, got ${tree.sha256})`,
      )
    }
    if (tree.totalBytes !== manifest.sizeBytes) {
      throw new Error(
        `Update integrity failure: size mismatch (expected ${manifest.sizeBytes} bytes, got ${tree.totalBytes})`,
      )
    }

    // Write build.json in staging
    const buildMeta = {
      buildId: manifest.buildId,
      version: manifest.version,
      channel: manifest.channel,
      platform: manifest.platform,
      installedAt: new Date().toISOString(),
    }
    await writeFile(path.join(stagingDir, "build.json"), JSON.stringify(buildMeta, null, 2) + "\n", "utf8")

    // Refuse existing destination build directory instead of deleting it:
    // older live processes or sessions may still be running from it.
    const existingTargetStat = await lstat(targetBuildDir).catch(() => undefined)
    if (existingTargetStat) {
      throw new Error(
        `Target build directory already exists; refusing to overwrite or delete it: ${targetBuildDirName}`,
      )
    }

    await rename(stagingDir, targetBuildDir)

    // Atomic launcher pointer replacement
    await createLauncherScript(installRoot, targetBuildDirName)

    // Record update state
    const newState: UpdateState = {
      currentBuildId: manifest.buildId,
      currentBuildDir: targetBuildDirName,
      currentVersion: manifest.version,
      previousBuildId: currentInfo.buildId,
      previousBuildDir: currentInfo.activeBuildDir,
      channel: manifest.channel,
      lastAppliedAt: new Date().toISOString(),
    }
    await writeUpdateState(installRoot, newState)

    return {
      status: "applied",
      previousBuildId: currentInfo.buildId,
      currentBuildId: manifest.buildId,
      version: manifest.version,
      restartRequired: true,
    }
  } catch (error) {
    // Staging cleanup on failure; existing launcher and build directory stay completely untouched
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function rollbackUpdate(options: UpdaterConfig = {}): Promise<RollbackResult> {
  const installRoot = await detectInstallRoot(options.installRoot)
  if (!installRoot) {
    return { status: "inert", reason: "Preview install root is not configured" }
  }

  const currentInfo = await inspectInstalledBuild(installRoot)
  const state = await readUpdateState(installRoot)

  const previousBuildDir = state?.previousBuildDir
  const previousBuildId = state?.previousBuildId

  if (!previousBuildDir || !previousBuildId) {
    // Check if kilo2.previous exists
    const backupScript = path.join(installRoot, "kilo2.previous")
    const stat = await lstat(backupScript).catch(() => undefined)
    if (!stat || !stat.isFile()) {
      throw new Error("No previous build available for rollback")
    }

    verifyOwnershipAndMode(backupScript, "kilo2.previous launcher")

    // Inspect backup script to determine previous target
    const content = await readFile(backupScript, "utf8")
    const match = content.match(/exec\s+"\$here\/([^"\/]+)\/app\/kilo2"/)
    if (!match?.[1] || !isValidBuildDirName(match[1])) {
      throw new Error("Cannot determine valid target build from kilo2.previous")
    }
    const detectedBuildDir = match[1]
    const previousApp = path.join(installRoot, detectedBuildDir, "app", "kilo2")
    const appStat = await lstat(previousApp).catch(() => undefined)
    if (!appStat || !appStat.isFile()) {
      throw new Error(`Previous build executable not found at ${previousApp}`)
    }

    let restoredBuildId = detectedBuildDir.startsWith("build-")
      ? detectedBuildDir.slice("build-".length)
      : detectedBuildDir
    let restoredVersion: string | undefined
    try {
      const metaPath = path.join(installRoot, detectedBuildDir, "build.json")
      const metaRaw = await readFile(metaPath, "utf8")
      const meta = JSON.parse(metaRaw)
      if (meta.buildId) restoredBuildId = meta.buildId
      if (meta.version) restoredVersion = meta.version
    } catch {
      // fallback
    }

    await createLauncherScript(installRoot, detectedBuildDir)

    const updatedState: UpdateState = {
      currentBuildId: restoredBuildId,
      currentBuildDir: detectedBuildDir,
      currentVersion: restoredVersion,
      previousBuildId: currentInfo.buildId,
      previousBuildDir: currentInfo.activeBuildDir,
      channel: currentInfo.channel,
      lastRolledBackAt: new Date().toISOString(),
    }
    await writeUpdateState(installRoot, updatedState)

    return {
      status: "rolled-back",
      previousBuildId: restoredBuildId,
      currentBuildId: currentInfo.buildId,
      restartRequired: true,
    }
  }

  validateBuildDirName(previousBuildDir, "previous build directory")
  const previousApp = path.join(installRoot, previousBuildDir, "app", "kilo2")
  const appStat = await lstat(previousApp).catch(() => undefined)
  if (!appStat || !appStat.isFile()) {
    throw new Error(`Previous build executable not found at ${previousApp}`)
  }

  let restoredBuildId = previousBuildId
  let restoredVersion: string | undefined
  try {
    const metaPath = path.join(installRoot, previousBuildDir, "build.json")
    const metaRaw = await readFile(metaPath, "utf8")
    const meta = JSON.parse(metaRaw)
    if (meta.buildId) restoredBuildId = meta.buildId
    if (meta.version) restoredVersion = meta.version
  } catch {
    // fallback
  }

  // Atomically swap launcher back to previous build
  await createLauncherScript(installRoot, previousBuildDir)

  // Update state with restored version
  const updatedState: UpdateState = {
    currentBuildId: restoredBuildId,
    currentBuildDir: previousBuildDir,
    currentVersion: restoredVersion,
    previousBuildId: currentInfo.buildId,
    previousBuildDir: currentInfo.activeBuildDir,
    channel: currentInfo.channel,
    lastRolledBackAt: new Date().toISOString(),
  }
  await writeUpdateState(installRoot, updatedState)

  return {
    status: "rolled-back",
    previousBuildId: restoredBuildId,
    currentBuildId: currentInfo.buildId,
    restartRequired: true,
  }
}

export const Updater = {
  check: checkForUpdate,
  apply: applyUpdate,
  rollback: rollbackUpdate,
  inspect: inspectInstalledBuild,
  digest: digestDirectoryTree,
  scan: scanDirectoryEntries,
}
