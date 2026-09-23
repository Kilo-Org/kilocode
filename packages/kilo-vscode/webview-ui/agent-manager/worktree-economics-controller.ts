import { createEffect, createSignal, type Accessor } from "solid-js"
import type { KilocodeWorktreeUsageSummary } from "@kilocode/sdk/v2/client"
import type {
  AgentManagerWorktreeUsageMessage,
  AgentManagerWorktreeUsageSummaryEntry,
  ExtensionMessage,
  WebviewMessage,
  WorktreeState,
} from "../src/types/messages"
import { LOCAL } from "./navigate"
import { SidePanel } from "./side-panel-layout"

type UsageDetail = Pick<AgentManagerWorktreeUsageMessage, "detail" | "timeline" | "error"> & { loading?: boolean }

type Params = {
  project: Accessor<string | undefined>
  selection: Accessor<string | null>
  loaded: Accessor<boolean>
  worktrees: Accessor<WorktreeState[]>
  panel: Accessor<SidePanel | null | undefined>
  post: (message: WebviewMessage) => void
  closeHistory: () => void
  setReviewActive: (active: boolean) => void
  togglePanel: (panel: SidePanel) => void
}

const key = (id?: string) => id ?? "single"

export function createWorktreeEconomics(params: Params) {
  const [summaries, setSummaries] = createSignal<Record<string, Record<string, KilocodeWorktreeUsageSummary>>>({})
  const [details, setDetails] = createSignal<Record<string, Record<string, UsageDetail>>>({})
  let last = ""
  let armed = ""

  const activeSummaries = () => summaries()[key(params.project())] ?? {}
  const selected = () => {
    const id = params.selection()
    return id && id !== LOCAL ? details()[key(params.project())]?.[id] : undefined
  }
  const worktree = () => {
    const id = params.selection()
    if (!id || id === LOCAL) return undefined
    return params.worktrees().find((item) => item.id === id)
  }
  const open = () => params.panel() === SidePanel.Economics
  const cost = () => {
    const id = params.selection()
    return id && id !== LOCAL ? activeSummaries()[id]?.totals.cost : undefined
  }
  const available = () => {
    const id = params.selection()
    return typeof id === "string" && id !== LOCAL
  }

  const toggle = () => {
    params.closeHistory()
    params.setReviewActive(false)
    params.togglePanel(SidePanel.Economics)
  }

  const requestSummaries = () =>
    params.post({ type: "agentManager.requestWorktreeUsageSummaries", projectId: params.project() })

  const request = (worktreeId: string) => {
    const pid = key(params.project())
    setDetails((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? {}), [worktreeId]: { ...(prev[pid]?.[worktreeId] ?? {}), loading: true } },
    }))
    params.post({ type: "agentManager.requestWorktreeUsage", projectId: params.project(), worktreeId })
  }

  const handle = (msg: ExtensionMessage) => {
    if (msg.type === "agentManager.worktreeUsageSummaries") {
      const pid = key(msg.projectId)
      setSummaries((prev) => ({
        ...prev,
        [pid]: Object.fromEntries(
          msg.summaries.map((entry: AgentManagerWorktreeUsageSummaryEntry) => [entry.worktreeId, entry.summary]),
        ),
      }))
      return true
    }
    if (msg.type === "agentManager.worktreeUsage") {
      const pid = key(msg.projectId)
      setDetails((prev) => ({
        ...prev,
        [pid]: {
          ...(prev[pid] ?? {}),
          [msg.worktreeId]: { detail: msg.detail, timeline: msg.timeline, error: msg.error, loading: false },
        },
      }))
      return true
    }
    return false
  }

  createEffect(() => {
    if (!params.loaded()) return
    const signature = JSON.stringify([
      key(params.project()),
      params
        .worktrees()
        .map((wt) => wt.id)
        .sort(),
    ])
    if (signature === last) return
    last = signature
    requestSummaries()
  })

  // Fetches once per project/worktree pair while the panel is open, rather than reading
  // `details()` — reading it here would retrigger this effect on every response, since
  // `request()` writes `details()`, producing an unbounded fetch loop that constantly
  // replaced the rendered rows and made the hover-only info overlay and tooltips flicker.
  createEffect(() => {
    const id = params.selection()
    if (params.panel() !== SidePanel.Economics || !id || id === LOCAL) {
      armed = ""
      return
    }
    const token = `${key(params.project())}:${id}`
    if (armed === token) return
    armed = token
    request(id)
  })

  return {
    summaries: activeSummaries,
    selected,
    worktree,
    request,
    handle,
    toolbar: { economicsOpen: open, economicsAvailable: available, economicsCost: cost, onToggleEconomics: toggle },
  }
}
