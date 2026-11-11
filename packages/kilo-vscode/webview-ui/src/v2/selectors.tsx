// Agent, model and reasoning variant for the prompt, on native v2 data. An existing session commits an agent change
// with switchAgent at once. A model or effort change is a composer draft (`v2.drafts`) that the next prompt commits
// with switchModel, as the TUI does, so a pick or Shift+Tab never waits for the server. Before a session exists, the
// choice is a local draft that `create` passes to session.create.
import type { JsonValue, ModelRef } from "@opencode/client"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js"
import { PromptSelectors } from "../components/chat/PromptSelectors"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
import ModelDescription from "../components/shared/ModelDescription"
import { ModeSwitcherBase } from "../components/shared/ModeSwitcher"
import { ThinkingSelectorBase } from "../components/shared/ThinkingSelector"
import { useLanguage } from "../context/language"
import { useModelPreferences } from "../context/model-preferences"
import { useV2, type V2 } from "./client"
import { failureMessage } from "./kilo-catalog"
import { shiftTabCyclesVariant } from "./kilo-settings"
import { configuredModel, initialModel } from "./model-default"
import { kiloTeam } from "./kilo-models"
import { cycleVariant, preserveVariant } from "./variant"

const DEFAULT = "default"

export function createSelection(
  session: Accessor<string | undefined>,
  draftKey: Accessor<string | undefined> = session,
) {
  const v2 = useV2()
  const prefs = useModelPreferences()
  const [draftAgent, setDraftAgent] = createSignal<string>()
  const [draftModel, setDraftModel] = createSignal<ModelRef>()
  // Fallback per-agent picks when no ModelPreferencesProvider wraps the selector.
  const picks = new Map<string, ModelRef>()
  const fallback = createDefaultModel(v2)
  // The latest switch request per session, so a prompt waits for it. Prompts gate on session creation themselves.
  const commits = new Map<string, Promise<unknown>>()
  const creates = new Map<string, Promise<unknown>>()
  const drafts = v2.drafts

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
        v2.data.location.config.sync(),
      ]).catch(v2.report)
    }),
  )
  // Sign-in, sign-out and a team switch reload the catalog through createData, and can change the default model and
  // the models a draft may use. A draft model that left the catalog falls back to the default, as on v1.
  createEffect(
    on(
      () => v2.data.location.model.list(),
      (list) => {
        const draft = draftModel()
        if (list && draft && !list.some((item) => item.providerID === draft.providerID && item.id === draft.id))
          setDraftModel(undefined)
      },
    ),
  )

  const info = () => {
    const id = session()
    return id ? v2.data.session.get(id) : undefined
  }
  // A new draft starts at the default selection instead of inheriting the agent and model of the previous tab or
  // session. An existing session keeps the server value, so resetting the local draft is safe.
  createEffect(
    on(
      draftKey,
      () => {
        setDraftAgent(undefined)
        setDraftModel(undefined)
      },
      { defer: true },
    ),
  )
  const agents = () =>
    (v2.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const agent = () => {
    const id = session() ? info()?.agent : draftAgent()
    return agents().find((item) => item.id === id) ?? agents()[0]
  }
  const models = () => v2.data.location.model.list()
  const find = (ref: { providerID: string; id: string } | undefined) =>
    ref ? models()?.find((item) => item.providerID === ref.providerID && item.id === ref.id && item.enabled) : undefined
  const variantsOf = (ref: { providerID: string; id: string } | undefined) =>
    find(ref)?.variants.map((variant) => variant.id) ?? []
  const configured = createMemo(() => configuredModel(v2.data.location.config.list()))
  const initial = () =>
    initialModel({
      pick: prefs ? prefs.pick(agent()?.id) : picks.get(agent()?.id ?? ""),
      agent: agent()?.model ?? undefined,
      configured: configured(),
      team: kiloTeam(v2.kiloModels()),
      loaded: prefs?.loaded() ?? true,
      recents: prefs?.recents() ?? [],
      models: models() ?? [],
      serverDefault: fallback(),
      valid: (ref) => !!find(ref),
    })
  // The remembered effort of the agent on a model: v1 keeps the last effort a new session chose ("" is Default), on
  // the nearest effort the model still has.
  const remembered = (ref: { providerID: string; id: string }) => {
    const id = agent()?.id
    const saved = id ? prefs?.variant(id, ref.providerID, ref.id) : undefined
    return saved ? preserveVariant(saved, variantsOf(ref)) : undefined
  }
  const model = (): ModelRef | undefined => {
    const id = session()
    const own = id ? (drafts.get(id) ?? info()?.model) : draftModel()
    const value = own ?? initial()
    // The server reports "no explicit variant" as "default" (core session/info.ts), as the TUI normalizes it.
    if (value?.variant === DEFAULT) return { id: value.id, providerID: value.providerID }
    if (own || !value) return value
    // A configured or agent effort the model no longer has moves to the nearest one, as v1 and the TUI.
    const variant = value.variant ? preserveVariant(value.variant, variantsOf(value)) : remembered(value)
    return { id: value.id, providerID: value.providerID, ...(variant ? { variant } : {}) }
  }
  const variants = () => variantsOf(model())

  const chain = (id: string, run: () => Promise<unknown>) => {
    const request = Promise.all([creates.get(id), commits.get(id)])
      .catch(() => undefined)
      .then(run)
    commits.set(id, request)
    request.catch(v2.report).finally(() => {
      if (commits.get(id) === request) commits.delete(id)
    })
  }

  const setModel = (next: ModelRef) => {
    const id = session()
    if (!id) return void setDraftModel(next)
    drafts.set(id, next, info()?.model)
  }

  const remember = (ref: { providerID: string; id: string }, variant: string | undefined) => {
    const id = agent()?.id
    if (id) prefs?.rememberVariant(id, ref.providerID, ref.id, variant)
  }

  // The same writer for a click and a cycle: a draft keeps the value locally, an existing session commits
  // it to the server, and an unchanged value is a no-op (as on v1).
  const selectAgent = (value: string) => {
    const id = session()
    if (!id) return void setDraftAgent(value)
    if (value === agent()?.id) return
    chain(id, () => v2.api.session.switchAgent({ sessionID: id, agent: value }))
  }

  return {
    agents,
    agent,
    model,
    models,
    providers: () => v2.data.location.provider.list(),
    variants,
    selectAgent,
    /** Cycle to the next or previous visible agent, as main's cycleAgent (wraps at both ends). */
    cycleAgent(direction: 1 | -1) {
      const list = agents()
      if (list.length <= 1) return
      const index = list.findIndex((item) => item.id === agent()?.id)
      const raw = index + direction
      const next = raw < 0 ? list.length - 1 : raw >= list.length ? 0 : raw
      const value = list[next]?.id
      if (value) selectAgent(value)
    },
    selectModel(providerID: string, modelID: string) {
      const current = model()
      const next = { providerID, id: modelID }
      // Carry the effort to the new model when it has it or a nearby effort, as v1. Without an effort, the new model
      // keeps the effort the agent last chose for it.
      const variant = (current?.variant && preserveVariant(current.variant, variantsOf(next))) || remembered(next)
      const draft = !session()
      const agentID = agent()?.id
      if (draft && prefs) prefs.rememberPick(agentID, providerID, modelID)
      if (!draft || !prefs) prefs?.pushRecent(providerID, modelID)
      if (draft && !prefs && agentID) picks.set(agentID, next)
      if (draft && variant) remember(next, variant)
      setModel({ ...next, ...(variant ? { variant } : {}) })
    },
    selectVariant(variant: string | undefined) {
      const current = model()
      if (!current) return
      // A new session remembers the effort for the next one; a session keeps it until its next prompt, as v1.
      if (!session()) remember(current, variant)
      setModel({ id: current.id, providerID: current.providerID, ...(variant ? { variant } : {}) })
    },
    /** Creates a session with the current selection, then writes the metadata the caller passes. */
    create(metadata?: Record<string, JsonValue>) {
      const created = v2.data.session.create({ agent: agent()?.id, model: model() })
      // The server reads the sandbox metadata when it first resolves the session state, so write it before the first
      // prompt or status call, which both wait for this request.
      const request = metadata
        ? created.request.then(() =>
            v2.api.session.update({ sessionID: created.id, metadata }).catch((error: unknown) => {
              // The session keeps the config default while the draft toggle looked applied. A failed create keeps
              // failing the prompt, which reports it.
              v2.report(error)
              throw error
            }),
          )
        : created.request
      creates.set(created.id, request)
      void request.catch(() => undefined).finally(() => creates.delete(created.id))
      return created.id
    },
    /**
     * Seeds the composer's draft for a host-created session (a worktree) that started without a server model, so the
     * prompt commits the model the composer shows instead of running on the server default.
     */
    ensure(id: string) {
      const existing = v2.data.session.get(id)
      if (!existing || existing.model || drafts.get(id)) return
      const current = model()
      if (current) drafts.set(id, current, undefined)
    },
    /** The pending create of a session, including its metadata write. */
    created(id: string) {
      return creates.get(id)
    },
    /** The pending switch of a session; a failed switch fails the prompt instead of using another model. */
    gate(id: string) {
      return commits.get(id)
    },
    /** The composer's uncommitted model of a session as a switchModel payload; undefined when it shows the session's. */
    draft(id: string) {
      const next = drafts.get(id)
      // An explicit "default" clears a previous variant: a model without the field would keep it in createData.
      return next && { ...next, variant: next.variant ?? DEFAULT }
    },
    /**
     * Commits a draft taken when the prompt was sent, after a pending agent switch, as the TUI's commitModel, and
     * returns the pending switch so the prompt waits for it and fails with it.
     */
    commit(id: string, next: ModelRef | undefined) {
      if (next)
        chain(id, () => {
          // Marked before the request: the stored model still reports the previous one until the echo.
          drafts.commit(id, next)
          return v2.api.session.switchModel({ sessionID: id, model: next }).then(
            () => drafts.committed(id, v2.data.session.get(id)?.model),
            (error: unknown) => {
              drafts.failed(id, next)
              throw error
            },
          )
        })
      return Promise.resolve(commits.get(id))
    },
    /** The model and effort the composer shows for a session: its draft, else the session's own model. */
    selected(id: string) {
      return drafts.get(id) ?? v2.data.session.get(id)?.model
    },
  }
}

export type Selection = ReturnType<typeof createSelection>

/**
 * The server default model of the directory, the fallback of every composer after its own choice, the agent model and
 * Kilo Auto Free. Sign-in, sign-out and a team switch reload the catalog, so the default follows the catalog.
 */
export function createDefaultModel(v2: V2) {
  const [model, setModel] = createSignal<ModelRef>()
  createEffect(
    on(
      () => v2.data.location.model.list(),
      (list) => {
        if (!list) return
        void v2.api.model
          .default({ location: { directory: v2.directory } })
          .then((response) =>
            setModel(response.data ? { id: response.data.id, providerID: response.data.providerID } : undefined),
          )
          .catch(v2.report)
      },
    ),
  )
  return model
}

export function Selectors(props: { selection: Selection; blocked: boolean }) {
  const v2 = useV2()
  const language = useLanguage()
  const model = () => {
    const current = props.selection.model()
    return current ? { providerID: current.providerID, modelID: current.id } : null
  }
  // Shift+Tab cycles the effort while the prompt input has focus, gated on the
  // `kilo-code.v2.chat.shiftTabCyclesVariant` setting (on by default). The tooltip hint follows the same setting.
  // Only the prompt of this composer counts: the Agent Manager's New Worktree dialog has its own prompt and cycle.
  let root: HTMLDivElement | undefined
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      if (!shiftTabCyclesVariant()) return
      const active = document.activeElement
      if (!(active instanceof HTMLTextAreaElement) || !active.classList.contains("prompt-input")) return
      if (!root || !active.closest(".prompt-input-container")?.contains(root)) return
      const variants = props.selection.variants()
      if (variants.length === 0) return
      event.preventDefault()
      props.selection.selectVariant(cycleVariant(props.selection.model()?.variant, variants))
    }
    window.addEventListener("keydown", onKeyDown, true)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown, true))
  })
  // As v1's chat ModelSelector: a pick or Escape returns focus to the prompt.
  const restore = () =>
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("focusPrompt", { detail: { restore: true } })))
  // The cycle shortcut label the host resolved, as main's modeHint(): the keybind shows next to the title,
  // and an empty keybind hides the tooltip.
  const keybind = () => v2.bindings().cycleAgentMode ?? ""
  return (
    <PromptSelectors
      ref={(el) => (root = el)}
      agent={
        <TooltipKeybind
          title={language.t("prompt.shortcutHint.mode")}
          keybind={keybind()}
          placement="top"
          openDelay={0}
          inactive={!keybind()}
        >
          <ModeSwitcherBase
            agents={props.selection.agents()}
            value={props.selection.agent()?.id ?? ""}
            blocked={props.blocked}
            onSelect={(id) => {
              props.selection.selectAgent(id)
              requestAnimationFrame(() => window.dispatchEvent(new Event("focusPrompt")))
            }}
          />
        </TooltipKeybind>
      }
      model={
        <ModelSelectorBase
          models={props.selection.models()}
          providers={props.selection.providers()}
          gateway={v2.kiloModels().entries}
          value={model()}
          blocked={props.blocked}
          descriptionRenderer={ModelDescription}
          failure={failureMessage(language.t, v2.kiloFailure())}
          onSelect={props.selection.selectModel}
          onPick={restore}
          onCancel={restore}
        />
      }
      variant={
        <ThinkingSelectorBase
          variants={props.selection.variants()}
          value={props.selection.model()?.variant}
          blocked={props.blocked}
          onSelect={props.selection.selectVariant}
          onClear={() => props.selection.selectVariant(undefined)}
          allowClear
          clearLabel={language.t("common.default")}
          heading={language.t("prompt.thinking.tooltip")}
          cycleHint={shiftTabCyclesVariant()}
        />
      }
    />
  )
}
