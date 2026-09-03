import type { IParser } from "@xterm/xterm"
import { isActivity, type Activity } from "../../src/utils/session-activity"

export function registerActivity(parser: Pick<IParser, "registerOscHandler">, report: (state: Activity) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    report("idle")
  }
  const handler = parser.registerOscHandler(777, (data) => {
    if (!data.startsWith("kilo;activity;")) return false
    const [, , version, state, stamp, extra] = data.split(";")
    const time = Number(stamp)
    const age = Date.now() - time
    if (version !== "1" || extra !== undefined || !isActivity(state) || !Number.isSafeInteger(time)) return true
    if (age < -5_000 || age >= 15_000) return true
    clearTimeout(timer)
    report(state)
    timer = setTimeout(clear, Math.min(15_000, 15_000 - age))
    return true
  })
  return {
    clear,
    dispose: () => {
      handler.dispose()
      clear()
    },
  }
}
