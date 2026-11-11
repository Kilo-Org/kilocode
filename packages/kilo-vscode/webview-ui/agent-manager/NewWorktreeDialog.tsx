import { type Component, For, Show, createSignal, createEffect, createMemo, on, onMount, onCleanup } from "solid-js"
import type { AgentInfo, CommandInfo, ModelInfo, ProviderInfo } from "@opencode/client"
import type {
  AgentManagerBranchesMessage,
  AgentManagerImportResultMessage,
  AgentProjectSnapshot,
  BranchInfo,
  ModelAllocation,
} from "../src/types/messages/agent-manager"
import type { SessionSearchItem } from "../src/utils/prompt-mention-drop"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Icon } from "@kilocode/kilo-ui/icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { DeferredPopover } from "../src/components/shared/DeferredPopover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { ModelSelectorBase } from "../src/components/shared/ModelSelector"
import ModelDescription from "../src/components/shared/ModelDescription"
import { ModeSwitcherBase } from "../src/components/shared/ModeSwitcher"
import { ThinkingSelectorBase } from "../src/components/shared/ThinkingSelector"
import { PromptSelectors } from "../src/components/chat/PromptSelectors"
import { useLanguage } from "../src/context/language"
import { useModelPreferences } from "../src/context/model-preferences"
import { configuredModel, initialModel } from "../src/v2/model-default"
import { kiloTeam } from "../src/v2/kilo-models"
import { failureMessage } from "../src/v2/kilo-catalog"
import { useBridge } from "./v2/vscode"
import { convertToMentionPath, insertPathMentions } from "../src/utils/path-mentions"
import { isEnterKeyCommitNotIme } from "../src/utils/ime-enter"
import { BranchSelect, BranchSelectPopover } from "../src/components/shared/BranchSelect"
import { shiftTabCyclesVariant } from "../src/v2/kilo-settings"
import type { V2 } from "../src/v2/scope"
import { createDialogPreferences, DEFAULT_VARIANT, type ModelSelection } from "./new-worktree-models"
import { createDialogCommandMenu } from "./dialog-commands"
import { useImageAttachments, type ImageAttachment } from "../src/hooks/useImageAttachments"
import { useWorktreeMention, segmentMentionText, type MentionResult } from "./worktree-mention"
import type { ModeRouter } from "./mode-router"
import { WorktreeOrigin } from "./WorktreeOrigin"
import { validBranch } from "./new-worktree-branch"
import { sanitizeBranchName } from "../../src/shared/branch-slug"
import { submitPayload, shouldComposeGoal } from "./new-worktree-command"
import { MultiModelSelector } from "./MultiModelSelector"
import { type ModelAllocations, MAX_MULTI_VERSIONS, allocationsToArray, totalAllocations } from "./multi-model-utils"
import type { WorktreeReference } from "../src/utils/prompt-mention-drop"
import { cleanEnhancedPrompt, enhancePromptRequest, normalizeEnhancePromptErrorMessage } from "../src/v2/enhance-prompt"
import { message as errorMessage } from "../src/v2/scope"
import { createDefaultModel } from "../src/v2/selectors"
import { SpeechToTextButton } from "../src/components/speech-to-text/SpeechToTextButton"
import { createSpeechShortcut } from "../src/components/speech-to-text/shortcut"
import { useSpeechStatus } from "../src/components/speech-to-text/status"
import { useSpeechToText } from "../src/components/speech-to-text/useSpeechToText"
import { insertSpacedText } from "../src/v2/prompt-speech"

type VersionCount = 1 | 2 | 3 | 4
const VERSION_OPTIONS: VersionCount[] = [1, 2, 3, 4]
const WORKTREE_PROMPT_HIDDEN = ["init", "review", "resume-claude", "resume-codex"]
const WORKTREE_PROMPT_SCOPE = "agent-manager-worktree-prompt"
const WORKTREE_MENTION_MODEL_TRIGGER = "agent-manager-worktree-mention-model"

type DialogTab = "new" | "import"

type DialogSelections = {
  agent?: string
  model?: ModelSelection
  variant?: string
}

function readDialogSelections(value: unknown): DialogSelections {
  if (typeof value !== "object" || value === null) return {}
  const record = value as Record<string, unknown>
  const model = record.model
  return {
    agent: typeof record.agent === "string" ? record.agent : undefined,
    variant: typeof record.variant === "string" ? record.variant : undefined,
    model:
      typeof model === "object" &&
      model !== null &&
      typeof (model as ModelSelection).providerID === "string" &&
      typeof (model as ModelSelection).modelID === "string"
        ? { providerID: (model as ModelSelection).providerID, modelID: (model as ModelSelection).modelID }
        : undefined,
  }
}

function restoreAgent(value: string | undefined, list: AgentInfo[], base: string): string {
  if (value && list.some((item) => item.id === value)) return value
  return base
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function MentionRow(props: { item: MentionResult }) {
  const { t } = useLanguage()
  if (props.item.type === "session") {
    return (
      <>
        <Icon name="history" size="small" />
        <span class="file-mention-name">{props.item.session.title}</span>
        <Show when={props.item.session.worktreeName}>
          <span class="file-mention-dir">{props.item.session.worktreeName}</span>
        </Show>
      </>
    )
  }
  return (
    <>
      <Icon name={props.item.type === "worktrees" ? "branch" : "history"} size="small" />
      <span class="file-mention-name">
        {props.item.type === "worktrees" ? t("prompt.worktrees.title") : props.item.label}
      </span>
      <Show when={"description" in props.item}>
        <span class="file-mention-dir">{"description" in props.item ? props.item.description : ""}</span>
      </Show>
    </>
  )
}

const branchCache = new Map<string, { branches: BranchInfo[]; detected: string }>()
const BRANCH_CACHE_LIMIT = 4

function cacheBranches(id: string, branches: BranchInfo[], detected: string) {
  branchCache.delete(id)
  branchCache.set(id, { branches, detected })
  while (branchCache.size > BRANCH_CACHE_LIMIT) {
    const oldest = branchCache.keys().next().value
    if (oldest !== undefined) branchCache.delete(oldest)
  }
}

export const NewWorktreeDialog: Component<{
  onClose: () => void
  defaultBase?: (projectId: string) => string | undefined
  projectId?: string
  projects?: () => AgentProjectSnapshot[]
  activeProjectId?: string
  onCreate?: (projectId: string) => void
  worktrees?: () => WorktreeReference[]
  mode: ModeRouter
  /** Store of the project the dialog creates in; its directory holds the model, agent and command catalogs. */
  store: V2
  models: ModelInfo[]
  providers: ProviderInfo[]
  agents: AgentInfo[]
  commands: CommandInfo[]
  /** Sessions the panel already loaded, offered as past-chat mentions. */
  sessions: SessionSearchItem[]
}> = (props) => {
  const language = useLanguage()
  const { t } = language
  const vscode = useBridge()
  // Voice input works as in the sidebar composer: the same hook, status, shortcut and button.
  const speech = useSpeechToText(
    vscode.shared,
    { goToLogin: () => vscode.postMessage({ type: "openProfile" }) },
    language,
    showToast,
  )
  const speechStatus = useSpeechStatus()
  const canUseSpeech = () => speechStatus.status().enabled

  const [tab, setTab] = createSignal<DialogTab>("new")
  const [project, setProject] = createSignal(props.projectId ?? props.activeProjectId)
  const [projectOpen, setProjectOpen] = createSignal(false)
  const projects = () => props.projects?.() ?? []
  const showProject = () => projects().length > 0
  const base = () => {
    const id = project()
    return id ? props.defaultBase?.(id) : undefined
  }

  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [branchesLoading, setBranchesLoading] = createSignal(false)
  const [detected, setDetected] = createSignal("main")
  const defaultBranch = () => base() ?? detected()
  const [branchSearch, setBranchSearch] = createSignal("")

  const [name, setName] = createSignal("")
  const cached = vscode.getState<Record<string, unknown>>()
  const [prompt, setPrompt] = createSignal((cached?.advancedDialogPrompt as string) ?? "")
  const saved = readDialogSelections(cached?.advancedDialogSelections)
  const [versions, setVersions] = createSignal<VersionCount>(1)
  const [compareMode, setCompareMode] = createSignal(false)
  const initialAgent = restoreAgent(saved.agent, props.agents, props.agents[0]?.id ?? "")
  const serverDefault = createDefaultModel(props.store)
  const modelPreferences = useModelPreferences()
  void Promise.all([props.store.data.location.model.sync(), props.store.data.location.config.sync()]).catch(
    () => undefined,
  )
  // Shares the composer's precedence: pick for this agent, agent model, configured model, most recent pick, then the
  // team or Kilo Auto Free fallback. The server default stands in while the account is unknown, and a known account
  // waits for the preferences before falling back.
  const defaultFor = (agent: string) =>
    initialModel({
      pick: modelPreferences?.pick(agent),
      agent: props.agents.find((item) => item.id === agent)?.model ?? undefined,
      configured: configuredModel(props.store.data.location.config.list()),
      team: kiloTeam(props.store.kiloModels()),
      loaded: modelPreferences?.loaded() ?? true,
      recents: modelPreferences?.recents() ?? [],
      models: props.models,
      serverDefault: serverDefault(),
      valid: (ref) =>
        props.models.some((item) => item.enabled && item.providerID === ref.providerID && item.id === ref.id),
    })
  // v1 waited for the provider catalog before it chose: until the account and the recents are known, no Kilo choice
  // is trusted and no fallback is shown.
  const ready = () => kiloTeam(props.store.kiloModels()) !== undefined
  const preferences = createDialogPreferences({
    saved,
    agent: initialAgent,
    fallback: (agent) => {
      const model = defaultFor(agent)
      return model ? { providerID: model.providerID, modelID: model.id } : null
    },
    // The effort of the chosen default (agent or configured), else the effort the agent last chose for this model,
    // as the sidebar. createDialogPreferences moves it to the nearest effort the model has.
    effort: (agent, model) => {
      if (!model) return undefined
      const chosen = defaultFor(agent)
      if (chosen?.variant && chosen.providerID === model.providerID && chosen.id === model.modelID)
        return chosen.variant
      return modelPreferences?.variant(agent, model.providerID, model.modelID) || undefined
    },
    ready,
    valid: (value) =>
      props.models.some(
        (model) => model.enabled && model.providerID === value.providerID && model.id === value.modelID,
      ),
    variants: (value) =>
      props.models
        .find((model) => model.providerID === value.providerID && model.id === value.modelID)
        ?.variants.map((variant) => variant.id) ?? [],
    // Every pick here is remembered for the next dialog and composer of that agent, and pushed to the shared recents.
    // An effort change only remembers the effort, so it cannot rewrite the recents with a model the user never picked.
    rememberPick: (agent, model, variant) => {
      modelPreferences?.rememberPick(agent, model.providerID, model.modelID)
      modelPreferences?.rememberVariant(agent, model.providerID, model.modelID, variant)
    },
    rememberEffort: (agent, model, variant) => {
      modelPreferences?.rememberVariant(agent, model.providerID, model.modelID, variant)
    },
  })
  const { selection, model, agent, variants, effectiveVariant, selectAgent, selectModel, selectVariant } = preferences
  const [modelAllocations, setModelAllocations] = createSignal<ModelAllocations>(new Map())
  const [starting, setStarting] = createSignal(false)
  const [enhancing, setEnhancing] = createSignal(false)
  const [branchName, setBranchName] = createSignal("")
  const [baseBranch, setBaseBranch] = createSignal<string | null>(null)
  const [compareOpen, setCompareOpen] = createSignal(false)
  let prior: string | null = null
  let request: string | undefined

  const finishEnhance = () => {
    prior = null
    request = undefined
    setEnhancing(false)
  }

  const cycle = (direction: 1 | -1) => {
    const list = props.agents
    if (list.length <= 1) return
    const index = list.findIndex((item) => item.id === agent())
    const raw = index + direction
    const next = raw < 0 ? list.length - 1 : raw >= list.length ? 0 : raw
    const value = list[next]?.id
    if (value) selectAgent(value)
  }

  createEffect(() => {
    if (tab() !== "new") return
    const dispose = props.mode.register(cycle)
    onCleanup(dispose)
  })

  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
    const resolved = paths.map((path) => convertToMentionPath(path, props.store.directory))
    const ref = textareaRef
    if (!ref) return
    const result = insertPathMentions(ref.value, ref.selectionStart ?? ref.value.length, resolved)
    ref.value = result.text
    finishEnhance()
    setPrompt(result.text)
    persistPrompt(result.text)
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
    adjustHeight()
  })

  const cachedImages = cached?.advancedDialogImages as ImageAttachment[] | undefined
  if (cachedImages?.length) imageAttach.replace(cachedImages)

  const persistPrompt = (value: string) => {
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({ ...state, advancedDialogPrompt: value || undefined })
  }

  const persistImages = (imgs: ImageAttachment[]) => {
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({ ...state, advancedDialogImages: imgs.length > 0 ? imgs : undefined })
  }

  const drafts = () =>
    (vscode.getState<Record<string, unknown>>()?.advancedDialogBase as Record<string, string> | undefined) ?? {}

  const persistBase = (id: string | undefined, value: string | null) => {
    if (!id) return
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    const next = { ...drafts() }
    if (value) next[id] = value
    if (!value) delete next[id]
    vscode.setState({ ...state, advancedDialogBase: Object.keys(next).length > 0 ? next : undefined })
  }

  const pickBase = (value: string | null) => {
    const next = value === defaultBranch() ? null : value
    setBaseBranch(next)
    persistBase(project(), next)
  }

  createEffect(() => {
    const state = vscode.getState<Record<string, unknown>>() ?? {}
    vscode.setState({
      ...state,
      advancedDialogSelections: preferences.saved(),
    })
  })

  createEffect(() => persistImages(imageAttach.images()))

  let textareaRef: HTMLTextAreaElement | undefined
  let containerRef: HTMLDivElement | undefined

  const setPromptValue = (value: string) => {
    setPrompt(value)
    persistPrompt(value)
    adjustHeight()
  }
  const restorePrompt = () => {
    requestAnimationFrame(() => textareaRef?.focus({ preventScroll: true }))
  }

  const commandList = createMemo(() =>
    props.commands.map((command) => ({
      name: command.name,
      description: command.description,
      source: "command",
    })),
  )
  const slash = createDialogCommandMenu({
    commands: commandList,
    hidden: () => {
      const hidden = new Set<string>(WORKTREE_PROMPT_HIDDEN)
      if (props.agents.length < 2) hidden.add("agents")
      if (variants().length === 0) hidden.add("variant")
      if (!showProject()) hidden.add("project")
      return hidden
    },
    extra: [
      {
        name: "models",
        description: "Switch the AI model",
        action: () =>
          window.dispatchEvent(new CustomEvent("openModelPicker", { detail: { source: WORKTREE_PROMPT_SCOPE } })),
      },
      {
        name: "agents",
        description: "Switch the agent mode",
        action: () =>
          window.dispatchEvent(new CustomEvent("openModePicker", { detail: { source: WORKTREE_PROMPT_SCOPE } })),
      },
      {
        name: "variant",
        description: "Switch the reasoning effort",
        action: () =>
          window.dispatchEvent(new CustomEvent("openVariantPicker", { detail: { source: WORKTREE_PROMPT_SCOPE } })),
      },
      { name: "project", description: t("agentManager.dialog.project.select"), action: () => setProjectOpen(true) },
    ],
  })

  const onFocusPrompt = () => restorePrompt()
  window.addEventListener("focusPrompt", onFocusPrompt)
  onCleanup(() => window.removeEventListener("focusPrompt", onFocusPrompt))

  const mention = useWorktreeMention(
    () => props.worktrees?.() ?? [],
    () => props.sessions,
  )
  let highlightRef: HTMLDivElement | undefined
  const mentionSegments = createMemo(() => segmentMentionText(prompt(), mention.highlightTokens()))
  const syncHighlight = () => {
    if (!highlightRef || !textareaRef) return
    highlightRef.scrollTop = textareaRef.scrollTop
    highlightRef.scrollLeft = textareaRef.scrollLeft
  }
  onMount(() => {
    if (prompt()) adjustHeight()
    const focus = () => {
      textareaRef?.focus({ preventScroll: true })
      const end = textareaRef?.value.length ?? 0
      textareaRef?.setSelectionRange(end, end)
    }
    requestAnimationFrame(() => {
      focus()
      requestAnimationFrame(focus)
      setTimeout(focus, 0)
      setTimeout(focus, 50)
    })
  })

  createEffect(
    on(project, (id) => {
      const hit = id ? branchCache.get(id) : undefined
      setBranches(hit?.branches ?? [])
      setDetected(hit?.detected ?? "main")
      setBranchesLoading(!hit)
      setBranchSearch("")
      setBaseBranch(id ? (drafts()[id] ?? null) : null)
      vscode.postMessage({ type: "agentManager.requestBranches", projectId: id })
    }),
  )

  createEffect(
    on(defaultBranch, (value) => {
      if (!base() && branchesLoading()) return
      if (baseBranch() === value) pickBase(null)
    }),
  )

  const effectiveBaseBranch = () => baseBranch() ?? defaultBranch()
  const customBase = () => effectiveBaseBranch() !== defaultBranch()

  const filteredBranches = createMemo(() => {
    const search = branchSearch().toLowerCase()
    if (!search) return branches()
    return branches().filter((b) => b.name.toLowerCase().includes(search))
  })

  const canSubmit = () => {
    if (starting()) return false
    if (speech.active()) return false
    return selection.canSubmit(compareMode() ? modelAllocations() : undefined)
  }
  const total = () => (compareMode() ? totalAllocations(modelAllocations()) : versions())
  const submissionMode = () => (compareMode() ? "compare_models" : versions() > 1 ? "multiple_versions" : "single")

  const resolveFiles = (text: string | undefined) => {
    const mentionFiles = text ? mention.parseAttachments(text) : []
    const imgFiles = imageAttach.images().map((img) => ({ mime: img.mime, url: img.dataUrl }))
    const files = [...mentionFiles, ...imgFiles]
    return files.length > 0 ? files : undefined
  }

  const handleSubmit = () => {
    if (!canSubmit()) return
    const customBranch = branchName().trim() || undefined
    if (!validBranch(customBranch)) {
      showToast({
        variant: "error",
        title: t("agentManager.dialog.branchName"),
        description: t("agentManager.dialog.invalidBranch"),
      })
      return
    }
    setStarting(true)

    const payload = submitPayload(false, prompt().trim(), slash.commands())
    const defaultAgent = props.agents[0]?.id
    const selectedAgent = agent() !== defaultAgent ? agent() : undefined
    const isCompare = compareMode()
    const allocations = isCompare ? allocationsToArray(modelAllocations()) : undefined
    const sel = isCompare ? null : model()
    const target = project()
    if (target) props.onCreate?.(target)

    vscode.postMessage({
      type: "agentManager.createMultiVersion",
      projectId: target,
      text: payload.text,
      command: payload.command,
      arguments: payload.arguments,
      name: name().trim() || undefined,
      versions: total(),
      providerID: sel?.providerID,
      modelID: sel?.modelID,
      agent: selectedAgent,
      variant: isCompare ? undefined : (effectiveVariant() ?? (variants().length > 0 ? DEFAULT_VARIANT : undefined)),
      baseBranch: effectiveBaseBranch(),
      branchName: customBranch,
      modelAllocations: allocations,
      files: resolveFiles(payload.text),
    })

    preferences.clear()
    persistPrompt("")
    persistImages([])
    persistBase(target, null)
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const undo = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const z = e.keyCode === 90 || e.key.toLowerCase() === "z"
    if (!z) return
    if (e.shiftKey || prior === null) return
    e.preventDefault()
    const restored = prior
    finishEnhance()
    setPrompt(restored)
    persistPrompt(restored)
    if (!textareaRef) return
    textareaRef.value = restored
    adjustHeight()
    textareaRef.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    if (speechDown(e)) return
    if (slash.onKeyDown(e, textareaRef, setPromptValue, restorePrompt)) {
      e.stopPropagation()
      return
    }
    if (mention.onKeyDown(e, textareaRef, setPromptValue, restorePrompt)) {
      e.stopPropagation()
      return
    }
    if (isEnterKeyCommitNotIme(e) && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (shouldComposeGoal(false, prompt())) {
        e.preventDefault()
        e.stopPropagation()
        handleSubmit()
        return
      }
    }
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!shiftTabCyclesVariant()) return
      const list = variants()
      if (list.length === 0) return
      e.preventDefault()
      const idx = effectiveVariant() ? list.indexOf(effectiveVariant()!) : -1
      selectVariant(idx === list.length - 1 ? undefined : list[idx + 1])
      return
    }
    undo(e)
  }

  const adjustHeight = () => {
    const box = containerRef
    const area = textareaRef
    if (!box || !area) return
    box.style.height = "auto"
    const chrome = box.offsetHeight - area.offsetHeight
    box.style.height = `${Math.min(area.scrollHeight, 200) + chrome}px`
    syncHighlight()
  }

  const insertSpeechText = (value: string) => {
    const ref = textareaRef
    const current = prompt()
    const start = ref?.selectionStart ?? current.length
    const end = ref?.selectionEnd ?? start
    const result = insertSpacedText(current, value, start, end)
    finishEnhance()
    setPrompt(result.text)
    persistPrompt(result.text)
    if (!ref) return
    ref.value = result.text
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
    adjustHeight()
  }
  const startSpeech = () => speech.start({ model: speechStatus.status().model, insert: insertSpeechText })
  const shortcut = createSpeechShortcut({
    speech,
    disabled: () => !canUseSpeech() || starting(),
    start: startSpeech,
    finish: (submit) => speech.stop(submit ? { done: handleSubmit } : undefined),
  })
  const speechDown = (e: KeyboardEvent) => {
    if (!shortcut.down(e)) return false
    e.preventDefault()
    e.stopPropagation()
    return true
  }
  const speechUp = (e: KeyboardEvent) => {
    if (!shortcut.up(e)) return
    e.preventDefault()
    e.stopPropagation()
  }
  onCleanup(shortcut.reset)

  const canEnhance = () =>
    !starting() && !enhancing() && !speech.active() && props.store.connection.status() === "connected"

  const handleEnhance = () => {
    if (!canEnhance()) return
    const draft = prompt().trim()
    if (!draft) {
      const description = t("prompt.action.enhanceDescription")
      setPrompt(description)
      persistPrompt(description)
      if (textareaRef) {
        textareaRef.value = description
        adjustHeight()
        textareaRef.focus()
      }
      return
    }
    const current = model()
    if (!current) return
    prior = prompt()
    setEnhancing(true)
    request = crypto.randomUUID()
    const token = request
    props.store.api.generate
      .text({ prompt: enhancePromptRequest(draft), model: { id: current.modelID, providerID: current.providerID } })
      .then((response) => {
        if (request !== token) return
        request = undefined
        setPrompt(cleanEnhancedPrompt(response.text))
        persistPrompt(cleanEnhancedPrompt(response.text))
        if (textareaRef) {
          textareaRef.value = cleanEnhancedPrompt(response.text)
          adjustHeight()
          textareaRef.focus()
        }
      })
      .catch((error: unknown) => {
        if (request !== token) return
        finishEnhance()
        showToast({
          variant: "error",
          title: t("prompt.action.enhance"),
          description: normalizeEnhancePromptErrorMessage(errorMessage(error)),
        })
      })
      .finally(() => {
        if (request === token) setEnhancing(false)
      })
  }

  const [prUrl, setPrUrl] = createSignal("")
  const [prPending, setPrPending] = createSignal(false)
  const [branchOpen, setBranchOpen] = createSignal(false)
  const [importPending, setImportPending] = createSignal(false)
  const isPending = () => prPending() || importPending()

  const importUnsub = vscode.onMessage((msg) => {
    if (msg.type === "agentManager.branches") {
      const ev = msg as AgentManagerBranchesMessage
      if (ev.projectId !== project()) return
      if (ev.projectId) cacheBranches(ev.projectId, ev.branches, ev.defaultBranch)
      setBranches(ev.branches)
      setDetected(ev.defaultBranch)
      setBranchesLoading(false)
      const pick = baseBranch()
      if (pick && ev.branches.length > 0 && !ev.branches.some((b) => b.name === pick)) pickBase(null)
    }
    if (msg.type === "agentManager.importResult") {
      const ev = msg as AgentManagerImportResultMessage
      if (ev.projectId !== project()) return
      setPrPending(false)
      setImportPending(false)
      if (ev.success) props.onClose()
      else {
        const description = ev.errorCode ? t(`agentManager.setup.error.${ev.errorCode}`) : ev.message
        showToast({ variant: "error", title: t("agentManager.import.failed"), description })
      }
    }
  })

  onCleanup(() => {
    request = undefined
    importUnsub()
  })

  const handlePRSubmit = () => {
    const url = prUrl().trim()
    if (!url || isPending()) return
    setPrPending(true)
    const target = project()
    if (target) props.onCreate?.(target)
    vscode.postMessage({ type: "agentManager.importFromPR", projectId: target, url })
  }

  const handleBranchSelect = (name: string) => {
    if (isPending()) return
    setImportPending(true)
    setBranchOpen(false)
    setBranchSearch("")
    const target = project()
    if (target) props.onCreate?.(target)
    vscode.postMessage({ type: "agentManager.importFromBranch", projectId: target, branch: name })
  }

  const Origin = (local: { branch: boolean }) => (
    <WorktreeOrigin
      projects={projects()}
      project={project()}
      onProject={setProject}
      projectOpen={projectOpen()}
      onProjectOpen={setProjectOpen}
      branch={local.branch}
      branches={branches()}
      loading={branchesLoading()}
      base={effectiveBaseBranch()}
      fallback={defaultBranch()}
      onBase={pickBase}
      onDefault={(value) =>
        vscode.postMessage({ type: "agentManager.setDefaultBaseBranch", projectId: project(), branch: value })
      }
      disabled={starting() || isPending()}
    />
  )

  const renderMention = () => (
    <Show when={mention.showMention()}>
      <div class="file-mention-dropdown am-mention-dropdown" data-component="popover-content">
        <Show
          when={!mention.sessionPicker()}
          fallback={
            <div class="file-mention-list">
              <For each={mention.sessionCandidates()}>
                {(session) => (
                  <div
                    class="file-mention-item"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (textareaRef) mention.selectSession(session, textareaRef, setPromptValue, restorePrompt)
                    }}
                  >
                    <Icon name="history" size="small" />
                    <span class="file-mention-name">{session.title}</span>
                  </div>
                )}
              </For>
            </div>
          }
        >
          <Show
            when={!mention.worktreePicker()}
            fallback={
              <div class="file-mention-list">
                <For each={mention.worktreeCandidates()}>
                  {(worktree) => (
                    <div
                      class="file-mention-item"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (textareaRef) mention.selectWorktree(worktree, textareaRef, setPromptValue, restorePrompt)
                      }}
                    >
                      <Icon name="branch" size="small" />
                      <span class="file-mention-name">{worktree.name}</span>
                      <span class="file-mention-dir">{worktree.branch}</span>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <Show
              when={mention.mentionResults().length > 0}
              fallback={<div class="file-mention-empty">No mentions found</div>}
            >
              <For each={mention.mentionResults()}>
                {(item, index) => (
                  <div
                    class="file-mention-item"
                    data-type={item.type}
                    classList={{ "file-mention-item--active": index() === mention.mentionIndex() }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (textareaRef) mention.selectMention(item, textareaRef, setPromptValue, restorePrompt)
                    }}
                    onMouseEnter={() => mention.setMentionIndex(index())}
                  >
                    <MentionRow item={item} />
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </Show>
      </div>
    </Show>
  )

  return (
    <Dialog
      title={t("agentManager.dialog.openWorktree")}
      fit
      transition
      action={
        <div class="am-nv-header">
          <div class="am-nv-mode" role="tablist" data-tab={tab()}>
            <button
              class="am-nv-mode-tab"
              classList={{ "am-nv-mode-tab-active": tab() === "new" }}
              role="tab"
              aria-selected={tab() === "new"}
              onClick={() => setTab("new")}
              type="button"
            >
              {t("agentManager.dialog.tab.new")}
            </button>
            <button
              class="am-nv-mode-tab"
              classList={{ "am-nv-mode-tab-active": tab() === "import" }}
              role="tab"
              aria-selected={tab() === "import"}
              onClick={() => setTab("import")}
              type="button"
            >
              {t("agentManager.dialog.tab.import")}
            </button>
          </div>
          <IconButton
            class="am-nv-close"
            icon="close"
            variant="ghost"
            aria-label={t("common.close")}
            onClick={() => props.onClose()}
          />
        </div>
      }
    >
      <Show when={tab() === "new"}>
        <div class="am-nv-dialog" onKeyDown={handleKeyDown}>
          <div class="am-nv-dialog-content">
            <div class="am-nv-start">
              <Origin branch />
              <div class="am-nv-name-row">
                <input
                  class="am-nv-name-input"
                  placeholder={t("agentManager.dialog.namePlaceholder")}
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                <label class="am-nv-branch-field" title={t("agentManager.dialog.branchNameHint")}>
                  <Icon name="branch" size="small" />
                  <input
                    class="am-nv-branch-input"
                    type="text"
                    spellcheck={false}
                    aria-label={t("agentManager.dialog.branchName")}
                    placeholder={sanitizeBranchName(name()) || t("agentManager.dialog.branchNamePlaceholder")}
                    value={branchName()}
                    onInput={(e) => setBranchName(e.currentTarget.value)}
                  />
                </label>
              </div>
            </div>
            <div
              ref={containerRef}
              class="prompt-input-container am-prompt-input-container"
              classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
              onDragOver={imageAttach.handleDragOver}
              onDragLeave={imageAttach.handleDragLeave}
              onDrop={imageAttach.handleDrop}
            >
              {renderMention()}
              <Show when={slash.show()}>
                <div class="slash-command-dropdown am-slash-command-dropdown" data-component="popover-content">
                  <Show
                    when={slash.results().length > 0}
                    fallback={<div class="slash-command-empty">No commands found</div>}
                  >
                    <For each={slash.results()}>
                      {(cmd, index) => (
                        <div
                          class="slash-command-item"
                          classList={{ "slash-command-item--active": index() === slash.index() }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            if (textareaRef) slash.select(cmd, textareaRef, setPromptValue, restorePrompt)
                          }}
                          onMouseEnter={() => slash.setIndex(index())}
                        >
                          <span class="slash-command-name">/{cmd.name}</span>
                          <Show when={cmd.description}>
                            <span class="slash-command-desc">{cmd.description}</span>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={imageAttach.images().length > 0}>
                <div class="image-attachments">
                  <For each={imageAttach.images()}>
                    {(img) => (
                      <div class="image-attachment">
                        <img src={img.dataUrl} alt={img.filename} title={img.filename} />
                        <button
                          type="button"
                          class="image-attachment-remove"
                          onClick={() => imageAttach.remove(img.id)}
                          aria-label={t("agentManager.dialog.removeImage")}
                        >
                          x
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="prompt-input-wrapper am-prompt-input-wrapper">
                <div class="prompt-input-ghost-wrapper am-prompt-input-ghost-wrapper">
                  <div class="prompt-input-highlight-overlay" ref={highlightRef} aria-hidden="true" dir="auto">
                    <For each={mentionSegments()}>
                      {(seg) => (
                        <Show when={seg.mention} fallback={<span>{seg.text}</span>}>
                          <span class="prompt-input-file-mention">{seg.text}</span>
                        </Show>
                      )}
                    </For>
                    <Show when={prompt().endsWith("\n")}>
                      <br />
                    </Show>
                  </div>
                  <textarea
                    ref={textareaRef}
                    class="prompt-input am-prompt-input"
                    placeholder={t(
                      isMac
                        ? "agentManager.dialog.promptPlaceholder.mac"
                        : "agentManager.dialog.promptPlaceholder.other",
                    )}
                    value={prompt()}
                    onInput={(e) => {
                      const val = e.currentTarget.value
                      finishEnhance()
                      setPrompt(val)
                      persistPrompt(val)
                      adjustHeight()
                      slash.onInput(val, e.currentTarget.selectionStart ?? val.length)
                      mention.onInput(val, e.currentTarget.selectionStart ?? val.length)
                    }}
                    onKeyDown={onKey}
                    onKeyUp={speechUp}
                    onPaste={(e) => imageAttach.handlePaste(e)}
                    onScroll={syncHighlight}
                    rows={3}
                    dir="auto"
                  />
                </div>
              </div>
              <div class="prompt-input-hint">
                <PromptSelectors
                  agent={
                    <Show when={props.agents.length > 1}>
                      <ModeSwitcherBase
                        agents={props.agents}
                        value={agent()}
                        onSelect={selectAgent}
                        trigger={WORKTREE_PROMPT_SCOPE}
                        portal={false}
                        deferDismiss
                      />
                    </Show>
                  }
                  model={
                    <Show when={!compareMode()}>
                      <ModelSelectorBase
                        models={props.models}
                        providers={props.providers}
                        gateway={props.store.kiloModels().entries}
                        value={model()}
                        descriptionRenderer={ModelDescription}
                        // The same reason the sidebar composer shows when the Kilo catalog leaves no usable model.
                        failure={failureMessage(t, props.store.kiloFailure())}
                        onSelect={selectModel}
                        onPick={restorePrompt}
                        onCancel={restorePrompt}
                        trigger={WORKTREE_PROMPT_SCOPE}
                        placement="top-start"
                        portal={false}
                        deferDismiss
                      />
                    </Show>
                  }
                  variant={
                    <Show when={!compareMode()}>
                      <ThinkingSelectorBase
                        variants={variants()}
                        value={effectiveVariant()}
                        onSelect={selectVariant}
                        onClear={() => selectVariant(DEFAULT_VARIANT)}
                        allowClear
                        clearLabel={t("common.default")}
                        heading={t("prompt.thinking.tooltip")}
                        trigger={WORKTREE_PROMPT_SCOPE}
                        portal={false}
                        deferDismiss
                        cycleHint={shiftTabCyclesVariant()}
                      />
                    </Show>
                  }
                />
                <div class="prompt-input-hint-actions">
                  <Tooltip value={t("prompt.action.enhance")} placement="top">
                    <IconButton
                      icon="wand-sparkles"
                      variant="ghost"
                      size="small"
                      onClick={handleEnhance}
                      disabled={!canEnhance()}
                      loading={enhancing()}
                      aria-label={t("prompt.action.enhance")}
                    />
                  </Tooltip>
                  <Show when={canUseSpeech()}>
                    <SpeechToTextButton speech={speech} disabled={starting()} start={startSpeech} label={t} />
                  </Show>
                </div>
              </div>
            </div>
          </div>
          <div class="am-nv-dialog-footer">
            <Show
              when={compareMode()}
              fallback={
                <div class="am-nv-version-bar">
                  <span class="am-nv-config-label">{t("agentManager.dialog.versions")}</span>
                  <div
                    class="am-nv-pills"
                    title={versions() > 1 ? t("agentManager.dialog.versionHint", { count: versions() }) : undefined}
                  >
                    {VERSION_OPTIONS.map((count) => (
                      <button
                        class="am-nv-pill"
                        classList={{ "am-nv-pill-active": versions() === count }}
                        onClick={() => setVersions(count)}
                        type="button"
                      >
                        {count}
                      </button>
                    ))}
                    <Tooltip
                      value={t("agentManager.dialog.compareModels.tooltip")}
                      placement="top"
                      contentClass="am-tooltip-wrap"
                    >
                      <button class="am-nv-pill am-nv-pill-compare" onClick={() => setCompareMode(true)} type="button">
                        <Icon name="layers" size="small" />
                        <span class="am-nv-pill-compare-label">{t("agentManager.dialog.compareModels")}</span>
                      </button>
                    </Tooltip>
                  </div>
                </div>
              }
            >
              <div class="am-nv-compare-section">
                <div class="am-nv-version-bar">
                  <span class="am-nv-config-label">
                    {t("agentManager.dialog.compareModels")}
                    <Show when={totalAllocations(modelAllocations()) > 0}>
                      <span class="am-nv-compare-count">
                        {totalAllocations(modelAllocations())}/{MAX_MULTI_VERSIONS}
                      </span>
                    </Show>
                  </span>
                  <button
                    class="am-nv-pill-back"
                    onClick={() => {
                      setCompareMode(false)
                      setModelAllocations(new Map())
                    }}
                    type="button"
                    title={t("agentManager.dialog.versions")}
                  >
                    <Icon name="close-small" size="small" />
                  </button>
                </div>
                <DeferredPopover
                  open={compareOpen()}
                  onOpenChange={setCompareOpen}
                  placement="top-start"
                  flip={false}
                  sameWidth
                  portal={false}
                  deferDismiss
                  class="am-compare-popover"
                  trigger={
                    <button class="am-selector-trigger" type="button">
                      <span class="am-selector-left">
                        <Icon name="layers" size="small" />
                        <Show
                          when={modelAllocations().size > 0}
                          fallback={
                            <span class="am-selector-value am-selector-placeholder">
                              {t("agentManager.dialog.compareModels.selectModels")}
                            </span>
                          }
                        >
                          <span class="am-selector-value">
                            {[...modelAllocations().values()]
                              .map((entry) => (entry.variant ? `${entry.name} (${entry.variant})` : entry.name))
                              .join(", ")}
                          </span>
                        </Show>
                      </span>
                      <span class="am-selector-right">
                        <Icon name="selector" size="small" />
                      </span>
                    </button>
                  }
                >
                  <MultiModelSelector
                    allocations={modelAllocations()}
                    onChange={setModelAllocations}
                    models={props.models}
                    providers={props.providers}
                    gateway={props.store.kiloModels().entries}
                  />
                </DeferredPopover>
              </div>
            </Show>
            <Button variant="primary" size="large" class="am-nv-submit" onClick={handleSubmit} disabled={!canSubmit()}>
              <Show
                when={!starting()}
                fallback={
                  <>
                    <Spinner class="am-nv-spinner" />
                    <span>{t("agentManager.dialog.creating")}</span>
                  </>
                }
              >
                <span>{t("agentManager.dialog.createWorktree")}</span>
                <kbd class="am-nv-submit-kbd">{isMac ? "\u2318\u21b5" : "Ctrl+\u21b5"}</kbd>
              </Show>
            </Button>
          </div>
        </div>
      </Show>

      <Show when={tab() === "import"}>
        <div class="am-import-tab">
          <Show when={projects().length > 0}>
            <Origin branch={false} />
          </Show>
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.pullRequest")}</span>
            <div class="am-pr-row">
              <div class="am-pr-input-wrapper">
                <Icon name="branch" size="small" />
                <input
                  class="am-pr-input"
                  type="text"
                  placeholder={t("agentManager.import.pastePrUrl")}
                  value={prUrl()}
                  onInput={(e) => setPrUrl(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      handlePRSubmit()
                    }
                  }}
                  disabled={isPending()}
                />
              </div>
              <Button
                variant="secondary"
                size="small"
                onClick={handlePRSubmit}
                disabled={!prUrl().trim() || isPending()}
              >
                <Show when={prPending()} fallback={t("agentManager.import.open")}>
                  <Spinner class="am-nv-spinner" />
                </Show>
              </Button>
            </div>
          </div>
          <div class="am-import-divider" />
          <div class="am-import-section">
            <span class="am-nv-config-label">{t("agentManager.import.branches")}</span>
            <div class="am-selector-wrapper">
              <BranchSelectPopover
                open={branchOpen()}
                onOpenChange={setBranchOpen}
                trigger={
                  <button class="am-selector-trigger" disabled={isPending()} type="button">
                    <span class="am-selector-left">
                      <Icon name="branch" size="small" />
                      <span class="am-selector-value">
                        {branchesLoading() ? t("agentManager.import.loading") : t("agentManager.import.selectBranch")}
                      </span>
                    </span>
                    <span class="am-selector-right">
                      <Icon name="selector" size="small" />
                    </span>
                  </button>
                }
              >
                <BranchSelect
                  branches={filteredBranches().filter((b) => !b.isCheckedOut)}
                  loading={branchesLoading()}
                  search={branchSearch()}
                  onSearch={setBranchSearch}
                  onSelect={(b) => handleBranchSelect(b.name)}
                  searchPlaceholder={t("agentManager.dialog.searchBranches")}
                  loadingLabel={t("agentManager.import.loadingBranches")}
                  emptyLabel={t("agentManager.import.noMatchingBranches")}
                  defaultLabel={t("agentManager.dialog.branchBadge.default")}
                  remoteLabel={t("agentManager.dialog.branchBadge.remote")}
                />
              </BranchSelectPopover>
            </div>
          </div>
          <Show when={!branchesLoading() && branches().length === 0}>
            <div class="am-import-empty">
              {t("agentManager.import.noBranchesFound")}
              <br />
              {t("agentManager.import.noBranchesHint")}
            </div>
          </Show>
        </div>
      </Show>
    </Dialog>
  )
}
