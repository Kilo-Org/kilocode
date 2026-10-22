// kilocode_change - new file: soft max-cost nudge wiring for the TUI
import { MaxCostNudge, type MaxCostChoice, type MaxCostMessage } from "@opencode-ai/core/kilocode/cost/max-cost-nudge"
import { useSync } from "@tui/context/sync"
import { useEvent } from "@tui/context/event"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { createSimpleContext } from "@tui/context/helper"

export const { use: useNudge, provider: NudgeProvider } = createSimpleContext({
  name: "Nudge",
  init: () => {
    const sync = useSync()
    const event = useEvent()
    const sdk = useSDK()
    const dialog = useDialog()

    const nudge = new MaxCostNudge()
    const seeded = new Set<string>()
    const running = new Set<string>()

    function seed(sid: string): number {
      const total = nudge.resetMessageCosts(sid, (sync.data.message[sid] ?? []) as MaxCostMessage[])
      seeded.add(sid)
      return total
    }

    function cost(sid: string): number {
      if (!seeded.has(sid)) seed(sid)
      return nudge.setSessionCost(sid, sync.session.get(sid)?.cost ?? 0)
    }

    function check(sid: string) {
      if (nudge.limit === undefined) return
      cost(sid)
      const alert = nudge.check(sid)
      if (alert) showCostAlert(sid, alert.limit, alert.cost)
    }

    function abort(sid: string) {
      void sdk.client.session.abort({ sessionID: sid }).catch((err) => console.error("Abort session failed", err))
    }

    function showCostAlert(sid: string, limit: number, cost: number) {
      const message = `This session just went above your ${MaxCostNudge.formatCost(
        limit,
      )} alert threshold and cost ${MaxCostNudge.formatCost(cost)}. Keep going?`
      void DialogConfirm.show(dialog, "Session Cost Alert", message, "Stop").then((result) => {
        // Dismissed via Esc/outside-click: snooze for this run (stays in #alerted) without
        // acking, so the alert re-appears on the next run rather than nagging mid-run.
        if (result === undefined) return
        const choice: MaxCostChoice = result === false ? "stop" : "continue"
        nudge.resolve(sid, choice, limit)
        if (choice === "stop") abort(sid)
      })
    }

    event.sync((e) => {
      switch (e.name) {
        case "message.updated.1": {
          const info = e.data.info
          const sid = info.sessionID
          if (!seeded.has(sid)) seed(sid)
          const value = info.role === "assistant" ? info.cost : undefined
          nudge.updateMessageCost(sid, info.id, info.role, value)
          check(sid)
          break
        }
        case "message.removed.1": {
          nudge.removeMessageCost(e.data.messageID)
          break
        }
        case "session.deleted.1": {
          nudge.onSessionDeleted(e.data.sessionID)
          seeded.delete(e.data.sessionID)
          running.delete(e.data.sessionID)
          break
        }
      }
    })

    // busy/retry fire repeatedly within one run, so re-arm only on the idle->running edge.
    event.subscribe((e) => {
      if (e.type !== "session.status") return
      const sid = e.properties.sessionID
      if (e.properties.status.type === "idle") {
        running.delete(sid)
        return
      }
      if (running.has(sid)) return
      running.add(sid)
      nudge.rearm(sid)
    })

    // sid is optional: the limit is global, so it can be set from the home screen too.
    function setLimit(sid: string | undefined, value: number) {
      const limit = MaxCostNudge.normalizeLimit(value)
      if (limit === undefined) {
        const info = clearLimit(sid)
        return { limit: 0, cost: info.cost }
      }
      nudge.setLimit(limit)
      const total = sid ? cost(sid) : 0
      if (sid) check(sid)
      return { limit, cost: total }
    }

    function clearLimit(sid: string | undefined) {
      nudge.setLimit(undefined)
      return { cost: sid ? cost(sid) : 0 }
    }

    function formatCost(value: number) {
      return MaxCostNudge.formatCost(value)
    }

    return {
      setLimit,
      clearLimit,
      formatCost,
    }
  },
})
