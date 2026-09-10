import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import os from "node:os"
import path from "node:path"
import {
  checkForUpdate,
  applyUpdate,
  rollbackUpdate,
  inspectInstalledBuild,
  isProtectedPath,
  isValidBuildDirName,
  validateBuildDirName,
  canonicalPath,
  verifyInstallRoot,
  createLauncherScript,
  readUpdateState,
  validateManifest,
  digestDirectoryTree,
  scanDirectoryEntries,
  verifyOwnershipAndMode,
  type UpdateManifest,
} from "../src/updater"

async function createMockInstall(baseDir: string, buildId = "initial", version = `0.1.0-internal+${buildId}`): Promise<{ installRoot: string; buildDir: string }> {
  const installRoot = path.join(baseDir, "preview-install")
  await mkdir(installRoot, { recursive: true, mode: 0o755 })
  await chmod(installRoot, 0o755)

  const buildDirName = `build-${buildId}`
  const appDir = path.join(installRoot, buildDirName, "app")
  await mkdir(appDir, { recursive: true, mode: 0o755 })

  // Mock app/kilo2 script
  const appKilo2 = path.join(appDir, "kilo2")
  await writeFile(appKilo2, `#!/bin/sh\necho "kilo2-${buildId}"\n`, { mode: 0o755 })
  await chmod(appKilo2, 0o755)

  // Write build.json metadata
  await writeFile(
    path.join(installRoot, buildDirName, "build.json"),
    JSON.stringify({ buildId, version, channel: "kilo2-internal" }, null, 2) + "\n",
  )

  // Sentinel to prove build directory preservation
  await writeFile(path.join(appDir, "sentinel.txt"), `sentinel-${buildId}`)

  // Top-level launcher pointing to build-*/app/kilo2
  const launcher = path.join(installRoot, "kilo2")
  await writeFile(
    launcher,
    `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
PATH="$here:$PATH"
export PATH
KILO_ACP_ARTIFACT=\${KILO_ACP_ARTIFACT:-"$here/../acp"}
export KILO_ACP_ARTIFACT
exec "$here/${buildDirName}/app/kilo2" "$@"
`,
    { mode: 0o755 },
  )
  await chmod(launcher, 0o755)

  return { installRoot, buildDir: path.join(installRoot, buildDirName) }
}

test("updater is inert by default without manifest URL or install root", async () => {
  const oldEnv = process.env.KILO_UPDATE_MANIFEST_URL
  delete process.env.KILO_UPDATE_MANIFEST_URL
  try {
    const checkRes = await checkForUpdate()
    expect(checkRes.status).toBe("inert")
    if (checkRes.status === "inert") {
      expect(checkRes.reason).toMatch(/not configured/i)
    }

    const applyRes = await applyUpdate()
    expect(applyRes.status).toBe("inert")
  } finally {
    if (oldEnv) process.env.KILO_UPDATE_MANIFEST_URL = oldEnv
  }
})

test("updater refuses protected system and stable Kilo paths", () => {
  const home = os.homedir()
  expect(isProtectedPath("/")).toBe(true)
  expect(isProtectedPath("/usr")).toBe(true)
  expect(isProtectedPath("/usr/local/bin")).toBe(true)
  expect(isProtectedPath(home)).toBe(true)
  expect(isProtectedPath(path.join(home, ".local", "share", "kilo"))).toBe(true)
  expect(isProtectedPath(path.join(home, ".config", "kilo"))).toBe(true)
  expect(isProtectedPath(path.join(home, ".local", "share", "opencode"))).toBe(true)
})

test("verifyInstallRoot resolves parent symlinks via canonicalPath without touching live config", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-symlink-test-"))
  const savedKiloConfig = process.env.KILO_CONFIG_DIR
  try {
    const scopedProtectedDir = path.join(tmpDir, "scoped-protected-config")
    await mkdir(scopedProtectedDir, { recursive: true, mode: 0o755 })
    process.env.KILO_CONFIG_DIR = scopedProtectedDir

    const symlinkPath = path.join(tmpDir, "kilo-config-symlink")
    await symlink(scopedProtectedDir, symlinkPath)

    expect(canonicalPath(symlinkPath)).toBe(canonicalPath(scopedProtectedDir))
    await expect(verifyInstallRoot(symlinkPath)).rejects.toThrow(/refusing protected/i)
  } finally {
    if (savedKiloConfig !== undefined) {
      process.env.KILO_CONFIG_DIR = savedKiloConfig
    } else {
      delete process.env.KILO_CONFIG_DIR
    }
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("verifyOwnershipAndMode enforces current owner and rejects group/world-writable permissions", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-mode-test-"))
  try {
    const testDir = path.join(tmpDir, "owned-dir")
    await mkdir(testDir, { mode: 0o755 })
    await chmod(testDir, 0o755)

    // Standard 0o755 passes
    expect(() => verifyOwnershipAndMode(testDir, "test directory")).not.toThrow()

    // 0o777 (world writable) fails
    await chmod(testDir, 0o777)
    expect(() => verifyOwnershipAndMode(testDir, "test directory")).toThrow(
      /unsafe group\/world-writable permissions/i,
    )

    // 0o775 (group writable) fails
    await chmod(testDir, 0o775)
    expect(() => verifyOwnershipAndMode(testDir, "test directory")).toThrow(
      /unsafe group\/world-writable permissions/i,
    )

    // Reset to 0o755 passes
    await chmod(testDir, 0o755)
    expect(() => verifyOwnershipAndMode(testDir, "test directory")).not.toThrow()
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("readUpdateState refuses unsafe permissions and malformed json while allowing absent state", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-state-refusal-"))
  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")
    const stateFile = path.join(installRoot, "update-state.json")

    // 1. Absent state returns undefined cleanly (ENOENT)
    const absent = await readUpdateState(installRoot)
    expect(absent).toBeUndefined()

    // 2. Unsafe permissions (world writable 0o777) must throw and NOT be swallowed
    await writeFile(stateFile, JSON.stringify({ currentBuildDir: "build-v1", currentBuildId: "v1" }), { mode: 0o777 })
    await chmod(stateFile, 0o777)
    await expect(readUpdateState(installRoot)).rejects.toThrow(/unsafe group\/world-writable permissions/i)

    // 3. Malformed JSON syntax must throw and NOT be swallowed
    await chmod(stateFile, 0o644)
    await writeFile(stateFile, "not-valid-json", { mode: 0o644 })
    await expect(readUpdateState(installRoot)).rejects.toThrow(/Malformed update-state\.json.*syntax/i)

    // 4. Malformed currentBuildDir traversal must throw and NOT be swallowed
    await writeFile(stateFile, JSON.stringify({ currentBuildDir: "../escape", currentBuildId: "v1" }), { mode: 0o644 })
    await expect(readUpdateState(installRoot)).rejects.toThrow(/invalid currentBuildDir/i)

    // 5. Valid state file parses cleanly
    await writeFile(stateFile, JSON.stringify({ currentBuildDir: "build-v1", currentBuildId: "v1" }), { mode: 0o644 })
    const valid = await readUpdateState(installRoot)
    expect(valid).toBeDefined()
    expect(valid?.currentBuildId).toBe("v1")
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("build directory name validation rejects path traversal and invalid characters", async () => {
  expect(isValidBuildDirName("build-0.1.0-abc")).toBe(true)
  expect(isValidBuildDirName("build-1788799680554-61a8707c03")).toBe(true)

  // Rejections
  expect(isValidBuildDirName("../outside")).toBe(false)
  expect(isValidBuildDirName("build-foo/bar")).toBe(false)
  expect(isValidBuildDirName("build-foo\\bar")).toBe(false)
  expect(isValidBuildDirName("not-a-build")).toBe(false)
  expect(isValidBuildDirName("build-")).toBe(false)
  expect(isValidBuildDirName("")).toBe(false)
  expect(isValidBuildDirName(undefined)).toBe(false)

  expect(() => validateBuildDirName("../outside")).toThrow(/Invalid build directory name/i)

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-launcher-validate-"))
  try {
    await expect(createLauncherScript(tmpDir, "../escape")).rejects.toThrow(/Invalid launcher build directory name/i)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("digestDirectoryTree encodes structured tuples with exact permission modes and deterministic sort", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-digest-test-"))
  try {
    const root = path.join(tmpDir, "root")
    await mkdir(path.join(root, "sub"), { recursive: true, mode: 0o755 })
    await writeFile(path.join(root, "hello.txt"), "hello world\n")
    await chmod(path.join(root, "hello.txt"), 0o644)
    await writeFile(path.join(root, "exec.sh"), "#!/bin/sh\n", { mode: 0o755 })
    await chmod(path.join(root, "exec.sh"), 0o755)
    await symlink("hello.txt", path.join(root, "sub/link.txt"))

    const digest1 = await digestDirectoryTree(root)
    const digest2 = await digestDirectoryTree(root)

    expect(digest1.sha256).toBe(digest2.sha256)
    expect(digest1.totalBytes).toBe(digest2.totalBytes)
    expect(digest1.entryCount).toBe(4)

    // Check tuple structure
    const fileTuple = digest1.tuples.find((t) => t[1] === "exec.sh")
    expect(fileTuple).toBeDefined()
    if (fileTuple && fileTuple[0] === "file") {
      expect(fileTuple[2]).toBe(0o755) // exact mode
    }

    const symlinkTuple = digest1.tuples.find((t) => t[1] === "sub/link.txt")
    expect(symlinkTuple).toBeDefined()
    if (symlinkTuple && symlinkTuple[0] === "symlink") {
      expect(symlinkTuple[2]).toBe("hello.txt") // exact target
    }

    // Tampering with mode alters the digest hash
    await chmod(path.join(root, "exec.sh"), 0o700)
    const digest3 = await digestDirectoryTree(root)
    expect(digest3.sha256).not.toBe(digest1.sha256)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("scanDirectoryEntries detects symlink escapes outside the artifact root", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-escape-test-"))
  try {
    const root = path.join(tmpDir, "artifact")
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, "safe.txt"), "safe")

    // Link pointing outside root
    await symlink("/tmp", path.join(root, "bad-link"))

    await expect(scanDirectoryEntries(root)).rejects.toThrow(/symlink escapes outside/i)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("manifest validation enforces channel, platform, and hash integrity", () => {
  const currentPlatform = `${process.platform}-${process.arch}`
  const validManifest = {
    channel: "kilo2-internal",
    version: "0.1.0-internal+12345",
    buildId: "build-12345",
    platform: currentPlatform,
    sha256: "a".repeat(64),
    sizeBytes: 1024,
    url: "file:///tmp/payload",
  }

  const parsed = validateManifest(validManifest, "kilo2-internal", currentPlatform)
  expect(parsed.buildId).toBe("build-12345")
  expect(parsed.channel).toBe("kilo2-internal")

  // Channel mismatch
  expect(() => validateManifest(validManifest, "stable", currentPlatform)).toThrow(/channel mismatch/i)

  // Platform mismatch
  expect(() => validateManifest(validManifest, "kilo2-internal", "linux-mips")).toThrow(/platform mismatch/i)

  // Invalid SHA256
  expect(() => validateManifest({ ...validManifest, sha256: "not-a-hash" }, "kilo2-internal", currentPlatform)).toThrow(/64-character/i)

  // Invalid sizeBytes
  expect(() => validateManifest({ ...validManifest, sizeBytes: -5 }, "kilo2-internal", currentPlatform)).toThrow(/non-negative integer/i)
})

test("check identifies up-to-date vs update-available against local manifest", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))
  try {
    const { installRoot } = await createMockInstall(tmpDir, "current-build")

    const manifestPath = path.join(tmpDir, "manifest.json")
    const manifestData: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.1.0-internal+current",
      buildId: "current-build",
      platform: `${process.platform}-${process.arch}`,
      sha256: "b".repeat(64),
      sizeBytes: 500,
      url: pathToFileURL(path.join(tmpDir, "payload")).href,
      format: "directory",
    }
    await writeFile(manifestPath, JSON.stringify(manifestData, null, 2) + "\n")

    // 1) Same build ID -> up-to-date
    const check1 = await checkForUpdate({
      manifestUrl: pathToFileURL(manifestPath).href,
      installRoot,
    })
    expect(check1.status).toBe("up-to-date")
    if (check1.status === "up-to-date") {
      expect(check1.currentBuildId).toBe("current-build")
    }

    // 2) Newer build ID -> update-available
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          ...manifestData,
          buildId: "newer-build-2",
          version: "0.1.0-internal+newer",
        },
        null,
        2,
      ) + "\n",
    )

    const check2 = await checkForUpdate({
      manifestUrl: pathToFileURL(manifestPath).href,
      installRoot,
    })
    expect(check2.status).toBe("update-available")
    if (check2.status === "update-available") {
      expect(check2.update.buildId).toBe("newer-build-2")
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("real local directory payload stages binaries, relative symlinks, and handles file URLs with spaces", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo update test-"))

  try {
    const { installRoot, buildDir: oldBuildDir } = await createMockInstall(tmpDir, "v1")

    // Construct a real local directory artifact with executables and relative symlinks in a path with spaces
    const sourceApp = path.join(tmpDir, "source artifact", "app")
    await mkdir(path.join(sourceApp, "lib"), { recursive: true, mode: 0o755 })

    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "kilo2-real-binary-v2"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)

    await writeFile(path.join(sourceApp, "sentinel.txt"), "sentinel-real-v2\n")
    await writeFile(path.join(sourceApp, "lib/core.js"), 'console.log("core-v2")\n')
    await chmod(path.join(sourceApp, "lib/core.js"), 0o644)
    // Relative symlink inside the artifact
    await symlink("core.js", path.join(sourceApp, "lib/link-to-core.js"))

    // Compute deterministic tree digest
    const tree = await digestDirectoryTree(sourceApp)

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+real",
      buildId: "real-v2",
      platform: `${process.platform}-${process.arch}`,
      sha256: tree.sha256,
      sizeBytes: tree.totalBytes,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "update-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    const result = await applyUpdate({
      manifestUrl: pathToFileURL(manifestFile).href,
      installRoot,
    })

    expect(result.status).toBe("applied")
    if (result.status === "applied") {
      expect(result.currentBuildId).toBe("real-v2")
      expect(result.previousBuildId).toBe("v1")
      expect(result.restartRequired).toBe(true)
    }

    // Check launcher kilo2 points to new build
    const launcherContent = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherContent).toContain("build-real-v2/app/kilo2")

    // Check kilo2.previous points to old build
    const previousContent = await readFile(path.join(installRoot, "kilo2.previous"), "utf8")
    expect(previousContent).toContain("build-v1/app/kilo2")

    // PRESERVATION CHECK: The old running build directory MUST NOT BE DELETED!
    const oldSentinel = await readFile(path.join(oldBuildDir, "app", "sentinel.txt"), "utf8")
    expect(oldSentinel).toBe("sentinel-v1")

    // New build exists and has intact relative symlink
    const stagedLink = path.join(installRoot, "build-real-v2", "app", "lib", "link-to-core.js")
    const target = await readlink(stagedLink)
    expect(target).toBe("core.js")

    // Execute real launcher binary to prove it runs
    const child = Bun.spawn([path.join(installRoot, "kilo2")], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(0)
    expect(out.trim()).toBe("kilo2-real-binary-v2")

    // Staging directory must be cleaned up
    const entries = await readdir(installRoot)
    expect(entries.some((e) => e.startsWith(".staging-"))).toBe(false)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("refuses non-executable launcher in source payload without altering mode", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-nonexec-test-"))
  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")

    const sourceApp = path.join(tmpDir, "nonexec-artifact", "app")
    await mkdir(sourceApp, { recursive: true, mode: 0o755 })

    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "non-exec"\n`, { mode: 0o644 })
    await chmod(kilo2Bin, 0o644) // Explicitly non-executable

    const tree = await digestDirectoryTree(sourceApp)

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+nonexec",
      buildId: "nonexec-v2",
      platform: `${process.platform}-${process.arch}`,
      sha256: tree.sha256,
      sizeBytes: tree.totalBytes,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(/launcher binary at app\/kilo2 is not executable/i)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("manifest buildId is validated before creating any staging path", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-buildid-validate-"))
  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+traversal",
      buildId: "../escape", // Invalid traversal buildId
      platform: `${process.platform}-${process.arch}`,
      sha256: "a".repeat(64),
      sizeBytes: 10,
      url: pathToFileURL(tmpDir).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(/Invalid manifest buildId name/i)

    // Verify no staging directory was ever created
    const entries = await readdir(installRoot)
    expect(entries.some((e) => e.startsWith(".staging-"))).toBe(false)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("symlink escape inside directory payload is refused before promotion", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")
    const launcherBefore = await readFile(path.join(installRoot, "kilo2"), "utf8")

    const sourceApp = path.join(tmpDir, "escaping-artifact", "app")
    await mkdir(sourceApp, { recursive: true })

    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "kilo2"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)

    // Symlink escaping the artifact
    await symlink("/usr/bin", path.join(sourceApp, "escape-link"))

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+escape",
      buildId: "escape-v2",
      platform: `${process.platform}-${process.arch}`,
      sha256: "c".repeat(64),
      sizeBytes: 100,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "escape-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(/symlink escapes outside/i)

    // Launcher intact
    const launcherAfter = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherAfter).toBe(launcherBefore)

    // Staging directory cleaned up
    const entries = await readdir(installRoot)
    expect(entries.some((e) => e.startsWith(".staging-"))).toBe(false)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("applyUpdate refuses existing destination build directory without deleting anything", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")

    // Pre-create the target build directory with a sentinel
    const existingTargetDir = path.join(installRoot, "build-conflict")
    await mkdir(path.join(existingTargetDir, "app"), { recursive: true })
    const sentinelFile = path.join(existingTargetDir, "app", "keep-me.txt")
    await writeFile(sentinelFile, "precious-running-data")

    const sourceApp = path.join(tmpDir, "source-conflict", "app")
    await mkdir(sourceApp, { recursive: true })
    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "conflict"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)

    const tree = await digestDirectoryTree(sourceApp)

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+conflict",
      buildId: "conflict",
      platform: `${process.platform}-${process.arch}`,
      sha256: tree.sha256,
      sizeBytes: tree.totalBytes,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "conflict-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(
      /Target build directory already exists; refusing to overwrite or delete it: build-conflict/,
    )

    // Assert the existing directory and its file were NOT deleted!
    expect(await readFile(sentinelFile, "utf8")).toBe("precious-running-data")
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("applyUpdate returns explicit unsupported diagnostic for archive extraction", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+archive",
      buildId: "archive-build",
      platform: `${process.platform}-${process.arch}`,
      sha256: "d".repeat(64),
      sizeBytes: 100,
      url: pathToFileURL(path.join(tmpDir, "artifact.tar.gz")).href,
      format: "tar.gz",
    }

    const manifestFile = path.join(tmpDir, "archive-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(
      /Archive extraction \(\.tar\.gz\) is currently disabled: safe portable symlink boundary verification requires trusted unpacker tooling/i,
    )

    // Launcher intact
    const launcherContent = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherContent).toContain("build-v1/app/kilo2")
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("tree digest integrity mismatch refuses update, cleans staging, and preserves launcher intact", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "v1")
    const launcherBefore = await readFile(path.join(installRoot, "kilo2"), "utf8")

    const sourceApp = path.join(tmpDir, "corrupt-artifact", "app")
    await mkdir(sourceApp, { recursive: true })
    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "corrupt"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)

    // Manifest provides a mismatching SHA256
    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+bad",
      buildId: "bad-sha",
      platform: `${process.platform}-${process.arch}`,
      sha256: "f".repeat(64), // Deliberately wrong SHA256
      sizeBytes: 10,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "corrupt-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await expect(
      applyUpdate({
        manifestUrl: pathToFileURL(manifestFile).href,
        installRoot,
      }),
    ).rejects.toThrow(/Update integrity failure: SHA256 mismatch/i)

    // LAUNCHER PRESERVATION: launcher must be 100% untouched
    const launcherAfter = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherAfter).toBe(launcherBefore)

    // Staging directory must be cleaned up
    const entries = await readdir(installRoot)
    expect(entries.some((e) => e.startsWith(".staging-"))).toBe(false)
    expect(entries.includes("build-bad-sha")).toBe(false)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("rollback restores previous launcher pointer, records restored version, and keeps all build directories", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "initial", "0.1.0-internal+initial")

    const sourceApp = path.join(tmpDir, "second-artifact", "app")
    await mkdir(sourceApp, { recursive: true })
    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "kilo2-second"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)
    await writeFile(path.join(sourceApp, "sentinel.txt"), "sentinel-second\n")

    const tree = await digestDirectoryTree(sourceApp)

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+second",
      buildId: "second",
      platform: `${process.platform}-${process.arch}`,
      sha256: tree.sha256,
      sizeBytes: tree.totalBytes,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "second-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    // 1) Apply update to 'second'
    const applyRes = await applyUpdate({ manifestUrl: pathToFileURL(manifestFile).href, installRoot })
    expect(applyRes.status).toBe("applied")

    let info = await inspectInstalledBuild(installRoot)
    expect(info.activeBuildDir).toBe("build-second")
    expect(info.version).toBe("0.2.0-internal+second")

    // 2) Rollback to 'initial'
    const rollbackRes = await rollbackUpdate({ installRoot })
    expect(rollbackRes.status).toBe("rolled-back")
    if (rollbackRes.status === "rolled-back") {
      expect(rollbackRes.previousBuildId).toBe("initial")
      expect(rollbackRes.currentBuildId).toBe("second")
    }

    // Launcher now points back to build-initial
    info = await inspectInstalledBuild(installRoot)
    expect(info.activeBuildDir).toBe("build-initial")

    // Check restored version semantics: must record 0.1.0-internal+initial, not 0.2.0!
    const state = await readUpdateState(installRoot)
    expect(state?.currentVersion).toBe("0.1.0-internal+initial")
    expect(state?.currentBuildId).toBe("initial")

    const launcherContent = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherContent).toContain("build-initial/app/kilo2")

    // BOTH build directories still exist on disk!
    const entries = await readdir(installRoot)
    expect(entries.includes("build-initial")).toBe(true)
    expect(entries.includes("build-second")).toBe(true)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("rollback fallback path via kilo2.previous restores build and writes state when update-state.json is missing", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))

  try {
    const { installRoot } = await createMockInstall(tmpDir, "initial", "0.1.0-internal+initial")

    const sourceApp = path.join(tmpDir, "second-artifact", "app")
    await mkdir(sourceApp, { recursive: true })
    const kilo2Bin = path.join(sourceApp, "kilo2")
    await writeFile(kilo2Bin, `#!/bin/sh\necho "kilo2-second"\n`, { mode: 0o755 })
    await chmod(kilo2Bin, 0o755)

    const tree = await digestDirectoryTree(sourceApp)

    const manifest: UpdateManifest = {
      channel: "kilo2-internal",
      version: "0.2.0-internal+second",
      buildId: "second",
      platform: `${process.platform}-${process.arch}`,
      sha256: tree.sha256,
      sizeBytes: tree.totalBytes,
      url: pathToFileURL(sourceApp).href,
      format: "directory",
    }

    const manifestFile = path.join(tmpDir, "second-manifest.json")
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")

    await applyUpdate({ manifestUrl: pathToFileURL(manifestFile).href, installRoot })

    // Delete update-state.json to force the fallback kilo2.previous path!
    await rm(path.join(installRoot, "update-state.json"), { force: true })

    const rollbackRes = await rollbackUpdate({ installRoot })
    expect(rollbackRes.status).toBe("rolled-back")
    if (rollbackRes.status === "rolled-back") {
      expect(rollbackRes.previousBuildId).toBe("initial")
      expect(rollbackRes.currentBuildId).toBe("second")
    }

    // State file must be rewritten so subsequent operations do not see missing or stale state!
    const rewrittenState = await readUpdateState(installRoot)
    expect(rewrittenState).toBeDefined()
    expect(rewrittenState?.currentBuildId).toBe("initial")
    expect(rewrittenState?.currentVersion).toBe("0.1.0-internal+initial")

    const launcherContent = await readFile(path.join(installRoot, "kilo2"), "utf8")
    expect(launcherContent).toContain("build-initial/app/kilo2")
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})

test("rollback with no previous build available throws descriptive error", async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "kilo-updater-test-"))
  try {
    const { installRoot } = await createMockInstall(tmpDir, "initial")

    await expect(rollbackUpdate({ installRoot })).rejects.toThrow(/No previous build available for rollback/i)
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
})
