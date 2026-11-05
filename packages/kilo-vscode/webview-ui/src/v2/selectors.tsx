// Agent, model and reasoning variant for the prompt, on native v2 data. The server session owns the selection: an
// existing session commits each change with switchAgent/switchModel and shows the server's value. Before a session
// exists, the choice is a local draft that `create` passes to session.create.
import type { JsonValue, ModelRef } from "@opencode/client"
import { createModelAttribution } from "./attribution"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js"
import { PromptSelectors } from "../components/chat/PromptSelectors"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
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
  const fallback = createDefaultModel(v2)
  // The latest switch request per session, so a prompt waits for it. Prompts gate on session creation themselves.
  const commits = new Map<string, Promise<unknown>>()
  const creates = new Map<string, Promise<unknown>>()
  const attribution = createModelAttribution()

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
      agent: agent()?.model ?? undefined,
      configured: configured(),
      team: kiloTeam(v2.kiloModels()),
      recents: prefs?.recents() ?? [],
      valid: (ref) => !!find(ref),
      fallback: fallback(),
    })
  // The remembered effort of the agent on a model: v1 keeps the last effort a new session chose ("" is Default), on
  // the nearest effort the model still has.
  const remembered = (ref: { providerID: string; id: string }) => {
    const id = agent()?.id
    const saved = id ? prefs?.variant(id, ref.providerID, ref.id) : undefined
    return saved ? preserveVariant(saved, variantsOf(ref)) : undefined
  }
  const model = (): ModelRef | undefined => {
    const own = session() ? info()?.model : draftModel()
    const value = own ?? initial()
    // The server reports "no explicit variant" as "default" (core session/info.ts), as the TUI normalizes it.
    if (value?.variant === DEFAULT) return { id: value.id, providerID: value.providerID }
    if (own || !value) return value
    // A configured or agent effort the model no longer has moves to the nearest one, as v1 and the TUI.
    const variant = value.variant ? preserveVariant(value.variant, variantsOf(value)) : remembered(value)
    return { id: value.id, providerID: value.providerID, ...(variant ? { variant } : {}) }
  }
  const variants = () => variantsOf(model())

  const commit = (id: string, run: () => Promise<unknown>) => {
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
    attribution.request(id, next)
    // An explicit "default" clears a previous variant: a model without the field would keep it in createData.
    commit(id, () =>
      v2.api.session.switchModel({ sessionID: id, model: { ...next, variant: next.variant ?? DEFAULT } }).catch(
        (error: unknown) => {
          // A switch that did not apply must not name a later prompt, unless a newer request replaced it.
          attribution.clear(id, next)
          throw error
        },
      ),
    )
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
    // The agent decides the model the prompt runs on, so it replaces a model request that the store already applied.
    attribution.clear(id)
    commit(id, () => v2.api.session.switchAgent({ sessionID: id, agent: value }))
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
      prefs?.pushRecent(providerID, modelID)
      if (!session() && variant) remember(next, variant)
      setModel({ ...next, ...(variant ? { variant } : {}) })
    },
    selectVariant(variant: string | undefined) {
      const current = model()
      if (!current) return
      // A new session remembers the effort for the next one; a session keeps it on the server only, as v1.
      if (!session()) remember(current, variant)
      setModel({ id: current.id, providerID: current.providerID, ...(variant ? { variant } : {}) })
    },
    /** Creates a session with the current selection, then writes the metadata the caller passes. */
    create(metadata?: Record<string, JsonValue>) {
      const created = v2.data.session.create({ agent: agent()?.id, model: model() })
      // The server reads the sandbox metadata when it first resolves the session state, so write it before the first
      // prompt or status call, which both wait for this request.
      const request = metadata
        ? created.request.then(() => v2.api.session.update({ sessionID: created.id, metadata }))
        : created.request
      creates.set(created.id, request)
      // A rejected write leaves the session on the config default while the draft toggle looked applied, so report
      // it. A failed create keeps failing the prompt, which reports it.
      void request
        .catch((error: unknown) => {
          if (metadata) v2.report(error)
        })
        .finally(() => creates.delete(created.id))
      return created.id
    },
    /** The pending create of a session, including its metadata write. */
    created(id: string) {
      return creates.get(id)
    },
    /** The pending switch of a session; a failed switch fails the prompt instead of using another model. */
    gate(id: string) {
      return commits.get(id)
    },
    /**
     * The model a prompt of this session runs on. A switch that settled but is not in the store yet keeps its
     * requested value until the store reports it.
     */
    attributed(id: string) {
      return attribution.read(id, v2.data.session.get(id)?.model)
    },
  }
}

export type Selection = ReturnType<typeof createSelection>

/**
 * The server default model of the directory, the last fallback of every composer after its own choice and the agent
 * model. Sign-in, sign-out and a team switch reload the catalog, so the default follows the catalog.
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
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      if (!shiftTabCyclesVariant()) return
      const active = document.activeElement
      if (!(active instanceof HTMLTextAreaElement) || !active.classList.contains("prompt-input")) return
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
