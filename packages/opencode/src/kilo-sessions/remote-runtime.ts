// kilocode_change - first-class local runtime presence for mobile.
// `RemoteRuntime` owns the per-process `runtimeId`, the safe display labels,
// the fixed launch directory, and the advertised capability set. The absolute
// launch directory is captured once at construction and never re-read; the
// only directory-derived value the cloud ever sees is the basename.
//
// `connectionId` is the stable transport identifier returned by
// `RemoteWS.connect()`. It is set once when the connection is created and
// remains stable for the lifetime of the `Connection` object, including
// across internal WebSocket reconnects. A process restart creates a new
// `Connection` with a new `connectionId` and a new `runtimeId`.
//
// The runtime also exposes a sessionless `catalog()` for the first-class
// mobile flow. The catalog is computed in the fixed launch-directory
// Instance context; the cloud never receives the absolute path or any
// provider credentials, and a usable default agent must be present.

import z from "zod"
import { RemoteModelCatalog } from "@/kilo-sessions/remote-model-catalog"

const Label = z
  .string()
  .min(1)
  .transform(value => {
    // Strip control characters and collapse internal whitespace, then truncate
    // to the 80-char wire cap. The truncation lives in the transform so a
    // long input is clamped instead of rejected — the cloud contract is the
    // single source of truth for the cap.
    const cleaned = value
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)
    return cleaned
  })
  .refine(value => value.length > 0, { message: "label must not be empty after sanitization" })

const Directory = z.string().min(1, { message: "directory must not be empty" })

const CliVersion = z.string().min(1).max(32)

const RUNTIME_CAPABILITIES = ["catalog.v1", "create-and-run.v1"] as const
export type LocalRuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number]

const Presence = z.object({
  runtimeId: z.string().uuid(),
  connectionId: z.string().min(1).max(128),
  protocolVersion: z.literal(1),
  cliVersion: CliVersion,
  displayName: z.string().min(1).max(80),
  projectName: z.string().min(1).max(80),
  capabilities: z
    .array(z.enum(RUNTIME_CAPABILITIES))
    .max(2)
    .refine(values => new Set(values).size === values.length, {
      message: "runtime capabilities must be unique",
    }),
})
export type LocalRuntimePresence = z.infer<typeof Presence>

// Minimal agent shape we read from the source. Anything outside this shape
// is ignored, so the catalog projection cannot leak prompt text, options,
// or permission rules.
type RawAgent = {
  name: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  model?: { providerID: string; modelID: string }
  variant?: string
}

const AGENT_LABELS: Record<string, string> = {
  build: "Build",
  plan: "Plan",
  general: "General",
}

function displayNameFor(slug: string): string {
  return AGENT_LABELS[slug] ?? slug
}

export namespace RemoteRuntime {
  // Sessionless catalog request: exact `{ protocolVersion: 1 }` with no extra
  // fields allowed. Reused by the sender strict parser.
  export const CatalogRequest = z
    .object({
      protocolVersion: z.literal(1),
    })
    .strict()
  export type CatalogRequest = z.infer<typeof CatalogRequest>

  // One projected agent in the runtime catalog. Strict, bounded, and free
  // of any provider credentials. `name` is the human-friendly label (the
  // well-known "build" agent is rendered as "Build" for the picker).
  export const CatalogAgent = z
    .object({
      slug: z.string().min(1).max(100),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      model: z
        .object({
          providerID: z.string().min(1).max(255),
          modelID: z.string().min(1).max(255),
        })
        .strict()
        .optional(),
      variant: z.string().min(1).max(100).optional(),
    })
    .strict()
  export type CatalogAgent = z.infer<typeof CatalogAgent>

  // Injected dependency surface used by `catalog()`. The production wiring
  // resolves these via `Provider.Service` and `Agent.Service` in the
  // launch-directory Instance context; tests pass deterministic fixtures.
  export type CatalogSource = {
    listProviders: () => Promise<unknown>
    defaultModel: () => Promise<RemoteModelCatalog.ModelRef | undefined>
    listAgents: () => Promise<ReadonlyArray<RawAgent>>
    defaultAgent: () => Promise<string>
  }

  // Public catalog type. The model field reuses the existing v1 shape and
  // is already strictly bounded by `RemoteModelCatalog.build`; the runtime
  // does not re-validate it.
  export type Catalog = {
    protocolVersion: 1
    models: RemoteModelCatalog.Response
    agents: ReadonlyArray<CatalogAgent>
    defaultAgent: string
  }

  export type Options = {
    runtimeId: string
    connectionId: string
    cliVersion: string
    directory: string
    displayName: string
    // Injected catalog source; production wiring resolves Provider/Agent
    // services inside the launch-directory Instance context. Tests pass
    // fixtures directly.
    catalog?: CatalogSource
  }

  export type Interface = {
    readonly runtimeId: string
    readonly directory: string
    setConnectionId(connectionId: string): void
    presence(): LocalRuntimePresence
    catalog(
      request: CatalogRequest,
      log?: { error?: (msg: string, meta?: unknown) => void },
    ): Promise<Catalog>
  }

  export function create(options: Options): Interface {
    const runtimeId = z.string().uuid().parse(options.runtimeId)
    const cliVersion = CliVersion.parse(options.cliVersion)
    const directory = Directory.parse(options.directory)
    const displayName = Label.parse(options.displayName)
    const projectName = Label.parse(deriveProjectName(directory))
    const capabilities: LocalRuntimeCapability[] = [...RUNTIME_CAPABILITIES]
    let connectionId = options.connectionId
    const catalogSource = options.catalog

    function project(agent: RawAgent): CatalogAgent | undefined {
      if (agent.mode === "subagent") return undefined
      if (agent.hidden === true) return undefined
      const slug = agent.name
      if (!slug) return undefined
      const out: CatalogAgent = {
        slug,
        name: displayNameFor(slug),
      }
      const description = agent.description?.trim()
      if (description) {
        Object.assign(out, { description: description.slice(0, 500) })
      }
      if (agent.model && agent.model.providerID && agent.model.modelID) {
        Object.assign(out, {
          model: {
            providerID: agent.model.providerID,
            modelID: agent.model.modelID,
          },
        })
      }
      if (agent.variant && agent.variant.length > 0) {
        Object.assign(out, { variant: agent.variant.slice(0, 100) })
      }
      return out
    }

    return {
      get runtimeId() {
        return runtimeId
      },
      get directory() {
        return directory
      },
      setConnectionId(next) {
        connectionId = z.string().min(1).max(128).parse(next)
      },
      presence() {
        return Presence.parse({
          runtimeId,
          connectionId,
          protocolVersion: 1,
          cliVersion,
          displayName,
          projectName,
          capabilities,
        })
      },
      async catalog(request, log) {
        const parsed = CatalogRequest.safeParse(request)
        if (!parsed.success) {
          throw new Error("failed to load runtime catalog")
        }
        if (!catalogSource) {
          throw new Error("failed to load runtime catalog")
        }
        try {
          const [providers, defaultModel, rawAgents, defaultSlug] = await Promise.all([
            catalogSource.listProviders(),
            catalogSource
              .defaultModel()
              .catch((err: unknown) => {
                log?.error?.("runtime catalog default model failed", {
                  operation: "catalog",
                  error: errorName(err),
                })
                return undefined
              }),
            catalogSource.listAgents(),
            catalogSource.defaultAgent(),
          ])
          const projected = rawAgents
            .map(project)
            .filter((agent): agent is CatalogAgent => agent !== undefined)
          const present = projected.find((agent) => agent.slug === defaultSlug)
          if (!present) {
            throw new Error("failed to load runtime catalog")
          }
          const models = RemoteModelCatalog.build({
            providers: providers as Parameters<typeof RemoteModelCatalog.build>[0]["providers"],
            session: {},
            messages: [],
            ...(defaultModel ? { defaultModel } : {}),
          })
          const agents = z.array(CatalogAgent).max(128).parse(projected)
          return {
            protocolVersion: 1,
            models,
            agents,
            defaultAgent: defaultSlug,
          }
        } catch (err) {
          log?.error?.("runtime catalog failed", { operation: "catalog", error: errorName(err) })
          throw new Error("failed to load runtime catalog")
        }
      },
    }
  }

  function deriveProjectName(directory: string): string {
    // Strip trailing slashes so `/tmp/proj/` → "proj" (not "").
    const trimmed = directory.replace(/[\\/]+$/, "")
    const last = trimmed.split(/[\\/]/).pop() ?? ""
    return last.length === 0 ? "root" : last
  }
}

// Narrow `log` to a warn-only shape; the runtime catalog error channel
// uses the same sanitized error-name pattern as the rest of the kilo
// sessions module so messages/credentials never end up in logs.
function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name
  return typeof error
}
