// Build the portable Kilo internal preview as a DIRECTORY with a NO-INSTALL closure: bundled
// Bun runtime + bundled JS entries + a real node_modules closure COPIED from the repo's
// already-installed, already-patched, already-built dependency graph. No `bun install`, no
// registry/cache subprocess, no resolution pass — only fs reads from the repo store and writes
// into a fresh owned output dir. See kilocode/baseline/packaging-correction-plan.md.
//
// Why not single-file --compile: the routed-model plugin resolves the two native routes with
// import.meta.resolve and Core loads them via a dynamic import(fileURL); both need a real
// on-disk node_modules. Why copy-from-resolved-graph: re-resolving would drop the repo's
// patchedDependencies and trusted postinstall artifacts and could hit the network; copying the
// repo's resolved real dirs preserves the patched/built bytes and each package's identity.
//
//   <out>/kilo2                          launcher: exec "<dir>/bun" "<dir>/src/tui-preview.js"
//   <out>/bun                            bundled runtime (>=1.4, copied from process.execPath)
//   <out>/src/tui-preview.js             bundled interactive entry (@opencode-ai/tui graph
//                                        bundled + Solid-transformed; other bare imports external)
//   <out>/src/tui-plugin/tui.js          bundled kilo.preview plugin (Solid-transformed to plain JS)
//   <out>/src/tui-plugin/package.json    exports ./tui -> ./tui.js (artifact copy, not upstream)
//   <out>/script/portable-smoke-entry.js bundled loopback Auto smoke
//   <out>/node_modules/.store/<id>/      one real dir per package realpath (patched/built bytes)
//   <out>/node_modules/<name>            relative symlink -> .store/<id> (internal, relocatable)
//
// TUI handling (Luna P1): @opencode-ai/tui ships raw .tsx via package exports. Externalizing
// it would leave that .tsx under node_modules/.store, where the Solid runtime transform's
// sourceFilter (which excludes /node_modules/) never transforms it, and the launcher has no
// --preload. So instead we BUNDLE @opencode-ai/tui (and its relative .tsx graph) into
// tui-preview.js with the SUPPORTED createSolidTransformPlugin (@opentui/solid/bun-plugin) —
// the JSX is compiled to createComponent/jsx calls at build time, so no runtime preload is
// needed and no upstream package is edited. Its external deps (solid-js, @opentui/core,
// effect) stay external for single-instance identity. The kilo.preview plugin is bundled the
// same way to plain JS at src/tui-plugin/tui.js; tui.ts (frozen) resolves <out>/src/tui-plugin
// via import.meta.dir, and Host.resolve reads its exports ./tui -> ./tui.js.
//
// Layout: the AWS SDK / Smithy closure genuinely carries duplicate patch versions (e.g.
// @smithy/core 3.31.1/3.33.2/3.33.3), so a flat node_modules cannot hold the graph. Each
// realpath is copied once into .store/<id>; every dependency edge becomes a RELATIVE symlink
// at .store/<dependent>/node_modules/<dep>, and each CLI direct dep + every unambiguous name
// gets a top-level node_modules/<name> link. All links are relative and verified to resolve
// inside the artifact. The builder never installs, never spawns a subprocess, never deletes
// its output, and rejects an existing output path via exclusive mkdir.
//
// Externalize every bare package specifier (workspace + npm): anything not relative (./ ../),
// absolute (/), a file URL, or a node:/bun: builtin. Shipping the whole closure and keeping
// every package external preserves a single module instance per package (static and dynamic
// import("effect") / import("@opencode-ai/client") resolve identically — the single Effect
// identity Core's Effect.Tag service matching depends on), lets import.meta.resolve reach real
// files, and avoids per-package bundling bugs (e.g. undici inlines broken; it is a Bun builtin
// when external).
import {
  cp,
  copyFile,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { requireRuntime } from "../src/runtime"

requireRuntime()
// The portable launcher is a sh script; Windows was never supported. Reject up front instead
// of emitting a fake .cmd (build-tui.ts does the same).
if (process.platform === "win32") throw new Error("The portable build currently targets macOS/Linux")

const cliRoot = path.resolve(import.meta.dir, "..")
const repoRoot = path.resolve(cliRoot, "..", "..")

const isBareSpecifier = (specifier: string) =>
  !specifier.startsWith(".") &&
  !specifier.startsWith("/") &&
  !specifier.startsWith("#") && // package-internal "imports" subpath (e.g. @opencode-ai/tui's #string-width) — bundle, never externalize
  !specifier.startsWith("node:") &&
  !specifier.startsWith("file:") &&
  !specifier.startsWith("bun:")

// Never copy these from a package dir: nested node_modules (deps come from the traversal so
// identity stays single) and test scratch the runtime never loads via package exports.
const COPY_EXCLUDE = new Set(["node_modules", "test", "tests", "__tests__"])

// Create the output dir with exclusive ownership. An existing path fails EEXIST and is left
// untouched (never deleted); a permission or other error propagates (never read as "absent").
// The tool never deletes its output.
async function createOutputDir(): Promise<string> {
  const requested = process.argv[2]
  if (!requested) return mkdtemp(path.join(os.tmpdir(), "kilo-portable-"))
  const outdir = path.resolve(requested)
  try {
    await mkdir(outdir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Portable output path already exists; refusing to touch it: ${outdir}`)
    }
    throw error
  }
  return outdir
}

// Resolve a package's real dir by walking Node's node_modules chain from fromDir, bounded at
// the repo root for determinism. This reads the filesystem layout (symlinks + nesting), so it
// does not depend on require.resolve("<name>/package.json") — package exports may hide that
// subpath. Returns undefined when the dep is not resolvable from fromDir.
async function resolvePackageDir(name: string, fromDir: string): Promise<string | undefined> {
  let dir = fromDir
  for (;;) {
    const candidate = path.join(dir, "node_modules", name)
    const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (info) return realpath(candidate)
    if (dir === repoRoot) return undefined
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

interface Manifest {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

async function readManifest(dir: string): Promise<Manifest> {
  return JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
}

// Compute the full reachable production runtime closure by walking the repo's installed graph
// from @kilocode/cli, preserving dependency identity exactly. The AWS SDK / Smithy closure
// genuinely contains duplicate patch versions (e.g. @smithy/core 3.31.1 / 3.33.2 / 3.33.3), so
// a flat node_modules cannot hold the graph. The layout therefore mirrors the repo's store:
//   - every package realpath is copied ONCE to node_modules/.store/<id> (its .bun basename);
//   - for each dependency edge, the dependent gets an artifact-INTERNAL RELATIVE symlink at
//     <dependent>/node_modules/<dep> pointing at the resolved store entry — this reproduces the
//     repo's per-dependent version choice without inventing npm conflict-nesting (which can
//     duplicate module instances and create cycles);
//   - an unambiguous name (exactly one realpath in the closure) also gets a top-level
//     node_modules/<name> link so runtime require.resolve("<name>[/package.json]") from the
//     artifact root works.
// All links are relative and verified to resolve inside the artifact (no external escapes).
interface ClosurePlan {
  storeIdByRealpath: Map<string, string>
  links: Array<{ linkPath: string; storeId: string }>
}

async function computeClosure(): Promise<ClosurePlan> {
  const cliManifest = await readManifest(cliRoot)
  // Seed: production deps of the CLI plus runtime assets the bundled host loads directly.
  const seeds = new Set([
    ...Object.keys(cliManifest.dependencies ?? {}),
    "@opencode-ai/pty", // native PTY module loaded by file URL at runtime (build.ts pattern)
  ])
  seeds.delete("@kilocode/cli")
  const storeIdByRealpath = new Map<string, string>()
  const storeIdByName = new Map<string, Set<string>>()
  const links: Array<{ linkPath: string; storeId: string }> = []
  const queue: Array<{ name: string; fromDir: string; fromStoreId: string | undefined; required: boolean }> = [
    ...seeds,
  ].map((name) => ({ name, fromDir: cliRoot, fromStoreId: undefined, required: true }))
  const seenEdge = new Set<string>()
  while (queue.length) {
    const { name, fromDir, fromStoreId, required } = queue.pop()!
    const edgeKey = `${fromDir}	${name}`
    if (seenEdge.has(edgeKey)) continue
    seenEdge.add(edgeKey)
    const real = await resolvePackageDir(name, fromDir)
    if (!real) {
      if (required) throw new Error(`Required runtime dependency is not resolvable from ${fromDir}: ${name}`)
      continue // optional/peer dep absent from the graph: nothing to copy
    }
    let storeId = storeIdByRealpath.get(real)
    if (storeId === undefined) {
      // Extract the repo .bun store id when the realpath is a .bun store entry: the layout is
      // .bun/<storeId>/node_modules/<pkg> (or .bun/<storeId>/node_modules/@scope/<pkg>), so the
      // storeId is the segment right after ".bun". Otherwise (workspace package under
      // packages/<pkg>, or a root node_modules package) use the dependency NAME so the id is
      // unique and meaningful; add a short realpath hash only if a name collides across realpaths.
      const bunMatch = real.split(`${path.sep}.bun${path.sep}`)[1]
      const fromBunStore = bunMatch !== undefined && bunMatch.includes(`${path.sep}node_modules${path.sep}`)
      storeId = fromBunStore ? bunMatch.split(path.sep)[0]! : name
      if ([...storeIdByRealpath.values()].includes(storeId)) {
        storeId = `${storeId}@${Bun.hash(real).toString(36)}`
      }
      storeIdByRealpath.set(real, storeId)
    }
    let names = storeIdByName.get(name)
    if (!names) storeIdByName.set(name, (names = new Set()))
    names.add(storeId)
    // Dependent edges live under the dependent's OWN store entry: .store/<fromStoreId>/node_modules/<dep>
    if (fromStoreId !== undefined) links.push({ linkPath: `.store/${fromStoreId}/node_modules/${name}`, storeId })
    if (seenEdge.has(`walk	${real}`)) continue
    seenEdge.add(`walk	${real}`)
    // Traverse production + optional + present runtime peers of this package.
    const manifest = await readManifest(real)
    for (const dep of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name: dep, fromDir: real, fromStoreId: storeId, required: true })
    for (const dep of Object.keys(manifest.optionalDependencies ?? {}))
      queue.push({ name: dep, fromDir: real, fromStoreId: storeId, required: false })
    for (const dep of Object.keys(manifest.peerDependencies ?? {}))
      queue.push({ name: dep, fromDir: real, fromStoreId: storeId, required: false })
  }
  // Top-level links at the artifact root. The bundled entry resolves its own direct external
  // imports from <out>/node_modules/<name>, so every CLI direct dependency gets the top-level
  // slot (the version the CLI itself resolves to). All other names get a top-level link only
  // when unambiguous (exactly one store id), leaving ambiguous non-entry names to their
  // per-dependent links.
  const cliDeps = new Set(seeds)
  for (const name of cliDeps) {
    const real = await resolvePackageDir(name, cliRoot)
    if (real) links.push({ linkPath: name, storeId: storeIdByRealpath.get(real)! })
  }
  for (const [name, ids] of storeIdByName) {
    if (ids.size === 1 && !cliDeps.has(name)) links.push({ linkPath: name, storeId: [...ids][0]! })
  }
  return { storeIdByRealpath, links }
}

async function main() {
  const outdir = await createOutputDir()
  const plan = await computeClosure()

  // Bundle the interactive entry AND the portable smoke entrypoint. The supported
  // createSolidTransformPlugin compiles every in-graph .tsx to createComponent/jsx at build
  // time (no runtime --preload needed). The externalizer keeps every bare import resolving
  // from the shipped node_modules EXCEPT @opencode-ai/tui, which we deliberately BUNDLE (its
  // raw-.tsx exports would otherwise sit under node_modules/.store where the runtime Solid
  // transform's /node_modules/ exclusion never reaches them).
  // @opencode-ai/tui ships raw .tsx, so we bundle it AND the transitive npm helper deps it
  // reaches (they resolve to the repo's exact versions at build time). The identity-critical
  // packages tui shares with the host (effect, solid-js, @opentui/*) MUST stay external for
  // single-instance identity, so they are excluded from the bundle set even when reachable.
  // Every other bare import is externalized to the shipped node_modules.
  // Identity-critical externals for the TUI bundle. effect must stay external (host shares the
  // Effect runtime). @opentui/core stays external (native renderer module loaded from a real
  // file). solid-js is BUNDLED, NOT external: the solid transform plugin redirects solid-js's
  // node-condition dist/server.js to the client dist/solid.js at build time (its server.js
  // onLoad), which only fires for bundled solid-js. Externalizing it would resolve the
  // non-hydrating server build at runtime ("getContextId cannot be used under non-hydrating
  // context"). The host does not share a solid-js instance with the TUI, so a single bundled
  // copy preserves identity for the one renderer.
  const IDENTITY_EXTERNAL = new Set(["effect", "@opentui/core"])
  // remeda is used pervasively across the tui .tsx with many small named imports; the bundler
  // renames and drops their bindings under the solid transform (observed: isDeepEqual -> "U is
  // not defined"). Keep remeda external so its bindings resolve from the shipped node_modules
  // unchanged. It is single-instance safe (a pure util lib the host also resolves).
  const FORCE_EXTERNAL = new Set(["remeda"])
  const tuiBundlePackages = await computeTuiBundleSet()
  async function computeTuiBundleSet(): Promise<Set<string>> {
    const tuiManifest = await readManifest(path.join(repoRoot, "packages", "tui"))
    const seeds = Object.keys(tuiManifest.dependencies ?? {}).filter(
      (name) => !name.startsWith("@opencode-ai") && !name.startsWith("@kilocode") && !IDENTITY_EXTERNAL.has(name),
    )
    const tuiDir = path.join(repoRoot, "packages", "tui")
    const set = new Set<string>(["@opencode-ai/tui"])
    // Resolve each transitive dep from its PARENT package's real dir (Node semantics), not
    // from tuiDir — nested versions (e.g. strip-ansi's ansi-regex) only resolve from the parent.
    const queue: Array<{ name: string; fromDir: string }> = seeds.map((name) => ({ name, fromDir: tuiDir }))
    while (queue.length) {
      const { name, fromDir } = queue.pop()!
      if (set.has(name) || IDENTITY_EXTERNAL.has(name) || FORCE_EXTERNAL.has(name)) continue
      const real = await resolvePackageDir(name, fromDir)
      if (!real) continue
      set.add(name)
      const manifest = await readManifest(real)
      for (const dep of Object.keys(manifest.dependencies ?? {}))
        if (!IDENTITY_EXTERNAL.has(dep)) queue.push({ name: dep, fromDir: real })
    }
    return set
  }
  const bundleTui = (args: { path: string }) => {
    const root = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0]!
    // Bundle the @opencode-ai/client/solid reactive subgraph WITH the TUI so its
    // connection/store/onMount use the SAME bundled solid-js instance as the TUI render tree
    // (Luna fix A). External @opencode-ai/client/solid would import solid-js externally
    // (.store server build), a DIFFERENT instance from the bundled client solid-js, so its
    // Solid onMount never fires and the TUI connection stays "connecting". The rest of
    // @opencode-ai/client (promise, effect/service) is nonreactive and stays external so the
    // host Effect runtime and nonreactive client behavior are untouched.
    if (args.path === "@opencode-ai/client/solid" || args.path.startsWith("@opencode-ai/client/solid/"))
      return undefined
    if (FORCE_EXTERNAL.has(root)) return isBareSpecifier(args.path) ? { path: args.path, external: true } : undefined
    if (tuiBundlePackages.has(root)) return undefined
    return isBareSpecifier(args.path) ? { path: args.path, external: true } : undefined
  }
  const result = await Bun.build({
    entrypoints: [
      path.join(cliRoot, "src/tui-preview.ts"),
      path.join(cliRoot, "src/daemon-entry.ts"),
      path.join(cliRoot, "script/portable-smoke-entry.ts"),
      path.join(cliRoot, "script/portable-tui-smoke-entry.ts"),
      path.join(cliRoot, "script/portable-pty-smoke-entry.ts"),
      path.join(cliRoot, "script/portable-pty-session-smoke-entry.ts"),
      path.join(cliRoot, "script/portable-launcher-smoke-entry.ts"),
      // Temporary bounded diagnostic (not shipped): observes the mounted TUI connection state.
      ...(process.env.KILO_PORTABLE_TUI_DIAG ? [path.join(cliRoot, "script/portable-tui-diag-entry.ts")] : []),
    ],
    outdir,
    target: "bun",
    format: "esm",
    // Keep dynamic server/TUI imports lazy. Shared chunks live beside the entry so
    // import.meta.dir-based plugin and daemon paths still resolve within src/.
    splitting: true,
    naming: { chunk: "src/[name]-[hash].[ext]" },
    // minify is off: it currently breaks this module graph (undefined minified binding), and
    // correctness matters more than bundle size for the internal preview.
    plugins: [
      createSolidTransformPlugin(),
      {
        name: "kilo-portable-external",
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => bundleTui(args))
        },
      },
    ],
  })
  if (!result.success) throw new AggregateError(result.logs, "Failed to build the portable Kilo preview")

  // Bundle the kilo.preview plugin to plain JS. tui.ts (frozen, now inlined into each bundled
  // entry) resolves the plugin at import.meta.dir + "/tui-plugin". import.meta.dir differs per
  // entry output dir (src/tui-preview.js -> src/, script/*-entry.js -> script/), so the plugin
  // must be present under EVERY TUI-capable entry's directory. Its bare imports (solid-js,
  // effect, @kilocode/client, @opencode-ai/plugin) stay external and resolve from the shipped
  // node_modules at runtime.
  const pluginEntrypoints = ["src", "script"] as const
  for (const entryDir of pluginEntrypoints) {
    const pluginDir = path.join(outdir, entryDir, "tui-plugin")
    await mkdir(pluginDir, { recursive: true })
    const pluginBuild = await Bun.build({
      entrypoints: [path.join(cliRoot, "src/tui-plugin/tui.tsx")],
      outdir: pluginDir,
      target: "bun",
      format: "esm",
      naming: "tui.js",
      plugins: [
        createSolidTransformPlugin(),
        {
          name: "kilo-portable-external",
          setup(build) {
            build.onResolve({ filter: /^[^./]/ }, (args) =>
              isBareSpecifier(args.path) ? { path: args.path, external: true } : undefined,
            )
          },
        },
      ],
    })
    if (!pluginBuild.success) throw new AggregateError(pluginBuild.logs, "Failed to build the kilo.preview plugin")
    await writeFile(
      path.join(pluginDir, "package.json"),
      JSON.stringify(
        {
          name: "kilo.preview",
          version: "0.0.0-internal",
          private: true,
          type: "module",
          exports: { "./tui": "./tui.js" },
        },
        null,
        2,
      ) + "\n",
    )
  }

  // Bundled runtime. Rebuilding with the already bundled runtime must not copy onto itself.
  const runtime = path.join(outdir, "bun")
  if (process.execPath !== runtime) await copyFile(process.execPath, runtime)
  await chmod(runtime, 0o755)

  // Copy each package realpath ONCE into node_modules/.store/<id>, excluding nested
  // node_modules (the dependent links below supply every dep) and test scratch the runtime
  // never loads. Symlinks inside copied package roots would be recreated pointing at their
  // (absolute) source target; the escape check below fails the build if any such link resolves
  // outside <out>. (dereference, not verbatimSymlinks, controls inlining; neither is set, so
  // links are recreated, not inlined — the copied closure is in practice link-free.)
  const storeRoot = path.join(outdir, "node_modules", ".store")
  for (const [real, storeId] of plan.storeIdByRealpath) {
    const destination = path.join(storeRoot, storeId)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(real, destination, {
      recursive: true,
      verbatimSymlinks: false,
      filter: (src) => !COPY_EXCLUDE.has(path.basename(src)),
    })
  }

  // Create artifact-INTERNAL relative symlinks for every dependency edge and for unambiguous
  // top-level names. Relative targets keep the artifact relocatable; the escape check below
  // fails the build if any link resolves outside <out>. Links are deduped by path (multiple
  // repo fromDirs can collapse to the same dependent store entry); a path collision with a
  // DIFFERENT target is a real conflict and fails.
  const linkTargetByPath = new Map<string, string>()
  for (const { linkPath, storeId } of plan.links) {
    const prior = linkTargetByPath.get(linkPath)
    if (prior !== undefined) {
      if (prior !== storeId)
        throw new Error(`Link path collision with conflicting targets: ${linkPath} -> ${prior} vs ${storeId}`)
      continue
    }
    linkTargetByPath.set(linkPath, storeId)
    const linkFull = path.join(outdir, "node_modules", linkPath)
    const targetFull = path.join(storeRoot, storeId)
    const relative = path.relative(path.dirname(linkFull), targetFull)
    await mkdir(path.dirname(linkFull), { recursive: true })
    if (await lstat(linkFull).catch(() => undefined)) {
      const existing = await realpath(linkFull).catch(() => "<unresolvable>")
      throw new Error(`Link path already occupied: ${linkPath} (wanted ${storeId}; existing resolves to ${existing})`)
    }
    await symlink(relative, linkFull)
  }

  // Launcher: run the bundled interactive entry with the bundled runtime.
  const launcher = path.join(outdir, "kilo2")
  await writeFile(
    launcher,
    `#!/bin/sh
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec "$here/bun" --no-env-file "$here/src/tui-preview.js" "$@"
`,
    { mode: 0o755 },
  )
  await chmod(launcher, 0o755)

  // Escape check: no symlink (file OR directory) in the artifact may resolve outside it.
  // Glob's followSymlinks:false yields no directory symlinks, so use an explicit lstat+readdir
  // recursion that never follows links: lstat every entry, recurse only into real directories,
  // and validate every symlink target against the CANONICAL realpath(outdir) prefix.
  const outdirCanonical = await realpath(outdir)
  const escapes: string[] = []
  const scanLinks = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) {
        const target = await realpath(full).catch(() => undefined)
        if (target === undefined || (!target.startsWith(outdirCanonical + path.sep) && target !== outdirCanonical)) {
          escapes.push(path.relative(outdir, full))
        }
        continue // never recurse through a link
      }
      if (info.isDirectory()) await scanLinks(full)
    }
  }
  await scanLinks(outdir)
  if (escapes.length)
    throw new Error(`Artifact contains symlink escapes outside the output dir:\n${escapes.join("\n")}`)

  const entryBytes = (await Bun.file(path.join(outdir, "src", "tui-preview.js")).stat()).size
  console.log(
    `KILO_PORTABLE_BUILT ${JSON.stringify({ outdir, entryBytes, closurePackages: plan.storeIdByRealpath.size, links: plan.links.length })}`,
  )
}

await main()
