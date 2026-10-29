export * as AgentPlugin from "./plugin"

import { createHash } from "node:crypto"
import { mkdir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { Diagnostic } from "./diagnostic"
import { Manifest } from "./manifest"
import { Mcp } from "./mcp"
import { Paths } from "./paths"
import { Skills } from "./skills"

export interface Options {
  /** The client-managed directory under which each plugin instance gets its own `PLUGIN_DATA` directory. */
  readonly dataRoot: string
  /** MCP transports the client can connect with. Entries with other transports are skipped and reported. */
  readonly transports?: readonly Mcp.Transport[]
  readonly platform?: NodeJS.Platform
}

export interface Loaded {
  /** The resolved plugin root (`PLUGIN_ROOT`), or the given path when it could not be resolved. */
  readonly root: string
  readonly status: "loaded" | "rejected"
  readonly manifest?: Manifest.Info
  /** The plugin's `PLUGIN_DATA` directory. It is created only when a stdio server needs it. */
  readonly data?: string
  readonly skills: readonly Skills.Info[]
  readonly servers: readonly Mcp.Server[]
  readonly diagnostics: readonly Diagnostic.Info[]
}

/** MCP transports the loader supports by default: the two the specification asks clients for (§7.2.1). */
export const defaultTransports: readonly Mcp.Transport[] = ["stdio", "streamable-http"]

/**
 * Loads an Agent Plugin from a directory (spec §11.1): validates `plugin.json`, then discovers skills and MCP
 * servers independently, so a failure in one component never hides the other. Never throws.
 */
export async function load(input: string, options: Options): Promise<Loaded> {
  const root = await realpath(input).catch(() => undefined)
  if (!root || (await Paths.kind(root)) !== "directory")
    return rejected(input, Diagnostic.error("root-invalid", `Plugin root ${input} is not a directory`))
  const manifest = await readManifest(root)
  if (manifest.type === "rejected")
    return { root, status: "rejected", skills: [], servers: [], diagnostics: manifest.diagnostics }
  const data = directory(options.dataRoot, manifest.manifest.name, root)
  let created: Promise<string | undefined> | undefined
  // Each component is caught on its own: an unexpected failure in one is reported and never hides the other.
  const [skills, mcp] = await Promise.all([
    Skills.discover(root).catch(
      (error: unknown): Skills.Result => ({
        skills: [],
        diagnostics: [
          Diagnostic.error("skills-invalid", `Skills could not be loaded: ${String(error)}`, { component: "skills" }),
        ],
      }),
    ),
    Mcp.read({
      root,
      spec: manifest.manifest.spec,
      platform: options.platform ?? process.platform,
      transports: options.transports ?? defaultTransports,
      data: {
        path: data,
        create: () =>
          (created ??= mkdir(data, { recursive: true }).then(
            () => realpath(data),
            () => undefined,
          )),
      },
    }).catch(
      (error: unknown): Mcp.Result => ({
        servers: [],
        diagnostics: [
          Diagnostic.error("mcp-invalid", `MCP servers could not be loaded: ${String(error)}`, { component: "mcp" }),
        ],
      }),
    ),
  ])
  return {
    root,
    status: "loaded",
    manifest: manifest.manifest,
    data,
    skills: skills.skills,
    servers: mcp.servers,
    diagnostics: [...manifest.diagnostics, ...skills.diagnostics, ...mcp.diagnostics],
  }
}

/**
 * The name a directory's `plugin.json` declares, or undefined when it is not a valid plugin. Lets a client honor
 * user settings such as a disabled list before `load` creates anything for the plugin.
 */
export async function name(input: string) {
  return (await inspect(input)).manifest?.name
}

/** The resolved root and valid manifest of a directory, without discovering components or creating anything. */
export async function inspect(input: string): Promise<{ root?: string; manifest?: Manifest.Info }> {
  const root = await realpath(input).catch(() => undefined)
  if (!root) return {}
  const manifest = await readManifest(root)
  return manifest.type === "valid" ? { root, manifest: manifest.manifest } : { root }
}

/**
 * The `PLUGIN_DATA` directory for one plugin instance: its name plus a hash of its resolved root, so two installs of
 * the same plugin in different places never share state, while an in-place update keeps it (spec §9.1).
 */
export function directory(dataRoot: string, name: string, root: string) {
  return path.join(dataRoot, `${name}-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`)
}

async function readManifest(root: string): Promise<Manifest.Result> {
  const location = path.join(root, "plugin.json")
  const found = await Paths.kind(location)
  if (found === "missing") return reject("manifest-missing", `No plugin.json in ${root}`)
  if (found !== "file") return reject("manifest-invalid", "plugin.json is not a regular file")
  const file = await realpath(location).catch(() => undefined)
  if (!file) return reject("manifest-invalid", "plugin.json could not be resolved")
  if (!Paths.contains(root, file))
    return reject("manifest-outside-root", "plugin.json resolves outside the plugin root")
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (text === undefined) return reject("manifest-invalid", "plugin.json could not be read")
  try {
    return Manifest.decode(JSON.parse(text))
  } catch {
    return reject("manifest-invalid", "plugin.json is not valid JSON")
  }
}

function reject(code: Diagnostic.Code, message: string): Manifest.Result {
  return { type: "rejected", diagnostics: [Diagnostic.error(code, message)] }
}

function rejected(root: string, diagnostic: Diagnostic.Info): Loaded {
  return { root, status: "rejected", skills: [], servers: [], diagnostics: [diagnostic] }
}
