import { Log } from "@/util/log"
import { linux } from "./linux"
import { macos } from "./macos"
import { noop } from "./noop"
import { windows } from "./windows"
import type { Inhibitor } from "./types"

/**
 * Platform routing for sleep inhibitor backends.
 *
 * Equivalent of codex's `cfg(target_os = ...)` module selection in
 * `codex-rs/utils/sleep-inhibitor/src/lib.rs:10-26`. Each platform file
 * exports a factory that returns an `Inhibitor` — if native-library loading
 * fails inside the factory, the factory itself silently returns an inhibitor
 * whose `acquire`/`release` are no-ops.
 *
 * Any exception thrown at construction time (e.g. bun:ffi refusing to
 * `dlopen` on an unusual system) is caught here and degraded to `noop`,
 * so the CLI always stays usable. Matches codex's overall posture where
 * the feature is best-effort and never fatal.
 */

const log = Log.create({ service: "sleep-inhibitor" })

export function pick(): Inhibitor {
  try {
    if (process.platform === "darwin") return macos()
    if (process.platform === "win32") return windows()
    if (process.platform === "linux") return linux()
    return noop()
  } catch (err) {
    log.warn("platform inhibitor construction failed; using noop", { error: String(err) })
    return noop()
  }
}
