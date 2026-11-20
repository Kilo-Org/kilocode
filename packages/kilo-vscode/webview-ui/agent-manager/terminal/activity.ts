import { isActivity, type Activity } from "../v2/activity"

export function createActivityTracker(report: (state: Activity) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    report("idle")
  }
  const handle = (data: string) => {
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
  }
  return {
    handle,
    clear,
    dispose: clear,
  }
}
