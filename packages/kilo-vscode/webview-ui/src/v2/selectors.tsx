// Agent, model and reasoning variant for the prompt, on native v2 data. The server session owns the selection: an
// existing session commits each change with switchAgent/switchModel and shows the server's value. Before a session
// exists, the choice is a local draft that `create` passes to session.create.
import type { ModelRef } from "@opencode/client"
import { TooltipKeybind } from "@kilocode/kilo-ui/tooltip"
import { createEffect, createSignal, on, type Accessor } from "solid-js"
import { PromptSelectors } from "../components/chat/PromptSelectors"
import { ModelSelectorBase } from "../components/shared/ModelSelector"
import { ModeSwitcherBase } from "../components/shared/ModeSwitcher"
import { ThinkingSelectorBase } from "../components/shared/ThinkingSelector"
import { useLanguage } from "../context/language"
import { useV2 } from "./client"

const DEFAULT = "default"

export function createSelection(session: Accessor<string | undefined>) {
  const v2 = useV2()
  const [draftAgent, setDraftAgent] = createSignal<string>()
  const [draftModel, setDraftModel] = createSignal<ModelRef>()
  const [fallback, setFallback] = createSignal<ModelRef>()
  // The latest switch request per session, so a prompt waits for it. Prompts gate on session creation themselves.
  const commits = new Map<string, Promise<unknown>>()
  const creates = new Map<string, Promise<unknown>>()

  createEffect(
    on(v2.connection.status, (status) => {
      if (status !== "connected") return
      void Promise.all([
        v2.data.location.agent.sync(),
        v2.data.location.model.sync(),
        v2.data.location.provider.sync(),
      ]).catch(v2.report)
    }),
  )
  // Sign-in, sign-out and a team switch reload the catalog through createData, and can change the default model and
  // the models a draft may use. A draft model that left the catalog falls back to the default, as on v1.
  createEffect(
    on(
      () => v2.data.location.model.list(),
      (list) => {
        if (!list) return
        const draft = draftModel()
        if (draft && !list.some((item) => item.providerID === draft.providerID && item.id === draft.id))
          setDraftModel(undefined)
        void v2.api.model
          .default({ location: { directory: v2.directory } })
          .then((response) => {
            setFallback(response.data ? { id: response.data.id, providerID: response.data.providerID } : undefined)
          })
          .catch(v2.report)
      },
    ),
  )

  const info = () => {
    const id = session()
    return id ? v2.data.session.get(id) : undefined
  }
  const agents = () =>
    (v2.data.location.agent.list() ?? []).filter((agent) => agent.mode !== "subagent" && !agent.hidden)
  const agent = () => {
    const id = session() ? info()?.agent : draftAgent()
    return agents().find((item) => item.id === id) ?? agents()[0]
  }
  const model = (): ModelRef | undefined => {
    const value = (session() ? info()?.model : draftModel()) ?? agent()?.model ?? fallback()
    // The server reports "no explicit variant" as "default" (core session/info.ts), as the TUI normalizes it.
    if (value?.variant !== DEFAULT) return value
    return { id: value.id, providerID: value.providerID }
  }
  const models = () => v2.data.location.model.list()
  const variants = () => {
    const current = model()
    const found = models()?.find((item) => item.providerID === current?.providerID && item.id === current?.id)
    return found?.variants.map((variant) => variant.id) ?? []
  }

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
    // An explicit "default" clears a previous variant: a model without the field would keep it in createData.
    commit(id, () =>
      v2.api.session.switchModel({ sessionID: id, model: { ...next, variant: next.variant ?? DEFAULT } }),
    )
  }

  // The same writer for a click and a cycle: a draft keeps the value locally, an existing session commits
  // it to the server, and an unchanged value is a no-op (as on v1).
  const selectAgent = (value: string) => {
    const id = session()
    if (!id) return void setDraftAgent(value)
    if (value === agent()?.id) return
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
      const found = models()?.find((item) => item.providerID === providerID && item.id === modelID)
      // A variant carries over only when the new model has it.
      const variant = found?.variants.some((item) => item.id === current?.variant) ? current?.variant : undefined
      setModel({ id: modelID, providerID, ...(variant ? { variant } : {}) })
    },
    selectVariant(variant: string | undefined) {
      const current = model()
      if (current) setModel({ id: current.id, providerID: current.providerID, ...(variant ? { variant } : {}) })
    },
    /** Creates a session with the current selection. */
    create() {
      const created = v2.data.session.create({ agent: agent()?.id, model: model() })
      creates.set(created.id, created.request)
      void created.request.catch(() => undefined).finally(() => creates.delete(created.id))
      return created.id
    },
    /** The pending switch of a session; a failed switch fails the prompt instead of using another model. */
    gate(id: string) {
      return commits.get(id)
    },
  }
}

export type Selection = ReturnType<typeof createSelection>

export function Selectors(props: { selection: Selection; blocked: boolean }) {
  const v2 = useV2()
  const language = useLanguage()
  const model = () => {
    const current = props.selection.model()
    return current ? { providerID: current.providerID, modelID: current.id } : null
  }
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
          value={model()}
          blocked={props.blocked}
          onSelect={props.selection.selectModel}
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
        />
      }
    />
  )
}
