#!/usr/bin/env bun

/**
 * Feature placement finder for the v2 line (`.kilo/skills/v2-feature-placement/SKILL.md`, steps 2 to 6).
 *
 * For one module it answers, with no model and no network: is there a plugin hook (rung 1), a
 * service node that the Kilo host can replace (rung 2), or an existing seam or patch. An agent then
 * starts on the lowest rung that has something.
 *
 * `--imports` checks the import rule (`.kilo/skills/v2-feature-placement/SKILL.md`, step 6):
 * logic packages (`packages/kilo-*-core`) import no `@opencode/*`, and each adapter lists the
 * core-internal modules it imports. It fails only on a logic package violation.
 *
 * Usage:
 *   bun script/upstream/placement.ts packages/core/src/session/compaction.ts
 *   bun script/upstream/placement.ts @opencode/core/session/compaction
 *   bun script/upstream/placement.ts <path-or-module> --json   # the same data, machine readable
 *   bun script/upstream/placement.ts --imports [--json]        # import rule check
 *   bun script/upstream/placement.ts ... --pin <ref>           # another upstream commit for the Kilo-owned check
 */

import { $ } from "bun"
import path from "node:path"
import { parseArgs } from "node:util"
import { readBaseline, repoRoot, type Baseline } from "./utils/baseline"
import { match } from "./utils/match"
import { isKiloOwned } from "./utils/owned"
import { pinned } from "./utils/upstream"

const DOMAINS = "packages/plugin/src/effect/"
const NOT_DOMAINS = new Set(["index.ts", "plugin.ts", "registration.ts"])
const SOURCE = /\.tsx?$/
const TEST = /\.(test|spec)\.tsx?$|(^|\/)test\//
/** Static, export-from, side-effect and dynamic import specifiers */
const IMPORTS = [
  /^[ \t]*(?:import|export)\b[^"'`;()=]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
]
/** A plugin: an object that starts with a dotted `id`, as in `define({ id: "opencode.config.compaction", ... })` */
const PLUGIN =
  /^(?:[ \t]*return (?:\w+\.)?define\b|(?:export )?(?:default\b|const \w+))[^\n]*[{(]\s*id:\s*"([\w-]+\.[\w.-]+)"/gm

if (import.meta.main) {
  const args = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
      imports: { type: "boolean", default: false },
      pin: { type: "string" },
    },
  })
  const root = await repoRoot()
  const files = await listFiles(root)
  const upstream = await upstreamFiles(root, args.values.pin)

  if (args.values.imports) {
    const report = await checkImports(root, files, upstream.files)
    console.log(args.values.json ? JSON.stringify(report, null, 2) : renderImports(report).join("\n"))
    process.exit(report.ok ? 0 : 1)
  }

  const input = args.positionals[0]
  if (!input) fail("Usage: bun script/upstream/placement.ts <path-or-module> [--json] [--pin <ref>], or --imports")
  const report = await place(root, resolveTarget(root, input, files), files, upstream)
  console.log(args.values.json ? JSON.stringify(report, null, 2) : renderPlacement(report).join("\n"))
}

async function place(root: string, target: string, files: Set<string>, upstream: Upstream) {
  const text = await read(root, target)
  const namespace = (text.match(/^export \* as (\w+) from/m) ?? text.match(/^export namespace (\w+)/m))?.[1]
  const words = tokens(target, namespace)
  const tool = target.includes("/tool/plugin/") ? text.match(/^export const name = "([^"]+)"/m)?.[1] : undefined
  const report = {
    path: target,
    namespace: namespace ?? null,
    pin: upstream.pin ?? null,
    kiloOwned: isKiloOwned(target, upstream.files),
    tokens: [...words],
    domains: (await readDomains(root, files))
      .map((domain) => ({ ...domain, matches: domainMatches(domain, words) }))
      .filter((domain) => domain.matches.length > 0),
    plugins: await readPlugins(root, files, target, namespace),
    tool: tool
      ? {
          name: tool,
          wrap: `ToolEditor.update("${tool}", (tool) => ...)`,
          replace: `ToolEditor.remove("${tool}") + ToolEditor.add({ name: "${tool}", ... })`,
        }
      : null,
    nodes: readNodes(text, namespace ?? path.basename(target).replace(SOURCE, "")),
    env: [...text.matchAll(/\bprocess\.env\.(OPENCODE_\w+)/g)].map((item) => ({
      name: item[1],
      line: lineOf(text, item.index),
    })),
    // The Kilo host (U-E0-01): service replacements in `KiloHost.overrides`, `KILO_*` translation in env.ts.
    host: "packages/kilo-cli/src/host.ts",
    hostEnv: "packages/kilo-cli/src/env.ts",
    seams: readSeams(await readBaseline(root), target, text),
  }
  return { ...report, suggestion: suggest(report) }
}

export type Placement = Awaited<ReturnType<typeof place>>

async function checkImports(root: string, files: Set<string>, upstream?: Set<string>) {
  const sources = [...files].filter((file) => SOURCE.test(file)).sort()
  const logicFiles = sources.filter((file) => match(file, "packages/kilo-*-core/src/**"))
  const adapterFiles = sources.filter(
    (file) =>
      !TEST.test(file) &&
      !match(file, "packages/kilo-*-core/**") &&
      (match(file, "packages/kilo-*/src/**") || match(file, "packages/**/src/kilocode/**")),
  )
  const scanned = await Promise.all(
    [...logicFiles, ...adapterFiles].map(async (file) => ({ file, imports: specifiers(await read(root, file)) })),
  )
  const imported = new Map(scanned.map((item) => [item.file, item.imports]))

  const logic = groups(logicFiles, (file) => file.split("/").slice(0, 2).join("/")).map(([name, members]) => ({
    package: name,
    files: members.length,
    violations: members.flatMap((file) =>
      (imported.get(file) ?? [])
        .filter((item) => item.specifier.startsWith("@opencode/"))
        .map((item) => ({ file, line: item.line, specifier: item.specifier })),
    ),
  }))
  const adapters = groups(adapterFiles, adapterGroup).map(([name, members]) => ({
    adapter: name,
    files: members.length,
    modules: unique(
      members.flatMap((file) =>
        (imported.get(file) ?? []).flatMap((item) => {
          const resolved = resolve(item.specifier, file, files)
          if (!resolved?.startsWith("packages/core/src/") || isKiloOwned(resolved, upstream)) return []
          return [
            resolved
              .slice("packages/core/src/".length)
              .replace(SOURCE, "")
              .replace(/\/index$/, ""),
          ]
        }),
      ),
    ).sort(),
  }))
  return {
    ok: logic.every((item) => item.violations.length === 0),
    logic,
    adapters,
    total: unique(adapters.flatMap((item) => item.modules)).sort(),
  }
}

export type ImportReport = Awaited<ReturnType<typeof checkImports>>

function renderPlacement(report: Placement) {
  const extenders = report.plugins.filter((item) => item.use !== "import")
  const importers = report.plugins.filter((item) => item.use === "import")
  return [
    `# Placement: ${report.path}`,
    "",
    "## Path",
    "",
    ...table(
      ["Field", "Value"],
      [
        ["Path", report.path],
        ["Namespace", report.namespace ?? "none"],
        [
          "Kilo-owned",
          report.kiloOwned
            ? "yes: no marker needed; not a shared patch"
            : "no: shared upstream file, an edit here is a seam (rung 3) or a patch (rung 4)",
        ],
        ["Upstream pin", report.pin ? report.pin.slice(0, 11) : "none found, path patterns only"],
      ],
    ),
    "",
    "## Plugin hooks (rung 1)",
    "",
    `Tokens: ${report.tokens.join(", ")}`,
    "",
    ...(report.domains.length === 0
      ? ["No plugin domain matches these tokens."]
      : [
          ...table(
            ["Domain", "Matches", "Hooks", "Editor", "Domain members", "File"],
            report.domains.map((item) => [
              item.domain,
              item.matches.join(", "),
              list(item.hooks),
              list(item.editor),
              list(item.members),
              item.file,
            ]),
          ),
          "",
          ...report.domains.flatMap((item) => [
            ...item.matches
              .filter((name) => name.startsWith("hook "))
              .map((name) => `- Attach: \`ctx.${item.domain}.hook("${name.slice(5)}", (input) => ...)\``),
            ...(item.editor.length > 0
              ? [
                  `- Edit: \`ctx.${item.domain}.transform((editor) => ...)\` with \`editor.${item.editor.join("`, `editor.")}\``,
                ]
              : []),
          ]),
        ]),
    "",
    "## Upstream plugins that use this module",
    "",
    ...(extenders.length === 0
      ? ["No upstream plugin is this file or calls `transform` on its service."]
      : table(
          ["Plugin", "Use", "File", "ctx uses", "Services read", "Service and editor calls"],
          extenders.map((item) => [
            item.id,
            item.use === "self" ? "this file" : `transform on ${report.namespace}.Service`,
            item.file,
            list(item.ctx),
            list(item.services),
            list(item.calls),
          ]),
        )),
    ...(importers.length === 0
      ? []
      : ["", `Imported (no transform) by: ${importers.map((item) => item.id).join(", ")}.`]),
    ...(report.tool
      ? [
          "",
          `Builtin tool \`${report.tool.name}\`. A Kilo plugin wraps it with \`${report.tool.wrap}\` (parameters, description, output, policy), or replaces it with \`${report.tool.replace}\` (other algorithm or product; list the replaced file as a mirror).`,
        ]
      : []),
    "",
    "## Service nodes (rung 2, host composition)",
    "",
    ...(report.nodes.length === 0
      ? ["No `export const node = ` in this file."]
      : [
          ...table(
            ["Node", "Kind", "Line", "Constructors", "Host call"],
            report.nodes.map((item) => [
              item.name,
              item.kind,
              String(item.line),
              list(item.constructors),
              `\`${item.host}\``,
            ]),
          ),
          "",
          `The Kilo host puts replacements in \`KiloHost.overrides\` in \`${report.host}\`.`,
        ]),
    ...(report.env.length === 0
      ? []
      : [
          "",
          `Environment read: ${report.env.map((item) => `${item.name} (line ${item.line})`).join(", ")}. The host translates \`KILO_*\` variables in \`${report.hostEnv}\`.`,
        ]),
    "",
    "## Existing seams and patches",
    "",
    report.seams.entry
      ? `shared-patches.json: rung ${report.seams.entry.rung}. ${report.seams.entry.seam}`
      : "shared-patches.json: no entry for this file.",
    ...(report.seams.mentions.length === 0
      ? []
      : [
          "",
          ...table(
            ["Entry that names this file", "Rung", "Seam"],
            report.seams.mentions.map((item) => [item.file, String(item.rung), item.seam]),
          ),
        ]),
    "",
    ...(report.seams.markers.length === 0
      ? ["No `kilocode_change` markers in this file."]
      : table(
          ["Line", "Marker"],
          report.seams.markers.map((item) => [String(item.line), item.text]),
        )),
    "",
    "## Suggested start",
    "",
    report.suggestion.text,
    ...(report.kiloOwned ? ["The file is Kilo-owned: change it in place, with no marker."] : []),
  ]
}

function renderImports(report: ImportReport) {
  const violations = report.logic.flatMap((item) => item.violations)
  return [
    "# Import rule check",
    "",
    "## Logic packages (no `@opencode/*` imports)",
    "",
    ...table(
      ["Package", "Files", "@opencode imports"],
      report.logic.map((item) => [item.package, String(item.files), String(item.violations.length)]),
    ),
    ...(violations.length === 0
      ? []
      : ["", ...violations.map((item) => `- ${item.file}:${item.line}: ${item.specifier}`)]),
    "",
    "## Adapters (core-internal modules imported)",
    "",
    ...table(
      ["Adapter", "Files", "Core-internal modules", "Names"],
      report.adapters.map((item) => [
        item.adapter,
        String(item.files),
        String(item.modules.length),
        list(item.modules),
      ]),
    ),
    "",
    `Distinct core-internal modules across all adapters: ${report.total.length}${report.total.length > 0 ? ` (${report.total.join(", ")})` : ""}`,
    ...(report.ok
      ? []
      : ["", `FAIL: ${violations.length} @opencode/* imports in logic packages. Move the code to an adapter.`]),
  ]
}

interface Upstream {
  pin?: string
  files?: Set<string>
}

async function upstreamFiles(root: string, ref?: string): Promise<Upstream> {
  const pin =
    ref ??
    (await pinned("HEAD")
      .then((item) => item.commit)
      .catch(() => undefined))
  const listed = pin ? await $`git ls-tree -r -z --name-only ${pin}`.cwd(root).quiet().nothrow() : undefined
  if (listed?.exitCode === 0) return { pin, files: new Set(listed.stdout.toString().split("\0").filter(Boolean)) }
  if (ref) fail(`Unknown upstream commit for --pin: ${ref}`)
  // A shallow clone (CI) has no sync merge to find the pin. The path patterns alone still give the answer
  // unless upstream added a file at a Kilo-owned path.
  console.error("note: no pinned upstream release in this history; the Kilo-owned check uses the path patterns only")
  return {}
}

async function listFiles(root: string) {
  const out = await $`git ls-files -z --cached --others --exclude-standard`.cwd(root).quiet().text()
  return new Set(out.split("\0").filter(Boolean))
}

function resolveTarget(root: string, input: string, files: Set<string>) {
  if (input.startsWith("@opencode/")) {
    const base = opencodeBase(input)
    const found = base ? candidates(base).find((file) => files.has(file)) : undefined
    if (found) return found
    fail(
      `No file for module ${input}. Tried: ${base ? candidates(base).join(", ") : "nothing (expected @opencode/<pkg>/<sub>)"}`,
    )
  }
  const relative = path.relative(root, path.resolve(root, input)).replaceAll(path.sep, "/")
  if (relative.startsWith("../") || path.isAbsolute(relative)) fail(`Path is outside the repository: ${input}`)
  if (!files.has(relative)) fail(`File not found: ${relative}`)
  return relative
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function read(root: string, file: string) {
  // A tracked file that was deleted in the working tree reads as empty.
  return Bun.file(path.join(root, file))
    .text()
    .catch(() => "")
}

/** `@opencode/<pkg>/<sub>` maps to `packages/<pkg>/src/<sub>` (the `"./*": "./src/*.ts"` exports) */
function opencodeBase(specifier: string) {
  const parts = specifier.match(/^@opencode\/([\w-]+)(?:\/(.+))?$/)
  if (!parts) return undefined
  return `packages/${parts[1]}/src/${parts[2] ?? "index"}`
}

function candidates(base: string) {
  const stem = base.replace(/\.(js|jsx|ts|tsx)$/, "")
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, `${stem}/index.tsx`, base]
}

/** The repository file an import specifier points to, for relative and `@opencode/*` specifiers */
function resolve(specifier: string, from: string, files: Set<string>) {
  const base = specifier.startsWith(".")
    ? path.posix.join(path.posix.dirname(from), specifier)
    : opencodeBase(specifier)
  if (!base) return undefined
  return candidates(base).find((file) => files.has(file))
}

/** Import specifiers of a file, with their line numbers */
function specifiers(text: string) {
  return IMPORTS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((found) => ({
      specifier: found[1],
      line: lineOf(text, found.index + found[0].lastIndexOf(found[1])),
    })),
  ).sort((a, b) => a.line - b.line)
}

function tokens(file: string, namespace?: string) {
  const base = path.basename(file).replace(SOURCE, "")
  const name = base === "index" ? path.basename(path.dirname(file)) : base
  return new Set(
    [name, namespace ?? ""]
      .filter(Boolean)
      .flatMap((text) => [
        ...(text.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? []).map((word) => word.toLowerCase()),
        text.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ]),
  )
}

interface Domain {
  domain: string
  file: string
  hooks: string[]
  editor: string[]
  members: string[]
}

async function readDomains(root: string, files: Set<string>): Promise<Domain[]> {
  const list = [...files]
    .filter((file) => file.startsWith(DOMAINS) && /^[\w-]+\.ts$/.test(file.slice(DOMAINS.length)))
    .filter((file) => !NOT_DOMAINS.has(file.slice(DOMAINS.length)))
    .sort()
  return Promise.all(
    list.map(async (file) => {
      const text = (await read(root, file)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1")
      return {
        domain: path.basename(file, ".ts"),
        file,
        hooks: members(text, "Hooks"),
        editor: members(text, "Editor"),
        members: members(text, "Domain"),
      }
    }),
  )
}

/** Top-level member names of the `<Name><suffix>` interfaces and type literals of a domain file */
function members(text: string, suffix: string) {
  const declarations = text.matchAll(
    new RegExp(`^export (?:interface|type) \\w+${suffix}\\b((?:(?!\\nexport )[^{])*)\\{`, "gm"),
  )
  return unique(
    [...declarations].flatMap((found) => {
      // `extends Pick<Api, "a" | "b">` and `= Pick<...> & {` name members of the API that the domain keeps.
      const picked = /\bPick</.test(found[1]) ? [...found[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : []
      const block = statement(text, found.index + found[0].length - 1)
      const lines = block.slice(1, block.lastIndexOf("}")).split("\n")
      const indent = lines.find((line) => line.trim())?.match(/^\s*/)?.[0].length ?? 0
      const body = lines.reduce(
        (state, line) => {
          const name =
            state.depth === 0 && line.match(/^\s*/)?.[0].length === indent
              ? line.match(/^\s*(?:readonly\s+)?("[^"]+"|[A-Za-z_$][\w$]*)\??\s*[:(<]/)?.[1]
              : undefined
          return {
            depth: state.depth + (line.match(/[{([]/g)?.length ?? 0) - (line.match(/[})\]]/g)?.length ?? 0),
            names: name ? [...state.names, name.replaceAll('"', "")] : state.names,
          }
        },
        { depth: 0, names: [] as string[] },
      )
      return [...picked, ...body.names]
    }),
  )
}

function domainMatches(domain: Domain, words: Set<string>) {
  return [
    ...(words.has(domain.domain) ? [`domain ${domain.domain}`] : []),
    ...domain.hooks.filter((name) => name.split(".").every((part) => words.has(part))).map((name) => `hook ${name}`),
    ...domain.editor.filter((name) => words.has(name.toLowerCase())).map((name) => `editor ${name}`),
    ...domain.members.filter((name) => words.has(name.toLowerCase())).map((name) => `member ${name}`),
  ]
}

/**
 * Upstream plugins that are the target or import it. `use` is `self` (the file is the plugin),
 * `transform` (it calls `transform` on the target's own service, as `opencode.config.compaction` does
 * on `SessionCompaction.Service`; a Kilo plugin can do the same), or `import` (it only uses the module).
 */
async function readPlugins(root: string, files: Set<string>, target: string, namespace?: string) {
  const list = [...files].filter(
    (file) =>
      file === target ||
      (SOURCE.test(file) &&
        !TEST.test(file) &&
        (match(file, "packages/core/src/**/plugin/**") || match(file, "packages/core/src/**/plugin.ts"))),
  )
  const found = await Promise.all(
    list.sort().map(async (file) => {
      const text = await read(root, file)
      const ids = [...text.matchAll(PLUGIN)].map((item) => item[1])
      if (ids.length === 0) return []
      if (file !== target && !specifiers(text).some((item) => resolve(item.specifier, file, files) === target))
        return []
      const bindings = [...text.matchAll(/\bconst (\w+) = yield\* ([A-Z][\w.]*)\.Service\b/g)]
      const own = bindings.find((item) => item[2] === namespace)?.[1]
      const use =
        file === target
          ? "self"
          : own && new RegExp(`\\b${own}\\s*\\.\\s*transform\\s*\\(`).test(text)
            ? "transform"
            : "import"
      const usage = {
        use,
        ctx: unique(
          [...text.matchAll(/\bctx\s*\.\s*(\w+)(?:\s*\.\s*(\w+))?/g)].map((item) =>
            ["ctx", item[1], item[2]].filter(Boolean).join("."),
          ),
        ),
        services: unique([...text.matchAll(/yield\*\s+([A-Z][\w.]*\.Service)\b/g)].map((item) => item[1])),
        calls: unique(
          [...bindings.map((item) => item[1]), "editor"].flatMap((name) =>
            [...text.matchAll(new RegExp(`\\b${name}\\s*\\.\\s*(\\w+)\\s*\\(`, "g"))].map(
              (item) => `${name}.${item[1]}`,
            ),
          ),
        ),
      }
      return ids.map((id) => ({ id, file, ...usage }))
    }),
  )
  const order = ["self", "transform", "import"]
  return found.flat().sort((a, b) => order.indexOf(a.use) - order.indexOf(b.use))
}

function readNodes(text: string, owner: string) {
  // Replacement constructors: `layer`, `layerWith*`, `configured*`, and exported functions that build a node.
  const constructors = unique(
    [...text.matchAll(/^[ \t]*export (?:const|function) (\w+)\b/gm)]
      .filter((item) => item[1] !== "node")
      .filter(
        (item) =>
          /^(layer|layerWith\w*|configured\w*)$/.test(item[1]) ||
          /makeGlobalNode|makeLocationNode/.test(statement(text, item.index)),
      )
      .map((item) => item[1]),
  )
  const make =
    constructors.find((name) => name.startsWith("layerWith")) ??
    constructors.find((name) => name.startsWith("configured")) ??
    constructors.find((name) => name !== "layer")
  return [...text.matchAll(/^([ \t]*)export const node = /gm)].map((found) => {
    // A node inside `export namespace X { ... }` belongs to X, not to the module namespace.
    const space = found[1]
      ? ([...text.slice(0, found.index).matchAll(/^export namespace (\w+)/gm)].at(-1)?.[1] ?? owner)
      : owner
    return {
      name: `${space}.node`,
      kind: nodeKind(statement(text, found.index + found[0].length), text, []),
      line: lineOf(text, found.index),
      constructors,
      host: make
        ? `${space}.node.replace(${space}.${make}(...))`
        : `${space}.node.replace(Layer.effect(${space}.Service, ...))`,
    }
  })
}

/** global or location, read from the node expression or from the same-file function it calls */
function nodeKind(expression: string, text: string, seen: string[]): string {
  if (/makeGlobalNode|values\.global\b/.test(expression)) return "global"
  if (/makeLocationNode|values\.location\b/.test(expression)) return "location"
  const call = expression.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1]
  if (!call || seen.includes(call)) return "unknown"
  const definition = new RegExp(`^[ \\t]*(?:export )?(?:function ${call}\\b|const ${call}\\s*=)`, "m").exec(text)
  if (!definition) return "unknown"
  return nodeKind(statement(text, definition.index), text, [...seen, call])
}

function readSeams(baseline: Baseline, target: string, text: string) {
  const entry = baseline.files[target]
  const named = new RegExp(`(?<![\\w.-])${path.basename(target).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`)
  return {
    entry: entry ? { rung: entry.rung, seam: entry.seam } : null,
    mentions: Object.entries(baseline.files)
      .filter(([file, item]) => file !== target && (item.seam.includes(target) || named.test(item.seam)))
      .map(([file, item]) => ({ file, rung: item.rung, seam: item.seam })),
    markers: text
      .split("\n")
      .flatMap((line, index) => (line.includes("kilocode_change") ? [{ line: index + 1, text: line.trim() }] : [])),
  }
}

interface Facts {
  namespace: string | null
  domains: { domain: string; matches: string[] }[]
  plugins: { id: string; use: string }[]
  tool: { name: string } | null
  nodes: { host: string; kind: string }[]
  env: { name: string }[]
  host: string
  hostEnv: string
}

function suggest(report: Facts) {
  const hooks = report.domains.flatMap((item) =>
    item.matches
      .filter((name) => name.startsWith("hook "))
      .map((name) => `ctx.${item.domain}.hook("${name.slice(5)}", ...)`),
  )
  const transforms = report.plugins.filter((item) => item.use === "transform")
  // The host gives a registered plugin global services only (`v2-feature-placement` skill, step 2).
  const location = report.nodes.some((item) => item.kind === "location")
    ? " (a Location service: a plugin that the host registers cannot read it until a seam in `core/src/plugin/supervisor.ts` provides it)"
    : ""
  const starts = [
    ...hooks.map((item) => `\`${item}\``),
    ...(report.tool ? [`\`ctx.tool.transform((editor) => editor.update("${report.tool.name}", ...))\``] : []),
    ...(transforms.length > 0
      ? [
          `\`${report.namespace}.Service\` with \`transform\`, as ${transforms.map((item) => `\`${item.id}\``).join(", ")} does${location}`,
        ]
      : []),
  ]
  const own = report.plugins.filter((item) => item.use === "self").map((item) => `\`${item.id}\``)
  const domains = report.domains.map((item) => item.domain).join(", ")
  if (starts.length > 0 || domains || own.length > 0) {
    const start =
      starts.length > 0
        ? starts.join(", or ")
        : domains
          ? `the hooks and editor of the ${domains} domain`
          : `the plugin in this file (${own.join(", ")}) and the domains it calls`
    return { rung: 1, text: `rung 1: plugin hook in a Kilo-owned plugin (skill step 2). Start with ${start}.` }
  }
  if (report.nodes.length > 0) {
    return {
      rung: 2,
      text: `rung 2: host composition (skill step 3). Replace the service in \`KiloHost.overrides\` (${report.host}): \`${report.nodes[0].host}\`.`,
    }
  }
  if (report.env.length > 0) {
    return {
      rung: 2,
      text: `rung 2: host composition (skill step 3). Set ${unique(report.env.map((item) => item.name)).join(", ")} from a \`KILO_*\` variable in ${report.hostEnv}.`,
    }
  }
  return { rung: 3, text: "rung 3: no hook and no node, design a seam (skill step 4)." }
}

/** The text of one statement: from `start` to the first line end outside brackets that does not continue it */
function statement(text: string, start: number) {
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (char === "(" || char === "[" || char === "{") depth++
    if (char === ")" || char === "]" || char === "}") depth--
    if (char === "\n" && depth <= 0 && !/(=>?|,)\s*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i)))
      return text.slice(start, i)
  }
  return text.slice(start)
}

function groups(files: string[], key: (file: string) => string) {
  return [...Map.groupBy(files, key).entries()].sort(([a], [b]) => a.localeCompare(b))
}

function adapterGroup(file: string) {
  if (match(file, "packages/kilo-*/src/**")) return file.split("/").slice(0, 3).join("/")
  return file.slice(0, file.indexOf("/src/kilocode/") + "/src/kilocode".length)
}

function lineOf(text: string, index: number) {
  return text.slice(0, index).split("\n").length
}

function unique(items: string[]) {
  return [...new Set(items)]
}

function list(items: string[]) {
  return items.length === 0 ? "none" : items.join(", ")
}

function table(header: string[], rows: string[][]) {
  const line = (cells: string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ")} |`
  return [line(header), `|${header.map(() => "---").join("|")}|`, ...rows.map(line)]
}
