// New Worktree dialog — prompt, versions, model, mode, import tab

/** @jsxImportSource solid-js */

import { type Component, For, Show, createSignal, createEffect, createMemo, onMount, onCleanup } from "solid-js"
import type {
  AgentManagerBranchesMessage,
  AgentManagerImportResultMessage,
  BranchInfo,
  EnhancePromptResultMessage,
  EnhancePromptErrorMessage,
} from "../src/types/messages"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Button } from "@kilocode/kilo-ui/button"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { DeferredPopover } from "../src/components/shared/DeferredPopover"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useVSCode } from "../src/context/vscode"
import { useServer } from "../src/context/server"
import { useSession } from "../src/context/session"
import { useProvider } from "../src/context/provider"
import { useConfig } from "../src/context/config"
import { cycleVariant } from "../src/context/session-variant-store"
import { ModelSelectorBase } from "../src/components/shared/ModelSelector"
import { ModeSwitcherBase } from "../src/components/shared/ModeSwitcher"
import { SpeechToTextButton } from "../src/components/speech-to-text/SpeechToTextButton"
import { canUseSpeechToText, selectedSpeechToTextModel } from "../src/components/speech-to-text/availability"
import { ThinkingSelectorBase } from "../src/components/shared/ThinkingSelector"
import { SandboxButtonBase, SandboxTooltipContent } from "../src/components/shared/SandboxButton"
import {
  MultiModelSelector,
  type ModelAllocations,
  MAX_MULTI_VERSIONS,
  totalAllocations,
  allocationsToArray,
} from "./MultiModelSelector"
import { useLanguage } from "../src/context/language"
import { useImageAttachments, type ImageAttachment } from "../src/hooks/useImageAttachments"
import { useSpeechToText } from "../src/components/speech-to-text/useSpeechToText"
import { convertToMentionPath } from "../src/utils/path-mentions"
import { insertSpacedText } from "../src/components/chat/prompt-input-utils"
import { WandSparkles } from "@kilocode/kilo-ui/lucide"
import { BranchSelect, BranchSelectPopover } from "../src/components/shared/BranchSelect"
import { tracker } from "./telemetry"

type VersionCount = 1 | 2 | 3 | 4
const VERSION_OPTIONS: VersionCount[] = [1, 2, 3, 4]

type DialogTab = "new" | "import"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

function sanitizeSegment(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._+@-]/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/@\{/g, "@")
    .replace(/-+/g, "-")
    .replace(/^[-.]|[-.]+$/g, "")
    .replace(/\.lock$/g, "")
    .slice(0, maxLength)
}

function sanitizeBranchName(name: string): string {
  return name
    .split("/")
    .map((s) => sanitizeSegment(s))
    .filter(Boolean)
    .join("/")
}

export const NewWorktreeDialog: Component<{ onClose: () => void; defaultBaseBranch?: string }> = (props) => {
  const { t } = useLanguage()
  const vscode = useVSCode()
  const server = useServer()
  const session = useSession()
  const provider = useProvider()
  const { config, globalConfig, features, settings } = useConfig()
  const metrics = tracker(vscode)
  const track = (button: string, properties?: Record<string, string | number | boolean | undefined>) =>
    metrics.track(button, "configure_worktree_dialog", properties)
  const click = metrics.click

  const [tab, setTab] = createSignal<DialogTab>("new")

  // --- Shared branch data (used by both New tab's base branch selector and Import tab) ---
  const [branches, setBranches] = createSignal<BranchInfo[]>([])
  const [branchesLoading, setBranchesLoading] = createSignal(false)
  const [defaultBranch, setDefaultBranch] = createSignal(props.defaultBaseBranch ?? "main")
  const [branchSearch, setBranchSearch] = createSignal("")

  // --- New tab state ---
  const [name, setName] = createSignal("")
  const cached = vscode.getState<Record<string, unknown>>()
  const [prompt, setPrompt] = createSignal((cached?.advancedDialogPrompt as string) ?? "")
  const [versions, setVersions] = createSignal<VersionCount>(1)
  const [model, setModel] = createSignal<{ providerID: string; modelID: string } | null>(session.configModel())
  const [compareMode, setCompareMode] = createSignal(false)
  const [modelAllocations, setModelAllocations] = createSignal<ModelAllocations>(new Map())
  const [agent, setAgent] = createSignal(session.selectedAgent())
  const [starting, setStarting] = createSignal(false)
  const [enhancing, setEnhancing] = createSignal(false)
  const [showAdvanced, setShowAdvanced] = createSignal(false)
  const [branchName, setBranchName] = createSignal("")
  const [baseBranch, setBaseBranch] = createSignal<string | null>(null)
  const [baseBranchOpen, setBaseBranchOpen] = createSignal(false)
  const [compareOpen, setCompareOpen] = createSignal(false)
  const [highlightedIndex, setHighlightedIndex] = createSignal(0)
  const [variant, setVariant] = createSignal<string | undefined>(session.currentVariant())
  const [sandbox, setSandbox] = createSignal<boolean | undefined>()
  const [sandboxDefault, setSandboxDefault] = createSignal<boolean | undefined>()
  const [sandboxOverride, setSandboxOverride] = createSignal<boolean | undefined>()
  const [sandboxAvailable, setSandboxAvailable] = createSignal(true)
  const [sandboxReason, setSandboxReason] = createSignal<string | undefined>()
  const [sandboxRevision, setSandboxRevision] = createSignal(-1)
  const sandboxRequestID = crypto.randomUUID()
  const sandboxVisible = () => features().sandboxControls && globalConfig().sandbox?.enabled === true
  const speech = useSpeechToText(vscode, server, { t })
  const canUseSpeech = () => canUseSpeechToText(config(), provider.authStates())
  const speechModel = () => selectedSpeechToTextModel(config())
  let prior: string | null = null
  let request: string | undefined
  const cancel = () => {
    prior = null
    request = undefined
    setEnhancing(false)
  }

  // Variant list for the currently selected model
  const variants = createMemo(() => {
    const sel = model()
    if (!sel) return []
    const found = provider.findModel(sel)
    if (!found?.variants) return []
    return Object.keys(found.variants)
  })

  // Current effective variant — falls back to first available if stored value is invalid
  const effectiveVariant = createMemo(() => {
    const list = variants()
    if (list.length === 0) return undefined
    const stored = variant()
    return stored && list.includes(stored) ? stored : list[0]
  })

  // True when the user has changed the model from the session/config default
  const overridden = createMemo(() => {
    const sel = model()
    const cfg = session.configModel()
    if (!sel || !cfg) return false
    return sel.providerID !== cfg.providerID || sel.modelID !== cfg.modelID
  })

  // Reset variant when model changes and stored variant is not in new list
  createEffect(() => {
    const list = variants()
    if (list.length === 0) {
      setVariant(undefined)
      return
    }
    const stored = variant()
    if (!stored || !list.includes(stored)) setVariant(list[0])
  })

  createEffect(() => {
    if (!sandboxVisible()) return
    if (server.connectionState() !== "connected") {
      setSandbox(undefined)
      setSandboxDefault(undefined)
      setSandboxOverride(undefined)
      return
    }
    vscode.postMessage({ type: "requestSandboxDefault", requestID: sandboxRequestID })
  })

  const unsubSandbox = vscode.onMessage((message) => {
    if (message.type !== "sandboxDefaultStatus") return
    if (message.requestID !== sandboxRequestID) return
    if (message.revision < sandboxRevision()) return

    setSandboxRevision(message.revision)
    setSandboxDefault(message.desired)
    setSandboxAvailable(message.available)
    setSandboxReason(message.reason)

    const override = sandboxOverride()
    if (override === undefined) {
      setSandbox(message.enabled)
      return
    }
    if (override === message.desired) setSandboxOverride(undefined)
  })
  onCleanup(unsubSandbox)

  const toggleSandbox = () => {
    const current = sandbox()
    if (current === undefined || !sandboxAvailable()) return
    const next = !current
    setSandbox(next)
    setSandboxOverride(next === sandboxDefault() ? undefined : next)
    vscode.postMessage({ type: "setSandboxDefault", enabled: next, requestID: sandboxRequestID })
  }

  const imageAttach = useImageAttachments()
  imageAttach.setFilePathDropHandler((paths) => {
    const cwd = server.workspaceDirectory()
    const resolved = paths.map((p) => convertToMentionPath(p, cwd))
    const ref = textareaRef
    if (!ref) return
    const val = ref.value
    const cursor = ref.selectionStart ?? val.length
    const before = val.substring(0, cursor)
    const after = val.substring(cursor)
    const inserted = resolved.map((p) => `@${p}`).join(" ")
    const result = before + inserted + " " + after
    ref.value = result
    cancel()
    setPrompt(result)
    persistPrompt(result)
    const pos = cursor + inserted.length + 1
    ref.setSelectionRange(pos, pos)
    ref.focus()
    adjustHeight()
  })

  // Restore cached images from webview state
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

  // Auto-persist images to webview state on any change
  createEffect(() => persistImages(imageAttach.images()))

  let textareaRef: HTMLTextAreaElement | undefined
  let containerRef: HTMLDivElement | undefined

  onMount(() => {
    setBranchesLoading(true)
    vscode.postMessage({ type: "agentManager.requestBranches" })
    // Resize textarea if restoring a cached prompt
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

  const effectiveBaseBranch = () => baseBranch() ?? defaultBranch()

  const filteredBranches = createMemo(() => {
    const search = branchSearch().toLowerCase()
    if (!search) return branches()
    return branches().filter((b) => b.name.toLowerCase().includes(search))
  })

  const canSubmit = () => {
    if (starting()) return false
    if (speech.active()) return false
    if (compareMode() && totalAllocations(modelAllocations()) === 0) return false
    return true
  }
  const total = () => (compareMode() ? totalAllocations(modelAllocations()) : versions())
  const mode = () => (compareMode() ? "compare_models" : versions() > 1 ? "multiple_versions" : "single")

  const handleSubmit = () => {
    if (!canSubmit()) return
    setStarting(true)

    const text = prompt().trim() || undefined
    const defaultAgent = session.agents()[0]?.name
    const selectedAgent = agent() !== defaultAgent ? agent() : undefined
    const advanced = showAdvanced()
    const customBranch = advanced ? branchName().trim() || undefined : undefined
    const imgs = imageAttach.images()
    const imgFiles = imgs.length > 0 ? imgs.map((img) => ({ mime: img.mime, url: img.dataUrl })) : undefined

    const isCompare = compareMode()
    const allocations = isCompare ? allocationsToArray(modelAllocations()) : undefined
    const count = total()
    const sel = isCompare ? null : model()

    vscode.postMessage({
      type: "agentManager.createMultiVersion",
      text,
      name: name().trim() || undefined,
      versions: count,
      providerID: sel?.providerID,
      modelID: sel?.modelID,
      agent: selectedAgent,
      variant: isCompare ? undefined : effectiveVariant(),
      baseBranch: advanced ? (baseBranch() ?? undefined) : undefined,
      branchName: customBranch,
      modelAllocations: allocations,
      sandbox: sandboxVisible() ? sandboxOverride() : undefined,
      files: imgFiles,
    })

    persistPrompt("")
    persistImages([])
    props.onClose()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const undo = (e: KeyboardEvent) => {
    if (e.key !== "z" || (!e.metaKey && !e.ctrlKey) || e.shiftKey || prior === null) return
    e.preventDefault()
    const restored = prior
    cancel()
    setPrompt(restored)
    persistPrompt(restored)
    if (!textareaRef) return
    textareaRef.value = restored
    adjustHeight()
    textareaRef.focus()
  }

  const onKey = (e: KeyboardEvent) => {
    // Shift+Tab cycles reasoning effort variants (setting: chat.shiftTabCyclesVariant).
    // When disabled or no variants exist, fall through to default focus navigation.
    if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (settings()["chat.shiftTabCyclesVariant"] === false) return
      const list = variants()
      if (list.length === 0) return
      const next = cycleVariant(effectiveVariant(), list)
      if (!next) return
      e.preventDefault()
      setVariant(next)
      return
    }
    undo(e)
  }

  const adjustHeight = () => {
    const box = containerRef
    const area = textareaRef
    if (!box || !area) return
    // Grow the container with the prompt (same 200px auto-grow cap as the
    // sidebar prompt), never the textarea: it fills the container and is the
    // only element that scrolls. A manual container resize persists until the
    // next input re-fits the height.
    box.style.height = "auto"
    const chrome = box.offsetHeight - area.offsetHeight
    box.style.height = `${Math.min(area.scrollHeight, 200) + chrome}px`
  }

  const insertSpeechText = (value: string) => {
    const ref = textareaRef
    const current = prompt()
    const start = ref?.selectionStart ?? current.length
    const end = ref?.selectionEnd ?? start
    const result = insertSpacedText(current, value, start, end)

    cancel()
    setPrompt(result.text)
    persistPrompt(result.text)
    if (!ref) return
    ref.value = result.text
    ref.setSelectionRange(result.pos, result.pos)
    ref.focus()
    adjustHeight()
  }

  const startSpeech = () => {
    speech.start({ model: speechModel(), insert: insertSpeechText })
  }

  const canEnhance = () => !starting() && !enhancing() && !speech.active() && server.isConnected()

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
    prior = prompt()
    const id = `enhance-newworktree-${crypto.randomUUID()}`
    request = id
    setEnhancing(true)
    vscode.postMessage({ type: "enhancePrompt", text: draft, requestId: id })
  }

  // --- Import tab state ---
  const [prUrl, setPrUrl] = createSignal("")
  const [prPending, setPrPending] = createSignal(false)
  const [branchOpen, setBranchOpen] = createSignal(false)
  const [importPending, setImportPending] = createSignal(false)

  const isPending = () => prPending() || importPending()

  // Listen for branch data + import results
  const importUnsub = vscode.onMessage((msg) => {
    if (msg.type === "agentManager.branches") {
      const ev = msg as AgentManagerBranchesMessage
      setBranches(ev.branches)
      if (!props.defaultBaseBranch) setDefaultBranch(ev.defaultBranch)
      setBranchesLoading(false)
    }
    if (msg.type === "agentManager.importResult") {
      const ev = msg as AgentManagerImportResultMessage
      setPrPending(false)
      setImportPending(false)
      if (ev.success) {
        props.onClose()
      } else {
        const description = ev.errorCode ? t(`agentManager.setup.error.${ev.errorCode}`) : ev.message
        showToast({ variant: "error", title: t("agentManager.import.failed"), description })
      }
    }
    if (msg.type === "enhancePromptResult") {
      const ev = msg as EnhancePromptResultMessage
      if (ev.requestId === request) {
        request = undefined
        setPrompt(ev.text)
        persistPrompt(ev.text)
        setEnhancing(false)
        if (textareaRef) {
          textareaRef.value = ev.text
          adjustHeight()
          textareaRef.focus()
        }
      }
    }
    if (msg.type === "enhancePromptError") {
      const ev = msg as EnhancePromptErrorMessage
      if (ev.requestId === request) cancel()
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
    vscode.postMessage({ type: "agentManager.importFromPR", url })
  }

  const handleBranchSelect = (name: string) => {
    if (isPending()) return
    track("import_branch")
    setImportPending(true)
    setBranchOpen(false)
    setBranchSearch("")
    vscode.postMessage({ type: "agentManager.importFromBranch", branch: name })
  }

  return (
    <Dialog title={t("agentManager.dialog.openWorktree")} fit>
      {/* Tab switcher */}
      <div class="am-tab-switcher">
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "new" }}
          onClick={click("switch_dialog_tab", "configure_worktree_dialog", () => setTab("new"), { tab: "new" })}
          type="button"
        >
          {t("agentManager.dialog.tab.new")}
        </button>
        <button
          class="am-tab-switcher-pill"
          classList={{ "am-tab-switcher-pill-active": tab() === "import" }}
          onClick={click("switch_dialog_tab", "configure_worktree_dialog", () => setTab("import"), { tab: "import" })}
          type="button"
        >
          {t("agentManager.dialog.tab.import")}
        </button>
      </div>

      {/* New tab */}
      <Show when={tab() === "new"}>
        <div class="am-nv-dialog" onKeyDown={handleKeyDown}>
          <div class="am-nv-dialog-content">
            <input
              class="am-nv-name-input"
              placeholder={t("agentManager.dialog.namePlaceholder")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
            {/* Prompt input — reuses the sidebar chat-input base classes for consistent styling */}
            <div
              ref={containerRef}
              class="prompt-input-container am-prompt-input-container"
              classList={{ "prompt-input-container--dragging": imageAttach.dragging() }}
              onDragOver={imageAttach.handleDragOver}
              onDragLeave={imageAttach.handleDragLeave}
              onDrop={imageAttach.handleDrop}
            >
              <Show when={imageAttach.images().length > 0}>
                <div class="image-attachments">
                  <For each={imageAttach.images()}>
                    {(img) => (
                      <div class="image-attachment">
                        <img
                          src={img.dataUrl}
                          alt={img.filename}
                          title={img.filename}
                          onClick={() =>
                            vscode.postMessage({ type: "previewImage", dataUrl: img.dataUrl, filename: img.filename })
                          }
                        />
                        <button
                          type="button"
                          class="image-attachment-remove"
                          onClick={() => imageAttach.remove(img.id)}
                          aria-label={t("agentManager.dialog.removeImage")}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <div class="prompt-input-wrapper am-prompt-input-wrapper">
                <div class="prompt-input-ghost-wrapper am-prompt-input-ghost-wrapper">
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
                      cancel()
                      setPrompt(val)
                      persistPrompt(val)
                      adjustHeight()
                    }}
                    onKeyDown={onKey}
                    onPaste={(e) => imageAttach.handlePaste(e)}
                    rows={3}
                    dir="auto"
                  />
                </div>
              </div>
              <div class="prompt-input-hint">
                <div class="prompt-input-hint-selectors">
                  <Show when={session.agents().length > 1}>
                    <ModeSwitcherBase
                      agents={session.agents()}
                      value={agent()}
                      onSelect={setAgent}
                      portal={false}
                      deferDismiss
                    />
                  </Show>
                  <Show when={!compareMode()}>
                    <ModelSelectorBase
                      value={model()}
                      onSelect={(pid, mid) => {
                        if (pid && mid) setModel({ providerID: pid, modelID: mid })
                      }}
                      placement="top-start"
                      portal={false}
                      deferDismiss
                    />
                    <ThinkingSelectorBase
                      variants={variants()}
                      value={effectiveVariant()}
                      onSelect={setVariant}
                      portal={false}
                      deferDismiss
                      cycleHint={settings()["chat.shiftTabCyclesVariant"] !== false}
                    />
                    <Show when={overridden()}>
                      <Tooltip value={t("prompt.action.resetModel")} placement="top">
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => setModel(session.configModel())}
                          aria-label={t("prompt.action.resetModel")}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
                          </svg>
                        </Button>
                      </Tooltip>
                    </Show>
                  </Show>
                </div>
                <div class="prompt-input-hint-actions">
                  <Tooltip value={t("prompt.action.enhance")} placement="top">
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={handleEnhance}
                      disabled={!canEnhance()}
                      aria-label={t("prompt.action.enhance")}
                    >
                      <WandSparkles size={16} class={enhancing() ? "enhance-spinner" : ""} />
                    </Button>
                  </Tooltip>
                  <Show when={sandboxVisible()}>
                    <SandboxButtonBase
                      enabled={sandbox() ?? false}
                      available={sandbox() === undefined ? undefined : sandboxAvailable()}
                      reason={sandboxReason()}
                      disabled={sandbox() === undefined}
                      tooltip={
                        <SandboxTooltipContent
                          enabled={sandbox() ?? false}
                          network={config().sandbox?.network !== "allow"}
                        />
                      }
                      tooltipClass="prompt-sandbox-tooltip-content"
                      onToggle={click("sandbox_toggle", "configure_worktree_dialog", toggleSandbox, () => ({
                        enabled: !(sandbox() ?? false),
                      }))}
                    />
                  </Show>
                  <Show when={canUseSpeech()}>
                    <SpeechToTextButton speech={speech} disabled={starting()} start={startSpeech} label={t} />
                  </Show>
                </div>
              </div>
            </div>

            {/* Advanced options toggle */}
            <button
              class="am-advanced-toggle"
              onClick={click(
                "advanced_options",
                "configure_worktree_dialog",
                () => setShowAdvanced(!showAdvanced()),
                () => ({ action: showAdvanced() ? "close" : "open" }),
              )}
              type="button"
            >
              <Icon name={showAdvanced() ? "chevron-down" : "chevron-right"} size="small" />
              <span>{t("agentManager.dialog.advancedOptions")}</span>
            </button>

            <Show when={showAdvanced()}>
              <div class="am-advanced-section">
                <div class="am-advanced-field">
                  <span class="am-nv-config-label">{t("agentManager.dialog.branchName")}</span>
                  <input
                    class="am-advanced-input"
                    type="text"
                    placeholder={t("agentManager.dialog.branchNamePlaceholder")}
                    value={branchName()}
                    onInput={(e) => setBranchName(sanitizeBranchName(e.currentTarget.value))}
                  />
                </div>
                <div class="am-advanced-field">
                  <span class="am-nv-config-label">{t("agentManager.dialog.baseBranch")}</span>
                  <div class="am-selector-wrapper">
                    <BranchSelectPopover
                      open={baseBranchOpen()}
                      onOpenChange={(open) => {
                        setBaseBranchOpen(open)
                        if (!open) {
                          setBranchSearch("")
                          setHighlightedIndex(0)
                        }
                      }}
                      trigger={
                        <button class="am-selector-trigger" type="button">
                          <span class="am-selector-left">
                            <Icon name="branch" size="small" />
                            <span class="am-selector-value">{effectiveBaseBranch()}</span>
                            <Show when={!baseBranch()}>
                              <span class="am-branch-badge">{t("agentManager.dialog.branchBadge.default")}</span>
                            </Show>
                          </span>
                          <span class="am-selector-right">
                            <Icon name="selector" size="small" />
                          </span>
                        </button>
                      }
                    >
                      <BranchSelect
                        branches={filteredBranches()}
                        loading={branchesLoading()}
                        search={branchSearch()}
                        onSearch={(v) => {
                          setBranchSearch(v)
                          setHighlightedIndex(0)
                        }}
                        onSelect={(b) => {
                          setBaseBranch(b.name)
                          setBaseBranchOpen(false)
                          setBranchSearch("")
                          setHighlightedIndex(0)
                        }}
                        onSearchKeyDown={(e) => {
                          const items = filteredBranches()
                          if (e.key === "ArrowDown") {
                            e.preventDefault()
                            e.stopPropagation()
                            const next = Math.min(highlightedIndex() + 1, items.length - 1)
                            setHighlightedIndex(next)
                            requestAnimationFrame(() => {
                              document
                                .querySelector(`.am-branch-item[data-index="${next}"]`)
                                ?.scrollIntoView({ block: "nearest" })
                            })
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault()
                            e.stopPropagation()
                            const prev = Math.max(highlightedIndex() - 1, 0)
                            setHighlightedIndex(prev)
                            requestAnimationFrame(() => {
                              document
                                .querySelector(`.am-branch-item[data-index="${prev}"]`)
                                ?.scrollIntoView({ block: "nearest" })
                            })
                          } else if (e.key === "Enter") {
                            e.preventDefault()
                            e.stopPropagation()
                            const selected = items[highlightedIndex()]
                            if (selected) {
                              setBaseBranch(selected.name)
                              setBaseBranchOpen(false)
                              setBranchSearch("")
                              setHighlightedIndex(0)
                            }
                          } else if (e.key === "Escape") {
                            e.preventDefault()
                            e.stopPropagation()
                            setBaseBranchOpen(false)
                            setBranchSearch("")
                            setHighlightedIndex(0)
                          }
                        }}
                        selected={effectiveBaseBranch()}
                        highlighted={highlightedIndex()}
                        onHighlight={setHighlightedIndex}
                        searchPlaceholder={t("agentManager.dialog.searchBranches")}
                        emptyLabel={t("agentManager.import.noMatchingBranches")}
                        defaultLabel={t("agentManager.dialog.branchBadge.default")}
                        remoteLabel={t("agentManager.dialog.branchBadge.remote")}
                        defaultName={defaultBranch()}
                      />
                    </BranchSelectPopover>
                  </div>
                </div>
              </div>
            </Show>

            {/* Version / compare mode selector */}
            <Show
              when={compareMode()}
              fallback={
                <div class="am-nv-version-bar">
                  <span class="am-nv-config-label">{t("agentManager.dialog.versions")}</span>
                  <div class="am-nv-pills">
                    {VERSION_OPTIONS.map((count) => (
                      <button
                        class="am-nv-pill"
                        classList={{ "am-nv-pill-active": versions() === count }}
                        onClick={click("version_count", "configure_worktree_dialog", () => setVersions(count), {
                          count,
                        })}
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
                      <button
                        class="am-nv-pill am-nv-pill-compare"
                        onClick={click("compare_models", "configure_worktree_dialog", () => setCompareMode(true), {
                          action: "open",
                        })}
                        type="button"
                      >
                        <Icon name="layers" size="small" />
                        <span class="am-nv-pill-compare-label">{t("agentManager.dialog.compareModels")}</span>
                      </button>
                    </Tooltip>
                  </div>
                  <Show when={versions() > 1}>
                    <span class="am-nv-version-hint">
                      {t("agentManager.dialog.versionHint", { count: versions() })}
                    </span>
                  </Show>
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
                      track("compare_models", { action: "close" })
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
                              .map((e) => (e.variant ? `${e.name} (${e.variant})` : e.name))
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
                  <MultiModelSelector allocations={modelAllocations()} onChange={setModelAllocations} />
                </DeferredPopover>
              </div>
            </Show>
          </div>
          {/* Submit button — fixed footer, always visible */}
          <div class="am-nv-dialog-footer">
            <Button
              variant="primary"
              size="large"
              class="am-nv-submit"
              onClick={click("create_worktree", "configure_worktree_dialog", handleSubmit, () => ({
                mode: mode(),
                versionCount: total(),
                advanced: showAdvanced(),
                customBranch: showAdvanced() && !!branchName().trim(),
                customBase: showAdvanced() && !!baseBranch(),
                hasPrompt: !!prompt().trim(),
                hasAttachments: imageAttach.images().length > 0,
              }))}
              disabled={!canSubmit()}
            >
              <Show
                when={!starting()}
                fallback={
                  <>
                    <Spinner class="am-nv-spinner" />
                    <span>{t("agentManager.dialog.creating")}</span>
                  </>
                }
              >
                {t("agentManager.dialog.createWorktree")}
              </Show>
            </Button>
          </div>
        </div>
      </Show>

      {/* Import tab */}
      <Show when={tab() === "import"}>
        <div class="am-import-tab">
          {/* Pull Request section */}
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
                onClick={click("import_pull_request", "configure_worktree_dialog", handlePRSubmit)}
                disabled={!prUrl().trim() || isPending()}
              >
                <Show when={prPending()} fallback={t("agentManager.import.open")}>
                  <Spinner class="am-nv-spinner" />
                </Show>
              </Button>
            </div>
          </div>

          <div class="am-import-divider" />

          {/* Branches section */}
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

          {/* Empty state when no branches are available */}
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
