// Optional lazy sprite-symbol hook registered by host bundlers (such as kilo-vscode) that
// serve SVG sprites as external static files instead of inlining megabytes of SVG into JS.
type SpriteLoader = (name: string) => void

const loaders = new Map<string, SpriteLoader>()

export function registerSpriteLoader(kind: string, loader: SpriteLoader): void {
  loaders.set(kind, loader)
}

export function ensureSpriteSymbol(kind: string, name: string): void {
  loaders.get(kind)?.(name)
}
