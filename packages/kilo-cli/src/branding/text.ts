export * as KiloBranding from "./text"

import { KiloBrandingRules } from "./rules"
import { KiloBrandingStructural } from "./structural"
import { KiloBrandingEngine } from "./engine"
import { files } from "./files"

export { files }

const intercepted: ReadonlySet<string> = new Set(files)

function key(file: string) {
  return file.replaceAll("\\", "/").split("/packages/").at(-1) ?? file
}

/**
 * Rebrand an upstream module. Only the files in `files` are intercepted, so
 * transform leaves every other file untouched. For an intercepted file it
 * applies, in order: the semantic overrides (whole-file), the structural
 * transforms (imports, logic, OAuth wordmark; fail loud on drift), then the
 * rule engine over user-visible text (dynamic; never throws).
 */
export function transform(file: string, source: string) {
  const id = key(file)
  if (!intercepted.has(id)) return source
  let out = source.replaceAll("\r\n", "\n")
  for (const override of KiloBrandingRules.overrides)
    if (id === override.file) {
      if (!out.includes(override.from)) throw new Error(`Kilo branding no longer matches ${id}: ${override.from}`)
      out = out.replaceAll(override.from, override.to)
    }
  out = KiloBrandingStructural.apply(id, out)
  return KiloBrandingEngine.brandText(file, out)
}
