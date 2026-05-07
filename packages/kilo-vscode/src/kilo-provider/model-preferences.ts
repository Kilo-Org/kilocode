import type { ExtensionContext } from "vscode"

type Model = { providerID: string; modelID: string }
type Post = (msg: unknown) => void

interface Context {
  readonly extensionContext?: ExtensionContext
  postMessage: Post
  notifyFavoritesChanged(favorites: Model[]): void
}

function selection(value: unknown): value is Model {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).providerID === "string" &&
    typeof (value as Record<string, unknown>).modelID === "string"
  )
}

export function validateRecents(raw: unknown): Model[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(selection)
    .slice(0, 5)
    .map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export function validateFavorites(raw: unknown): Model[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(selection).map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

export function updateFavorites(current: Model[], action: "add" | "remove", model: Model): Model[] {
  const key = `${model.providerID}/${model.modelID}`
  const exists = current.some((item) => `${item.providerID}/${item.modelID}` === key)
  if (action === "add" && !exists) return [...current, model]
  if (action === "remove" && exists) return current.filter((item) => `${item.providerID}/${item.modelID}` !== key)
  return current
}

export async function persistVariant(ctx: Context, key: string, value: string): Promise<void> {
  const stored = ctx.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
  stored[key] = value
  await ctx.extensionContext?.globalState.update("variantSelections", stored)
}

export function requestVariants(ctx: Context): void {
  const variants = ctx.extensionContext?.globalState.get<Record<string, string>>("variantSelections") ?? {}
  ctx.postMessage({ type: "variantsLoaded", variants })
}

export async function persistRecents(ctx: Context, recents: unknown): Promise<void> {
  const valid = validateRecents(recents)
  await ctx.extensionContext?.globalState.update("recentModels", valid)
}

export function requestRecents(ctx: Context): void {
  const stored = ctx.extensionContext?.globalState.get("recentModels")
  const recents = validateRecents(stored)
  ctx.postMessage({ type: "recentsLoaded", recents })
}

export async function toggleFavorite(ctx: Context, action: "add" | "remove", model: Model): Promise<void> {
  const stored = ctx.extensionContext?.globalState.get("favoriteModels")
  const current = validateFavorites(stored)
  const favorites = updateFavorites(current, action, model)
  await ctx.extensionContext?.globalState.update("favoriteModels", favorites)
  ctx.notifyFavoritesChanged(favorites)
}

export function requestFavorites(ctx: Context): void {
  const stored = ctx.extensionContext?.globalState.get("favoriteModels")
  const favorites = validateFavorites(stored)
  ctx.postMessage({ type: "favoritesLoaded", favorites })
}
