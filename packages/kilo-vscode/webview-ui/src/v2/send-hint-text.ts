import { isMac, type Delivery } from "./pending-actions"

/** The modifier a click sends with: ⌥ on macOS, Alt elsewhere. */
export function clickModifier(mac = isMac()): string {
  return mac ? "⌥" : "Alt"
}

/** The key of a click that sends the way ⌥↵ does, such as `⌥+click` or `Alt+click`. */
export function alternateClickKey(t: (key: string) => string, mac = isMac()): string {
  return `${clickModifier(mac)}+${t("prompt.action.click")}`
}

/** The keycap of the key that sends the way ⌥↵ does, such as `⌥↵` or `Alt+Enter`. */
export function alternateEnterKeybind(mac = isMac()): string {
  return mac ? "⌥↵" : "Alt+Enter"
}

/** One row of a send tooltip: the action and the keys or click that perform it. */
export type SendHintRow = { action: string; keys: string }

/**
 * The rows of a send button's tooltip. The first row is the button's own hint; the second is the delivery an
 * Option-click sends with, which follows `kilo-code.v2.chat.sendWhileRunning` like ⌥↵ in the composer.
 */
export function sendHintRows(input: {
  title: string
  keybind?: string
  /** Optional keyboard shortcut that triggers the alternate delivery alongside Option-click. */
  alternateKeybind?: string
  /** The keycap of the plain click. */
  click: string
  /** The keycap of the Option-click. */
  alternateClick: string
  /** The delivery the Option-click sends with; omitted for an action that does not go to the composer. */
  alternate?: Delivery
  t: (key: string) => string
}): SendHintRow[] {
  const rows: SendHintRow[] = [{ action: input.title, keys: input.keybind ?? input.click }]
  if (!input.alternate) return rows
  rows.push({
    action: input.t(input.alternate === "queue" ? "prompt.action.queue" : "prompt.action.steer"),
    keys: input.alternateKeybind ? `${input.alternateKeybind} / ${input.alternateClick}` : input.alternateClick,
  })
  return rows
}

/**
 * A send action's hint for surfaces that only have a native title, for example a diff annotation button.
 */
export function sendHintText(input: {
  action: string
  click: string
  alternate: Delivery
  t: (key: string) => string
}): string {
  return `${input.action} (${input.click}: ${input.t(`prompt.action.${input.alternate}`)})`
}
