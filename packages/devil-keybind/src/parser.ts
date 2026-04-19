/**
 * Internal keybind string parser.
 *
 * Replicates the behavior of packages/opencode/src/util/keybind.ts `Keybind.parse()`
 * so that devil-keybind stays zero-dependency on opencode. Phase 5 will consolidate
 * both parsers into a shared package.
 *
 * Format examples (same string format as opencode's util/keybind):
 *   "ctrl+k"          — single binding
 *   "ctrl+k,alt+k"    — comma-separated alternatives (any matches)
 *   "<leader> p"      — leader prefix (space before key is optional)
 *   "none"            — matches nothing (sentinel)
 */

/** Parsed representation of a single key combo. */
export interface ParsedBinding {
  name: string
  ctrl: boolean
  meta: boolean
  shift: boolean
  super?: boolean
  leader: boolean
}

/**
 * Parse a keybind binding string into an array of `ParsedBinding` alternatives.
 * Returns an empty array for the sentinel value `"none"`.
 *
 * Key name normalisations applied (matching opencode util/keybind.ts):
 *   - "esc"  → stored as "escape"   (register with "esc", match with "escape" or vice-versa)
 *   - "del"  is NOT normalised by the opencode parser (stored as-is "del");
 *     the normalisation to "delete" is done at the MATCH side — see matchParsedBinding.
 *   - "cmd"  → sets meta=true (alias for alt/meta on macOS)
 *   - "option" → sets meta=true
 *   - space literal key: handled by the caller passing name=" "; not parsed here.
 *
 * Note: The opencode parser normalises "esc" → "escape" (case switch sets info.name = "escape")
 * but does NOT normalise "del" → "delete". We mirror that exactly.
 *
 * @internal Not exported from the package barrel. Tested indirectly via matchEvent.
 */
export function parseBinding(binding: string): ParsedBinding[] {
  if (binding === "none") return []

  return binding.split(",").map((combo) => {
    // Replace "<leader>" (with optional trailing space) with "leader+"
    // e.g. "<leader> p" → "leader+ p" → split on "+" gives ["leader", " p"]
    // We trim each part so "<leader> p" works correctly.
    const normalised = combo.replace(/<leader>/g, "leader+")
    const parts = normalised.toLowerCase().split("+")

    const info: ParsedBinding = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "",
    }

    for (const rawPart of parts) {
      const part = rawPart.trim()
      switch (part) {
        case "ctrl":
          info.ctrl = true
          break
        case "alt":
        case "meta":
        case "option":
        case "cmd":
          info.meta = true
          break
        case "super":
          info.super = true
          break
        case "shift":
          info.shift = true
          break
        case "leader":
          info.leader = true
          break
        case "esc":
          // opencode normalises "esc" → "escape"
          info.name = "escape"
          break
        default:
          info.name = part
          break
      }
    }

    return info
  })
}

/**
 * Check whether an incoming key event matches a single `ParsedBinding`.
 *
 * Name normalisation at match time:
 *   - "delete" / "del" are treated as equivalent
 *   - "enter"  / "return" are treated as equivalent
 *   - "space"  / "spacebar" / " " are treated as equivalent
 *   - "escape" / "esc" are treated as equivalent (also normalised at parse time)
 *
 * @internal
 */
export function matchParsedBinding(
  evt: {
    name: string
    ctrl: boolean
    meta: boolean
    shift: boolean
    super?: boolean
    leader: boolean
  },
  parsed: ParsedBinding,
): boolean {
  if (evt.ctrl !== parsed.ctrl) return false
  if (evt.meta !== parsed.meta) return false
  if (evt.shift !== parsed.shift) return false
  if ((evt.super ?? false) !== (parsed.super ?? false)) return false
  if (evt.leader !== parsed.leader) return false
  return normaliseKeyName(evt.name) === normaliseKeyName(parsed.name)
}

/** Canonical key name for comparison purposes. */
function normaliseKeyName(name: string): string {
  switch (name.toLowerCase()) {
    case "del":
    case "delete":
      return "delete"
    case "enter":
    case "return":
      return "enter"
    case "space":
    case "spacebar":
    case " ":
      return "space"
    case "esc":
    case "escape":
      return "escape"
    default:
      return name.toLowerCase()
  }
}
