import { Effect } from "effect"
import * as Catalog from "./catalog"
import { detect } from "./detection"
import * as Installer from "./installer"
import type { InstallPayload, Item, Response, UninstallPayload } from "./types"
import type * as Paths from "./paths"

export const data = Effect.fn("Marketplace.data")(function* (ctx: Paths.Ctx) {
  const [catalog, metadata] = yield* Effect.all([Effect.promise(() => Catalog.all()), detect(ctx)], {
    concurrency: "unbounded",
  })
  return {
    marketplaceItems: catalog.items,
    marketplaceInstalledMetadata: metadata,
    errors: catalog.errors.length > 0 ? catalog.errors : undefined,
  } satisfies Response
})

export const install = Effect.fn("Marketplace.install")(function* (payload: InstallPayload, ctx: Paths.Ctx) {
  const catalog = yield* Effect.promise(() => Catalog.all())
  const item =
    catalog.items.find((item) => item.id === payload.id && item.type === payload.type) ??
    (payload.item?.id === payload.id && payload.item.type === payload.type ? payload.item : undefined)
  if (!item) return { success: false, slug: payload.id, error: "Marketplace item not found" }
  return yield* Installer.install(item, payload, ctx)
})

export const uninstall = Effect.fn("Marketplace.uninstall")(function* (payload: UninstallPayload, ctx: Paths.Ctx) {
  const catalog = yield* Effect.promise(() => Catalog.all())
  const item = catalog.items.find((item) => item.id === payload.id && item.type === payload.type)
  if (!item) return yield* removeStub(payload, ctx)
  return yield* Installer.remove(item, payload.target, ctx)
})

function removeStub(payload: UninstallPayload, ctx: Paths.Ctx) {
  const item = {
    id: payload.id,
    type: payload.type,
    name: payload.id,
    description: "",
    ...(payload.type === "mcp"
      ? { url: "", content: "" }
      : payload.type === "agent"
        ? { content: { mode: "primary" as const, description: "", prompt: "" } }
        : { category: "", githubUrl: "", content: "", displayName: payload.id, displayCategory: "" }),
  }
  return Installer.remove(item as Item, payload.target, ctx)
}

export * as Marketplace from "./index"
