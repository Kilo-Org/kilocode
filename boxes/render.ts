/**
 * render.ts — Strategy pattern for swappable renderers (listr2 pattern)
 *
 * Define a Renderer interface, then create a strategy that selects
 * between implementations based on environment conditions.
 * Zero deps.
 */

export interface Renderer<T> {
  start?(): void | Promise<void>
  render(data: T): void
  end?(): void | Promise<void>
}

export interface RendererOpts<T> {
  /** Full-featured renderer (TTY, fancy output) */
  fancy: Renderer<T>
  /** Fallback renderer (plain text, no TTY) */
  plain: Renderer<T>
  /** Optional: machine-readable renderer (JSON, etc.) */
  json?: Renderer<T>
  /** Custom TTY detection. Default: false. */
  isTTY?: () => boolean
  /** Custom JSON mode detection. Default: false. */
  isJSON?: () => boolean
}

export function createRenderer<T>(opts: RendererOpts<T>): Renderer<T> {
  const isTTY = opts.isTTY ?? (() => false)
  const isJSON = opts.isJSON ?? (() => false)

  const pick = (): Renderer<T> => {
    if (isJSON() && opts.json) return opts.json
    if (isTTY()) return opts.fancy
    return opts.plain
  }

  return {
    async start() { await pick().start?.() },
    render(data: T) { pick().render(data) },
    async end() { await pick().end?.() },
  }
}
