import { debug, warn } from "../utils/logger"

const INDEX = "packages/opencode/src/index.ts"
const IMPORT = /^import \{ WebCommand \} from "\.\/cli\/cmd\/web"\n/m
const REGISTER = /^(\s*)\.command\(WebCommand\)\n/m
const REFERENCE = /\bWebCommand\b|["']\.\/cli\/cmd\/web["']/
const OMIT_IMPORT =
  "// kilocode_change - upstream web command intentionally omitted; Kilo does not ship an embedded web UI\n"
const OMIT_REGISTER = "// kilocode_change - upstream web command intentionally omitted\n"

export type KiloWebResult = {
  result: string
  removals: number
  review: boolean
}

export function removeKiloWeb(file: string, content: string): KiloWebResult {
  if (file !== INDEX) return { result: content, removals: 0, review: false }

  const result = content.replace(IMPORT, OMIT_IMPORT).replace(REGISTER, `$1${OMIT_REGISTER}`)
  const removals = Number(result !== content)
  const review = REFERENCE.test(result)
  return { result, removals, review }
}

export async function transformKiloWeb(options: { dryRun?: boolean; verbose?: boolean } = {}): Promise<KiloWebResult> {
  const file = Bun.file(INDEX)
  if (!(await file.exists())) return { result: "", removals: 0, review: false }

  const content = await file.text()
  const transformed = removeKiloWeb(INDEX, content)
  if (transformed.removals > 0 && !options.dryRun) await Bun.write(INDEX, transformed.result)
  if (transformed.removals > 0 && options.verbose) debug("Removed unsupported Kilo web command registration")
  if (transformed.review) {
    warn("Kilo web command shape changed upstream — review packages/opencode/src/index.ts; merge continues")
  }
  return transformed
}
