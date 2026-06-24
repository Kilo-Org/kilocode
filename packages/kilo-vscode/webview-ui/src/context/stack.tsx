import {
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type ParentComponent,
} from "solid-js"
import { useVSCode } from "./vscode"
import type { ExtensionMessage } from "../types/messages"
import type {
  StackApplyFailure,
  StackApplyResult,
  StackDraft,
  StackLoadData,
  StackMcpMethod,
  StackParameter,
  StackParameterValue,
  StackPlan,
  StackResourceChoice,
} from "../types/stack"
import {
  catalogGapCount,
  catalogReady,
  cloneDraft,
  emptyDraft,
  flattenCategories,
  initialVertical,
  resourceEnabled,
  selectedTechnologyIDs,
  setResourceEnabled,
  setResourceMethod,
  setResourceParameter,
  setTechnology,
  validateDraft,
  type StackValidationIssue,
} from "./stack-state"

export type StackStep = "vertical" | "category" | "resources" | "review" | "result"
export type StackBusy = "load" | "preview" | "apply" | undefined

export interface StackFixture {
  project?: boolean
  data?: StackLoadData
  step?: StackStep
  category?: number
  plan?: StackPlan
  result?: StackApplyResult
  failure?: StackApplyFailure
  error?: string
  refreshError?: string
  stale?: boolean
  busy?: StackBusy
  issues?: StackValidationIssue[]
}

interface StackViewState {
  stackProjectDirectory?: string
}

interface StackContextValue {
  project: Accessor<boolean | undefined>
  data: Accessor<StackLoadData | undefined>
  draft: Accessor<StackDraft>
  step: Accessor<StackStep>
  busy: Accessor<StackBusy>
  editable: Accessor<boolean>
  error: Accessor<string | undefined>
  refreshError: Accessor<string | undefined>
  stale: Accessor<boolean>
  issues: Accessor<StackValidationIssue[]>
  plan: Accessor<StackPlan | undefined>
  result: Accessor<StackApplyResult | undefined>
  failure: Accessor<StackApplyFailure | undefined>
  verticalID: Accessor<string | undefined>
  categories: ReturnType<typeof createMemo<ReturnType<typeof flattenCategories>>>
  category: Accessor<number>
  selected: Accessor<string[]>
  ready: Accessor<boolean>
  gaps: Accessor<number>
  blocked: Accessor<boolean>
  chooseVertical: (id: string) => void
  goCategory: (index: number) => void
  toggleTechnology: (id: string, enabled: boolean) => void
  setResourceEnabled: (choice: StackResourceChoice, enabled: boolean) => void
  setResourceMethod: (choice: StackResourceChoice, method: StackMcpMethod) => void
  setResourceParameter: (
    choice: StackResourceChoice,
    parameter: StackParameter,
    value: StackParameterValue | undefined,
  ) => void
  resourceEnabled: (choice: StackResourceChoice) => boolean
  next: () => void
  back: () => void
  preview: () => void
  apply: () => void
  cancel: () => void
  reload: () => void
  openExternal: (url: string) => void
}

export const StackContext = createContext<StackContextValue>()

function initialDraft(data: StackLoadData | undefined): StackDraft {
  if (!data) return emptyDraft()
  return cloneDraft(data.state.draft)
}

function initialIssues(fixture: StackFixture | undefined): StackValidationIssue[] {
  return fixture?.issues ?? []
}

function initialFailure(fixture: StackFixture | undefined): StackApplyFailure | undefined {
  return fixture?.failure
}

function initialRefresh(fixture: StackFixture | undefined): string | undefined {
  return fixture?.refreshError
}

export const StackProvider: ParentComponent<{ fixture?: StackFixture }> = (props) => {
  const vscode = useVSCode()
  const fixture = props.fixture
  const initial = fixture?.data
  const base = initialDraft(initial)
  const first = initial ? initialVertical(initial.catalog, base) : undefined
  const [project, setProject] = createSignal<boolean | undefined>(fixture ? (fixture.project ?? !!initial) : undefined)
  const [data, setData] = createSignal<StackLoadData | undefined>(initial)
  const [draft, setDraft] = createSignal(base)
  const [step, setStep] = createSignal<StackStep>(fixture?.step ?? "vertical")
  const [busy, setBusy] = createSignal<StackBusy>(fixture ? fixture.busy : "load")
  const [error, setError] = createSignal<string | undefined>(fixture?.error)
  const [refreshError, setRefreshError] = createSignal<string | undefined>(initialRefresh(fixture))
  const [stale, setStale] = createSignal(fixture?.stale ?? false)
  const [issues, setIssues] = createSignal<StackValidationIssue[]>(initialIssues(fixture))
  const [plan, setPlan] = createSignal<StackPlan | undefined>(fixture?.plan)
  const [result, setResult] = createSignal<StackApplyResult | undefined>(fixture?.result)
  const [failure, setFailure] = createSignal<StackApplyFailure | undefined>(initialFailure(fixture))
  const [verticalID, setVerticalID] = createSignal<string | undefined>(first?.id)
  const [category, setCategory] = createSignal(fixture?.category ?? 0)

  const categories = createMemo(() => {
    const catalog = data()?.catalog
    if (!catalog) return []
    const vertical = catalog.catalog.verticals.find((candidate) => candidate.id === verticalID())
    return flattenCategories(vertical?.categories ?? [])
  })
  const selected = createMemo(() => selectedTechnologyIDs(draft()))
  const ready = createMemo(() => {
    const catalog = data()?.catalog
    return catalog ? catalogReady(catalog) : false
  })
  const gaps = createMemo(() => {
    const catalog = data()?.catalog
    return catalog ? catalogGapCount(catalog) : 0
  })
  const blocked = createMemo(() => {
    const review = plan()
    const conflicts = review ? review.conflicts : (data()?.state.conflicts ?? [])
    return (
      conflicts.length > 0 ||
      (review?.actions ?? []).some((action) => action.action === "blocked" || action.action === "missing")
    )
  })
  const editable = createMemo(() => busy() === undefined)

  const reset = () => {
    setPlan(undefined)
    setResult(undefined)
    setFailure(undefined)
    setError(undefined)
    setRefreshError(undefined)
    setStale(false)
    setIssues([])
  }

  const save = (directory: string) => {
    const state = vscode.getState<StackViewState>() ?? {}
    vscode.setState({ ...state, stackProjectDirectory: directory || undefined })
  }

  const hydrate = (next: StackLoadData) => {
    const loaded = cloneDraft(next.state.draft)
    setProject(true)
    setData(next)
    setDraft(loaded)
    setVerticalID(initialVertical(next.catalog, loaded)?.id)
  }

  if (!fixture) {
    const stored = vscode.getState<StackViewState>()?.stackProjectDirectory
    if (stored) vscode.postMessage({ type: "stackRestoreProject", directory: stored })
  }

  const lifecycle = (message: ExtensionMessage): boolean => {
    switch (message.type) {
      case "ready":
        if (message.workspaceDirectory !== undefined) save(message.workspaceDirectory)
        return true
      case "workspaceDirectoryChanged":
        save(message.directory)
        setProject(message.directory ? true : false)
        setData(undefined)
        setDraft(emptyDraft())
        setVerticalID(undefined)
        setCategory(0)
        setStep("vertical")
        setBusy(message.directory ? "load" : undefined)
        reset()
        return true
      case "connectionState":
        if (message.state === "error") {
          setBusy(undefined)
          setError(message.userMessage ?? message.error ?? "")
        }
        return true
      default:
        return false
    }
  }

  const receive = (message: ExtensionMessage) => {
    if (lifecycle(message)) return
    switch (message.type) {
      case "stackProjectRequired":
        setProject(false)
        setBusy(undefined)
        setData(undefined)
        setDraft(emptyDraft())
        setVerticalID(undefined)
        reset()
        return
      case "stackLoadResult":
        hydrate(message.data)
        setCategory(0)
        setStep("vertical")
        setBusy(undefined)
        reset()
        return
      case "stackPreviewResult":
        setPlan(message.plan)
        setDraft(cloneDraft(message.plan.draft))
        setStep("review")
        setBusy(undefined)
        setError(undefined)
        setRefreshError(undefined)
        setFailure(undefined)
        setStale(false)
        setIssues([])
        return
      case "stackApplyResult": {
        const current = data()
        const latest = message.data ?? (current ? { ...current, state: message.result.state } : undefined)
        if (latest) hydrate(latest)
        setResult(message.result)
        setFailure(undefined)
        setStep("result")
        setBusy(undefined)
        setError(undefined)
        setRefreshError(message.refreshError)
        setPlan(undefined)
        setStale(false)
        return
      }
      case "stackApplyFailure":
        if (message.data) hydrate(message.data)
        setResult(undefined)
        setFailure(message.failure)
        setStep("result")
        setBusy(undefined)
        setError(undefined)
        setRefreshError(message.refreshError)
        setPlan(undefined)
        setStale(false)
        return
      case "stackError":
        if (message.data) hydrate(message.data)
        setBusy(undefined)
        setError(message.message)
        setRefreshError(message.refreshError)
        if (message.stale) setStale(true)
        return
    }
  }

  const subscription = fixture ? undefined : vscode.onMessage(receive)
  onCleanup(() => subscription?.())

  const change = (next: StackDraft) => {
    if (!editable()) return
    setDraft(next)
    setPlan(undefined)
    setResult(undefined)
    setFailure(undefined)
    setError(undefined)
    setRefreshError(undefined)
    setStale(false)
    setIssues([])
  }

  const chooseVertical = (id: string) => {
    if (!editable()) return
    const vertical = data()?.catalog.catalog.verticals.find((candidate) => candidate.id === id)
    if (!vertical) return
    setVerticalID(id)
    setCategory(0)
    setDraft((current) => {
      if (current.verticals[id]) return current
      return { ...current, verticals: { ...current.verticals, [id]: { technologies: [] } } }
    })
  }

  const goCategory = (index: number) => {
    if (!editable() || index < 0 || index >= categories().length) return
    setCategory(index)
    setStep("category")
  }

  const toggleTechnology = (id: string, enabled: boolean) => {
    if (!editable()) return
    const catalog = data()?.catalog
    const vertical = verticalID()
    if (!catalog || !vertical) return
    change(setTechnology(catalog, draft(), vertical, id, enabled))
  }

  const enable = (choice: StackResourceChoice, enabled: boolean) => {
    if (!editable()) return
    change(setResourceEnabled(draft(), choice, enabled))
  }

  const method = (choice: StackResourceChoice, selected: StackMcpMethod) => {
    change(setResourceMethod(draft(), choice, selected))
  }

  const parameter = (
    choice: StackResourceChoice,
    definition: StackParameter,
    value: StackParameterValue | undefined,
  ) => {
    if (!editable()) return
    change(setResourceParameter(draft(), choice, definition, value))
  }

  const enabled = (choice: StackResourceChoice) => {
    const catalog = data()?.catalog
    return catalog ? resourceEnabled(catalog, draft(), choice.resource.ref) : false
  }

  const next = () => {
    if (!editable()) return
    if (step() === "vertical") {
      setStep(categories().length ? "category" : "resources")
      return
    }
    if (step() !== "category") return
    if (category() < categories().length - 1) {
      setCategory((index) => index + 1)
      return
    }
    setStep("resources")
  }

  const back = () => {
    if (!editable()) return
    if (step() === "category") {
      if (category() > 0) {
        setCategory((index) => index - 1)
        return
      }
      setStep("vertical")
      return
    }
    if (step() === "resources") {
      if (categories().length) {
        setCategory(categories().length - 1)
        setStep("category")
        return
      }
      setStep("vertical")
      return
    }
    if (step() !== "review") return
    setPlan(undefined)
    setStale(false)
    setStep("resources")
  }

  const preview = () => {
    const catalog = data()?.catalog
    if (!editable() || !catalog || !project()) return
    const found = validateDraft(catalog, draft())
    setIssues(found)
    if (found.length) return
    setBusy("preview")
    setError(undefined)
    setRefreshError(undefined)
    vscode.postMessage({ type: "stackPreview", draft: cloneDraft(draft()) })
  }

  const apply = () => {
    const review = plan()
    if (!editable() || !review || stale() || blocked() || !project()) return
    setBusy("apply")
    setError(undefined)
    setRefreshError(undefined)
    vscode.postMessage({ type: "stackApply", draft: cloneDraft(review.draft), planHash: review.plan_hash })
  }

  const cancel = () => {
    if (editable()) vscode.postMessage({ type: "stackCancel" })
  }
  const reload = () => {
    if (!editable()) return
    setBusy("load")
    setError(undefined)
    setRefreshError(undefined)
    vscode.postMessage({ type: "retryConnection" })
  }
  const openExternal = (url: string) => {
    if (editable()) vscode.postMessage({ type: "openExternal", url })
  }

  const value: StackContextValue = {
    project,
    data,
    draft,
    step,
    busy,
    editable,
    error,
    refreshError,
    stale,
    issues,
    plan,
    result,
    failure,
    verticalID,
    categories,
    category,
    selected,
    ready,
    gaps,
    blocked,
    chooseVertical,
    goCategory,
    toggleTechnology,
    setResourceEnabled: enable,
    setResourceMethod: method,
    setResourceParameter: parameter,
    resourceEnabled: enabled,
    next,
    back,
    preview,
    apply,
    cancel,
    reload,
    openExternal,
  }

  return <StackContext.Provider value={value}>{props.children}</StackContext.Provider>
}

export function useStack(): StackContextValue {
  const context = useContext(StackContext)
  if (!context) throw new Error("useStack must be used within StackProvider")
  return context
}
