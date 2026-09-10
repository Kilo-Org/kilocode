/**
 * IME composition: Enter should confirm glyphs, not trigger chat send / shortcuts.
 * Browsers set `isComposing` while composing; on Windows, `keyCode === 229` often
 * marks IME-handled keys even when `isComposing` is false for a given keydown.
 */
export function isEnterKeyCommitNotIme(e: Pick<KeyboardEvent, "key" | "isComposing" | "keyCode">): boolean {
  return e.key === "Enter" && !e.isComposing && e.keyCode !== 229
}
