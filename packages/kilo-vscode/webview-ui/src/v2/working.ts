// The working indicator state of main's session context (status, submitting, busyTiming, statusText, retry) from
// native v2 data. Prompt admission, delivery and execution stay distinct: an admitted prompt that waits for its
// execution is "submitting", a started execution is "running", and a scheduled retry is a field of its running step.
import { createComputed, createMemo, untrack } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useLanguage } from "../context/language"
import { hold, statusText, type Timing } from "../components/shared/working-indicator-utils"
import { useV2 } from "./client"

export function createWorking(session: () => string | undefined) {
  const v2 = useV2()
  const language = useLanguage()
  // Active time per session, kept while another session is open, as main's timingMap.
  const [timing, setTiming] = createStore<Record<string, Timing>>({})

  // Pending user input that the runner promotes at its next idle boundary: on main, a submission the server has
  // not answered with a busy status yet.
  const submitting = (id: string) =>
    v2.data.session.pending
      .list(id)
      .some((item) => item.type === "user" && v2.data.session.pending.status(id, item.id) === "starting")
  const busy = (id: string) => v2.data.session.status(id) !== "idle" || submitting(id)
  // A pending permission or question in this session's own family: the clock holds, as main's `parked`. Read from
  // the session itself, not from the open one, so switching away from a parked session cannot bank its wait time.
  const parked = (id: string) =>
    [id, ...v2.data.session.family(id).filter((item) => item !== id)].some(
      (member) =>
        (v2.data.session.permission.list(member)?.length ?? 0) > 0 ||
        (v2.data.session.form.list(member)?.length ?? 0) > 0,
    )

  createComputed(() => {
    const now = Date.now()
    const open = session()
    const ids = new Set([...v2.data.session.active(), ...(open ? [open] : []), ...untrack(() => Object.keys(timing))])
    for (const id of ids) {
      // Read the clock untracked, as main's createTiming does: a copy, so writes below cannot make this computed
      // depend on itself through the store proxy.
      const current = untrack(() => {
        const entry = timing[id]
        if (!entry) return undefined
        return { active: entry.active, since: entry.since }
      })
      if (!busy(id)) {
        if (current) setTiming(produce((map) => delete map[id]))
        continue
      }
      const next: Timing = current ?? { active: 0 }
      // Solid merges clock objects, so clear the running stretch explicitly.
      if (parked(id)) setTiming(id, { ...hold(next, now), since: undefined })
      else setTiming(id, { active: next.active, since: next.since ?? now })
    }
  })

  const text = createMemo(() => {
    const id = session()
    if (!id || v2.data.session.status(id) === "idle") return undefined
    const pending = new Set(v2.data.session.pending.list(id).map((item) => item.id))
    return statusText(v2.data.session.message.list(id), pending, language.t)
  })

  const retry = createMemo(() => {
    const id = session()
    if (!id || v2.data.session.status(id) === "idle") return undefined
    const step = v2.data.session.message.list(id).findLast((item) => item.type === "assistant")
    if (step?.type !== "assistant" || !step.retry) return undefined
    return { message: step.retry.error.message, next: step.retry.at }
  }, undefined, { equals: (a, b) => a?.message === b?.message && a?.next === b?.next })

  return {
    status: () => {
      const id = session()
      return id ? v2.data.session.status(id) : "idle"
    },
    submitting: () => {
      const id = session()
      return !!id && submitting(id)
    },
    timing: () => {
      const id = session()
      return id ? timing[id] : undefined
    },
    text,
    retry,
  }
}
