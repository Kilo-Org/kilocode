import { Cause, Context, Effect, Exit, Layer, Ref, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import type { Item, Manifest, ResolvedMcp, SkillItem } from "../marketplace/schema"
import { Marketplace } from "../marketplace/service"
import { buildContext, detect as detectTechnologies } from "./catalog/detect"
import { CatalogSource } from "./catalog/source"
import { Planner } from "./planner"
import { StackRuntime } from "./runtime"
import { Stack } from "./schema"
import { StackStore } from "./store"
import { InstanceState } from "@/effect/instance-state"
import { isRecord } from "@/util/record"

export namespace StackService {
  export class InvalidConfigError extends Schema.TaggedErrorClass<InvalidConfigError>()("StackInvalidConfigError", {
    message: Schema.String,
  }) {}

  export class InvalidDraftError extends Schema.TaggedErrorClass<InvalidDraftError>()("StackInvalidDraftError", {
    message: Schema.String,
  }) {}

  export class StalePlanError extends Schema.TaggedErrorClass<StalePlanError>()("StackStalePlanError", {
    message: Schema.String,
  }) {}

  export class MissingResourceError extends Schema.TaggedErrorClass<MissingResourceError>()(
    "StackMissingResourceError",
    {
      message: Schema.String,
      resources: Schema.Array(Stack.ResourceRef),
    },
  ) {}

  export class MarketplaceUnavailableError extends Schema.TaggedErrorClass<MarketplaceUnavailableError>()(
    "StackMarketplaceUnavailableError",
    { message: Schema.String },
  ) {}

  export class ApplyError extends Schema.TaggedErrorClass<ApplyError>()("StackApplyError", {
    message: Schema.String,
    rollback: Schema.Boolean,
    results: Schema.Array(Stack.Result),
  }) {}

  export type ReadError = InvalidConfigError | MarketplaceUnavailableError
  export type PreviewError = InvalidConfigError | InvalidDraftError
  export type ApplyFailure =
    | InvalidConfigError
    | InvalidDraftError
    | StalePlanError
    | MissingResourceError
    | MarketplaceUnavailableError
    | ApplyError

  export interface Interface {
    readonly catalog: () => Effect.Effect<Stack.CatalogResponse, MarketplaceUnavailableError>
    readonly get: () => Effect.Effect<Stack.StateResponse, ReadError>
    readonly preview: (draft: Stack.Draft) => Effect.Effect<Stack.PreviewResponse, PreviewError>
    readonly apply: (draft: Stack.Draft, hash: Stack.Digest) => Effect.Effect<Stack.ApplyResponse, ApplyFailure>
    readonly detect: () => Effect.Effect<Stack.DetectionResponse>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Stack") {}

  const INVALID_CONFIG = "Project Stack configuration is invalid or unavailable."
  const INVALID_DRAFT = "Stack selection is invalid."
  const STALE = "Stack preview is stale. Refresh and review it again."
  const UNAVAILABLE = "Marketplace is unavailable."
  const APPLY_FAILED = "Stack changes could not be applied."

  function platform(): Planner.Platform {
    if (process.platform === "darwin") return "darwin"
    if (process.platform === "win32") return "win32"
    return "linux"
  }

  function items(manifest: Manifest) {
    return new Map<string, Item>(manifest.items.map((item) => [`${item.kind}:${item.id}`, item]))
  }

  function unavailable(item: Item) {
    if (!item.installability.installable)
      return item.installability.reason ?? "Marketplace resource is not installable."
    if (item.kind === "skill" && !item.artifact) return "Marketplace Skill has no installable artifact."
    if (item.kind === "mcp" && item.methods.length === 0) return "Marketplace MCP has no installation methods."
    return undefined
  }

  function result(action: Stack.Action, success: boolean, message: string): Stack.Result {
    return { resource: action.resource, action: action.action, success, message }
  }

  function success(action: Stack.Action) {
    const messages: Record<Stack.ActionKind, string> = {
      install: "Resource installed and recorded.",
      remove: "Managed resource removed or its missing receipt cleaned.",
      keep: "Managed resource kept.",
      already_available_unmanaged: "Unmanaged resource preserved.",
      relinquish_modified: "Modified resource preserved and ownership relinquished.",
      missing: "Resource remains unavailable.",
      blocked: "Resource remains blocked.",
    }
    return result(action, true, messages[action.action])
  }

  function failure(plan: Stack.Plan, failed?: Stack.Action) {
    return plan.actions.map((action) =>
      result(
        action,
        false,
        failed?.resource === action.resource
          ? "Resource action failed; all changes were rolled back."
          : "Resource action was not applied.",
      ),
    )
  }

  function resource(ref: Stack.ResourceRef) {
    return Stack.ResourceID.make(ref.slice(ref.indexOf(":") + 1))
  }

  function digest(value: string | undefined) {
    return value === undefined ? undefined : Stack.Digest.make(value)
  }

  function draft(config: Stack.Config | undefined): Stack.Draft {
    if (!config) return Schema.decodeUnknownSync(Stack.Draft)({ verticals: {}, resources: {} })
    return Schema.decodeUnknownSync(Stack.Draft)({ verticals: config.verticals, resources: config.resources })
  }

  function state(
    catalog: Stack.Catalog,
    snapshot: StackStore.Snapshot,
    manifest: Manifest | undefined,
    inventory: Planner.Inventory,
  ): Stack.StateResponse {
    const value = draft(snapshot.stack)
    const plan = Planner.plan({
      catalog,
      marketplace: manifest,
      draft: value,
      inventory,
      receipts: snapshot.stack?.managed ?? {},
      config_revision: snapshot.revision,
      platform: platform(),
    })
    const resolution = Planner.resolve(catalog, value)
    const desired = new Map(resolution.resources.map((item) => [item.ref, item]))
    const actions = new Map(plan.actions.map((action) => [action.resource, action]))
    const receipts = snapshot.stack?.managed ?? {}
    const inherited = new Set(inventory.inherited)
    const refs = new Set<Stack.ResourceRef>([
      ...resolution.resources.map((item) => item.ref),
      ...Object.keys(receipts).map((ref) => Stack.ResourceRef.make(ref)),
      ...Object.keys(inventory.project).map((ref) => Stack.ResourceRef.make(ref)),
      ...inventory.inherited,
    ])
    const resources = [...refs].toSorted().map((ref): Stack.ResourceState => {
      const receipt = receipts[ref]
      const current = inventory.project[ref]
      const action = actions.get(ref)
      const drift: Stack.Drift = (() => {
        if (receipt && current === undefined) return "missing"
        if (receipt && current !== receipt.fingerprint) return "modified"
        if (action?.action === "install" || action?.action === "remove") return "desired"
        return "none"
      })()
      return {
        resource: ref,
        enabled: desired.get(ref)?.enabled ?? false,
        managed: receipt !== undefined,
        inherited: inherited.has(ref),
        drift,
      }
    })
    return {
      ...(snapshot.stack === undefined ? {} : { config: snapshot.stack }),
      draft: plan.draft,
      resources,
      conflicts: plan.conflicts,
      config_revision: snapshot.revision,
      catalog_revision: catalog.revision,
    }
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const marketplace = yield* Marketplace.Service
      const store = yield* StackStore.Service
      const runtime = yield* StackRuntime.Service
      const fs = yield* AppFileSystem.Service
      const catalogSource = yield* CatalogSource.Service

      const manifest = Effect.fnUntraced(function* () {
        return yield* marketplace
          .manifest()
          .pipe(Effect.mapError(() => new MarketplaceUnavailableError({ message: UNAVAILABLE })))
      })

      const snapshot = Effect.fnUntraced(function* () {
        return yield* store.read().pipe(Effect.mapError(() => new InvalidConfigError({ message: INVALID_CONFIG })))
      })

      const inventory = Effect.fnUntraced(function* (current: StackStore.Snapshot, resolved: Stack.Catalog) {
        const managed = Object.keys(current.stack?.managed ?? {}).map((ref) => Stack.ResourceRef.make(ref))
        const targets = [...new Set([...resolved.resources.map((resource) => resource.ref), ...managed])]
        return yield* runtime
          .inventory(current.mcp, targets, managed)
          .pipe(Effect.catchCause(() => new InvalidConfigError({ message: INVALID_CONFIG })))
      })

      const load = Effect.fnUntraced(function* (resolved: Stack.Catalog) {
        const first = yield* snapshot()
        const local = yield* inventory(first, resolved)
        const latest = yield* snapshot()
        if (latest.revision === first.revision) return { snapshot: first, inventory: local }
        return { snapshot: latest, inventory: yield* inventory(latest, resolved) }
      })

      const decode = Effect.fnUntraced(function* (input: Stack.Draft) {
        return yield* Schema.decodeUnknownEffect(Stack.Draft)(input, { onExcessProperty: "error" }).pipe(
          Effect.mapError(() => new InvalidDraftError({ message: INVALID_DRAFT })),
        )
      })

      const catalog = Effect.fn("Stack.catalog")(function* () {
        yield* InstanceState.context
        const { catalog: cat, origin } = yield* catalogSource.get()
        const source = (yield* manifest()).manifest
        const found = items(source)
        const expected = cat.resources.map((r) => r.ref).toSorted()
        const resources = cat.resources.map((entry): Stack.ResourceSummary => {
          const item = found.get(entry.ref)
          if (!item) return { resource: entry, availability: "missing", reason: "Resource is absent from Marketplace." }
          const reason = unavailable(item)
          if (reason) return { resource: entry, availability: "blocked", reason, item }
          return { resource: entry, availability: "available", item }
        })
        return { catalog: cat, resources, expected_resources: expected, catalog_origin: origin }
      })

      const get = Effect.fn("Stack.get")(function* () {
        yield* InstanceState.context
        const { catalog: cat } = yield* catalogSource.get()
        const current = yield* load(cat)
        const source = (yield* manifest()).manifest
        return state(cat, current.snapshot, source, current.inventory)
      })

      const preview = Effect.fn("Stack.preview")(function* (input: Stack.Draft) {
        yield* InstanceState.context
        const { catalog: cat } = yield* catalogSource.get()
        const current = yield* load(cat)
        const source = yield* marketplace.manifest().pipe(
          Effect.map((value) => value.manifest),
          Effect.catch(() => Effect.succeed(undefined)),
        )
        return Planner.plan({
          catalog: cat,
          marketplace: source,
          draft: yield* decode(input),
          inventory: current.inventory,
          receipts: current.snapshot.stack?.managed ?? {},
          config_revision: current.snapshot.revision,
          platform: platform(),
        })
      })

      const apply = Effect.fn("Stack.apply")(function* (input: Stack.Draft, hash: Stack.Digest) {
        yield* InstanceState.context
        const selected = yield* decode(input)
        const { catalog: cat } = yield* catalogSource.get()
        const body = Effect.scoped(
          Effect.gen(function* () {
            yield* InstanceState.context
            const loaded = yield* load(cat)
            const current = loaded.snapshot
            const local = loaded.inventory
            const source = yield* marketplace.manifest().pipe(
              Effect.map((value) => value.manifest),
              Effect.catch(() => Effect.succeed(undefined)),
            )
            const plan = Planner.plan({
              catalog: cat,
              marketplace: source,
              draft: selected,
              inventory: local,
              receipts: current.stack?.managed ?? {},
              config_revision: current.revision,
              platform: platform(),
            })
            if (plan.plan_hash !== hash) return yield* new StalePlanError({ message: STALE })
            if (plan.conflicts.some((conflict) => conflict.code === "invalid_config")) {
              return yield* new InvalidConfigError({ message: INVALID_CONFIG })
            }
            if (plan.conflicts.some((conflict) => conflict.code === "invalid_draft")) {
              return yield* new InvalidDraftError({ message: INVALID_DRAFT })
            }
            const missing = plan.actions
              .filter((action) => action.action === "missing" || action.action === "blocked")
              .map((action) => action.resource)
            if (missing.length > 0) {
              return yield* new MissingResourceError({
                message: "One or more selected resources are unavailable in Marketplace.",
                resources: [...new Set(missing)].toSorted(),
              })
            }

            const available = source ? items(source) : new Map<string, Item>()
            const installs = plan.actions.filter((action) => action.action === "install")
            const skills = installs.filter((action) => available.get(action.resource)?.kind === "skill")
            const root =
              skills.length > 0
                ? yield* runtime
                    .stage()
                    .pipe(
                      Effect.mapError(
                        () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan) }),
                      ),
                    )
                : undefined
            const staged = new Map<
              Stack.ResourceRef,
              { readonly item: SkillItem; readonly path: string; readonly fingerprint: Stack.Digest }
            >()
            for (const action of skills) {
              const item = available.get(action.resource)
              if (!item || item.kind !== "skill" || root === undefined) {
                return yield* new MissingResourceError({
                  message: "One or more selected resources are unavailable in Marketplace.",
                  resources: [action.resource],
                })
              }
              const value = yield* marketplace
                .stageSkill(root, item)
                .pipe(
                  Effect.mapError(
                    () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan, action) }),
                  ),
                )
              const fingerprint = yield* runtime
                .fingerprint(value.path)
                .pipe(
                  Effect.mapError(
                    () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan, action) }),
                  ),
                )
              staged.set(action.resource, { item, path: value.path, fingerprint })
            }

            const resolved = new Map<Stack.ResourceRef, ResolvedMcp>()
            for (const action of installs) {
              const item = available.get(action.resource)
              if (!item || item.kind !== "mcp") continue
              const override = plan.draft.resources[action.resource]
              if (!override?.method) return yield* new InvalidDraftError({ message: INVALID_DRAFT })
              const value = yield* marketplace
                .resolveMcp({ item, method: override.method, parameters: override.parameters })
                .pipe(
                  Effect.mapError(
                    () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan, action) }),
                  ),
                )
              resolved.set(action.resource, value)
            }

            const receipts: Record<string, Stack.Receipt> = { ...current.stack?.managed }
            const patch: Record<string, StackStore.Json | undefined> = {}
            for (const action of plan.actions) {
              const item = available.get(action.resource)
              if (["remove", "relinquish_modified", "already_available_unmanaged"].includes(action.action)) {
                delete receipts[action.resource]
              }
              if (action.action === "remove" && action.resource.startsWith("mcp:")) {
                patch[resource(action.resource)] = undefined
              }
              if (action.action !== "install" && action.action !== "keep") continue
              if (!item) {
                return yield* new MissingResourceError({
                  message: "One or more selected resources are unavailable in Marketplace.",
                  resources: [action.resource],
                })
              }
              const digest = Planner.digest(item)
              const fingerprint = (() => {
                if (action.action === "keep") return local.project[action.resource]
                if (item.kind === "skill") return staged.get(action.resource)?.fingerprint
                const value = resolved.get(action.resource)
                return value ? Planner.fingerprintMcp(value) : undefined
              })()
              if (!digest || !fingerprint) {
                return yield* new ApplyError({
                  message: APPLY_FAILED,
                  rollback: true,
                  results: failure(plan, action),
                })
              }
              receipts[action.resource] = {
                marketplace_id: resource(action.resource),
                ...(item.version === undefined ? {} : { version: item.version }),
                digest,
                fingerprint,
              }
              if (action.action === "install" && item.kind === "mcp") {
                const value = resolved.get(action.resource)
                if (!value) return yield* new InvalidDraftError({ message: INVALID_DRAFT })
                const prior = current.mcp[item.id]
                // Activate confirmed fresh installs, but preserve a user's explicit disablement during managed updates.
                const enabled =
                  current.stack?.managed[action.resource] && isRecord(prior) ? prior.enabled !== false : true
                patch[item.id] = { ...value, enabled }
              }
            }

            const managed = Object.fromEntries(
              Object.entries(receipts).toSorted(([left], [right]) => left.localeCompare(right)),
            )
            const next = yield* Schema.decodeUnknownEffect(Stack.Config)({
              version: 1,
              catalog_revision: cat.revision,
              verticals: plan.draft.verticals,
              resources: plan.draft.resources,
              managed,
            }).pipe(Effect.mapError(() => new InvalidConfigError({ message: INVALID_CONFIG })))
            const prepared = yield* store
              .prepare({ revision: current.revision, stack: next, mcp: patch })
              .pipe(
                Effect.mapError((error) =>
                  error._tag === "StackStoreRevisionConflictError"
                    ? new StalePlanError({ message: STALE })
                    : new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan) }),
                ),
              )
            const transaction = yield* runtime
              .transaction()
              .pipe(
                Effect.mapError(
                  () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan) }),
                ),
              )

            const committed = yield* Ref.make<StackStore.Committed | undefined>(undefined)
            const changed = Effect.gen(function* () {
              for (const action of plan.actions) {
                if (!action.resource.startsWith("skill:")) continue
                const id = resource(action.resource)
                if (action.action === "remove") {
                  yield* transaction
                    .remove(id, digest(current.stack?.managed[action.resource]?.fingerprint))
                    .pipe(
                      Effect.mapError(
                        () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan, action) }),
                      ),
                    )
                  continue
                }
                if (action.action !== "install") continue
                const value = staged.get(action.resource)
                if (!value) {
                  return yield* new ApplyError({
                    message: APPLY_FAILED,
                    rollback: true,
                    results: failure(plan, action),
                  })
                }
                yield* transaction
                  .install({
                    id,
                    source: value.path,
                    replace:
                      current.stack?.managed[action.resource] !== undefined &&
                      local.project[action.resource] !== undefined,
                    expected: digest(current.stack?.managed[action.resource]?.fingerprint),
                  })
                  .pipe(
                    Effect.mapError(
                      () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan, action) }),
                    ),
                  )
              }
              const value = yield* store
                .commit(prepared)
                .pipe(
                  Effect.mapError(
                    () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan) }),
                  ),
                )
              yield* Ref.set(committed, value)

              const refreshed = yield* snapshot().pipe(
                Effect.mapError(
                  () => new ApplyError({ message: APPLY_FAILED, rollback: true, results: failure(plan) }),
                ),
              )
              const project = { ...local.project }
              for (const action of plan.actions) {
                if (action.action === "remove") delete project[action.resource]
                if (action.action !== "install") continue
                const receipt = receipts[action.resource]
                if (receipt) project[action.resource] = Stack.Digest.make(receipt.fingerprint)
              }
              const verified = {
                project: Object.fromEntries(
                  Object.entries(project).toSorted(([left], [right]) => left.localeCompare(right)),
                ),
                inherited: local.inherited,
              }
              return {
                results: plan.actions.map(success),
                state: state(cat, refreshed, source, verified),
              }
            })

            const rollback = Effect.fnUntraced(function* <E>(cause: Cause.Cause<E>) {
              const value = yield* Ref.get(committed)
              const config = value ? yield* store.rollback(value).pipe(Effect.exit) : undefined
              const files = yield* transaction.rollback().pipe(Effect.exit)
              const restored = (config === undefined || Exit.isSuccess(config)) && Exit.isSuccess(files)
              if (Cause.hasInterruptsOnly(cause) && restored) return yield* Effect.interrupt
              const error = Cause.squash(cause)
              return yield* new ApplyError({
                message: APPLY_FAILED,
                rollback: restored,
                results: error instanceof ApplyError ? error.results : failure(plan),
              })
            })
            return yield* Effect.uninterruptibleMask((restore) =>
              changed.pipe(
                Effect.flatMap((output) => restore(Effect.void).pipe(Effect.as(output))),
                Effect.matchCauseEffect({
                  onSuccess: (output) =>
                    transaction.complete().pipe(
                      Effect.matchCauseEffect({
                        onSuccess: () => Effect.succeed(output),
                        onFailure: rollback,
                      }),
                    ),
                  onFailure: rollback,
                }),
              ),
            )
          }),
        )
        return yield* store
          .withLock(body)
          .pipe(
            Effect.mapError((error) =>
              error._tag === "LockCompromisedError" ||
              error._tag === "LockTimeoutError" ||
              error._tag === "StackStoreFileError"
                ? new ApplyError({ message: APPLY_FAILED, rollback: true, results: [] })
                : error,
            ),
          )
      })

      const detect = Effect.fn("Stack.detect")(function* () {
        yield* InstanceState.context
        const { catalog: cat } = yield* catalogSource.get()
        const dir = yield* InstanceState.directory
        const ctx = yield* buildContext(dir, fs)
        return { detections: detectTechnologies(ctx, cat) }
      })

      return Service.of({ catalog, get, preview, apply, detect })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(CatalogSource.defaultLayer),
    Layer.provide(StackRuntime.defaultLayer),
    Layer.provide(StackStore.defaultLayer),
    Layer.provide(Marketplace.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )
}
