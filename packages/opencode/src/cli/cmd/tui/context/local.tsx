import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { batch, createEffect, createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useEvent } from "@tui/context/event"
import { uniqueBy } from "remeda"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { iife } from "@/util/iife"
import { useToast } from "../ui/toast"
import { useArgs } from "./args"
import { useSDK } from "./sdk"
import { useProject } from "./project" // kilocode_change
import { resolveAgentVariant, resolveSelectedVariant } from "@/kilocode/cli/cmd/tui/model-variant" // kilocode_change
import { migrate as migrateLegacyVariants, variants as legacyVariants } from "@/kilocode/cli/cmd/tui/model-variant-migration" // kilocode_change
import { RGBA } from "@opentui/core"
import { Filesystem } from "@/util/filesystem"

export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return {
    providerID: providerID,
    modelID: rest.join("/"),
  }
}

export const { use: useLocal, provider: LocalProvider } = createSimpleContext({
  name: "Local",
  init: () => {
    const sync = useSync()
    const sdk = useSDK()
    const project = useProject() // kilocode_change
    const toast = useToast()

    function isModelValid(model: { providerID: string; modelID: string }) {
      const provider = sync.data.provider.find((x) => x.id === model.providerID)
      return !!provider?.models[model.modelID]
    }

    function getFirstValidModel(...modelFns: (() => { providerID: string; modelID: string } | undefined)[]) {
      for (const modelFn of modelFns) {
        const model = modelFn()
        if (!model) continue
        if (isModelValid(model)) return model
      }
    }

    const agent = iife(() => {
      const agents = createMemo(() => sync.data.agent.filter((x) => x.mode !== "subagent" && !x.hidden))
      const visibleAgents = createMemo(() => sync.data.agent.filter((x) => !x.hidden))
      const [agentStore, setAgentStore] = createStore({
        current: undefined as string | undefined,
      })
      const { theme } = useTheme()
      const colors = createMemo(() => [
        theme.secondary,
        theme.accent,
        theme.success,
        theme.warning,
        theme.primary,
        theme.error,
        theme.info,
      ])
      return {
        list() {
          return agents()
        },
        current() {
          // kilocode_change start - fall back to first agent when current is removed (e.g. org switch)
          const found = agents().find((x) => x.name === agentStore.current)
          if (found) return found
          const fallback = agents().at(0)
          if (fallback) setAgentStore("current", fallback.name)
          return fallback
          // kilocode_change end
        },
        set(name: string) {
          if (!agents().some((x) => x.name === name))
            return toast.show({
              variant: "warning",
              message: `Agent not found: ${name}`,
              duration: 3000,
            })
          setAgentStore("current", name)
        },
        move(direction: 1 | -1) {
          batch(() => {
            const current = this.current()
            if (!current) return
            let next = agents().findIndex((x) => x.name === current.name) + direction
            if (next < 0) next = agents().length - 1
            if (next >= agents().length) next = 0
            const value = agents()[next]
            if (!value) return // kilocode_change - guard against empty agent list during org switch
            setAgentStore("current", value.name)
          })
        },
        color(name: string) {
          const index = visibleAgents().findIndex((x) => x.name === name)
          if (index === -1) return colors()[0]
          const agent = visibleAgents()[index]

          if (agent?.color) {
            const color = agent.color
            if (color.startsWith("#")) return RGBA.fromHex(color)
            // already validated by config, just satisfying TS here
            return theme[color as keyof typeof theme] as RGBA
          }
          return colors()[index % colors().length]
        },
      }
    })

    const model = iife(() => {
      const [modelStore, setModelStore] = createStore<{
        ready: boolean
        // kilocode_change start - persisted model picks plus process-local overrides
        model: Record<
          string,
          | {
              providerID: string
              modelID: string
            }
          | undefined
        >
        override: Record<
          string,
          | {
              providerID: string
              modelID: string
            }
          | undefined
        >
        // kilocode_change end
        recent: {
          providerID: string
          modelID: string
        }[]
        favorite: {
          providerID: string
          modelID: string
        }[]
        // kilocode_change start - runtime variant overrides stay process-local
        variant: Record<string, string | undefined>
        // kilocode_change end
      }>({
        ready: false,
        model: {},
        override: {}, // kilocode_change
        recent: [],
        favorite: [],
        variant: {},
      })

      const filePath = path.join(Global.Path.state, "model.json")
      const state = {
        pending: false,
        writer: Promise.resolve() as Promise<unknown>, // kilocode_change - serialize writes
        legacy: undefined as Record<string, string> | undefined, // kilocode_change
        migrating: false, // kilocode_change
      }

      // kilocode_change start - keep configured-agent selections process-local
      const scope = createMemo(() => project.workspace.current() ?? project.instance.directory())

      function key(name: string) {
        return [scope(), name].join(":")
      }

      function variantKey(name: string) {
        return key(name)
      }

      function clear(name: string) {
        setModelStore("model", name, undefined)
      }

      function apply(name: string, value: { providerID: string; modelID: string }, persist: boolean) {
        setModelStore("override", key(name), { ...value })
        if (persist) {
          setModelStore("model", name, { ...value })
          return
        }
        clear(name)
      }
      // kilocode_change end

      function save() {
        if (!modelStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        // kilocode_change start - serialize writes so a slow first write cannot overwrite a later one
        const data = {
          model: modelStore.model,
          recent: modelStore.recent,
          favorite: modelStore.favorite,
          ...(state.legacy ? { variant: state.legacy } : {}),
        }
        state.writer = state.writer.then(() => Filesystem.writeJson(filePath, data)).catch(() => {})
        // kilocode_change end
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          if (Array.isArray(x.recent)) setModelStore("recent", x.recent)
          if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
          const old = legacyVariants(x.variant) // kilocode_change
          state.legacy = Object.keys(old).length > 0 ? old : undefined // kilocode_change
          if (typeof x.model === "object" && x.model !== null) setModelStore("model", x.model) // kilocode_change
        })
        .catch(() => {})
        .finally(() => {
          setModelStore("ready", true)
          if (state.pending) save()
        })

      const args = useArgs()
      const fallbackModel = createMemo(() => {
        if (args.model) {
          const { providerID, modelID } = parseModel(args.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        if (sync.data.config.model) {
          const { providerID, modelID } = parseModel(sync.data.config.model)
          if (isModelValid({ providerID, modelID })) {
            return {
              providerID,
              modelID,
            }
          }
        }

        for (const item of modelStore.recent) {
          if (isModelValid(item)) {
            return item
          }
        }

        const provider = sync.data.provider[0]
        if (!provider) return undefined
        const defaultModel = sync.data.provider_default[provider.id]
        const firstModel = Object.values(provider.models)[0]
        const model = defaultModel ?? firstModel?.id
        if (!model) return undefined
        return {
          providerID: provider.id,
          modelID: model,
        }
      })

      const currentModel = createMemo(() => {
        const a = agent.current()
        if (!a) return fallbackModel() // kilocode_change - guard against empty agent list
        // kilocode_change start - configured models beat stale persisted picks
        return (
          getFirstValidModel(
            () => a && modelStore.override[key(a.name)],
            () => a && a.model,
            () => a && modelStore.model[a.name],
            fallbackModel,
          ) ?? undefined
        )
        // kilocode_change end
      })

      // kilocode_change start - migrate legacy model-keyed variants to agent config
      createEffect(() => {
        if (!modelStore.ready) return
        if (!state.legacy) return
        if (state.migrating) return
        const a = agent.current()
        const m = currentModel()
        const list = agent.list()
        const fallback = !args.model ? fallbackModel() : undefined
        const model = Object.fromEntries(
          list.map((item) => {
            const cfg = item.model && isModelValid(item.model) ? item.model : undefined
            const saved = modelStore.model[item.name]
            const persisted = saved && isModelValid(saved) ? saved : undefined
            return [item.name, cfg ?? persisted ?? fallback] as const
          }),
        )
        const migrated = migrateLegacyVariants({
          old: state.legacy,
          model,
          agent: list,
          current: !args.model && a && m ? { name: a.name, model: m } : undefined,
        })
        if (Object.keys(migrated.cfg).length === 0) {
          if (migrated.matched) {
            state.legacy = Object.keys(migrated.remaining).length > 0 ? migrated.remaining : undefined
            save()
          }
          return
        }
        state.migrating = true
        for (const [name, value] of Object.entries(migrated.override)) {
          setModelStore("variant", variantKey(name), value)
        }
        void sdk.client.global.config
          .update({ config: { agent: migrated.cfg } }, { throwOnError: true })
          .then(() => {
            state.legacy = Object.keys(migrated.remaining).length > 0 ? migrated.remaining : undefined
            save()
          })
          .catch(() => undefined)
          .finally(() => {
            state.migrating = false
          })
      })
      // kilocode_change end

      return {
        current: currentModel,
        get ready() {
          return modelStore.ready
        },
        // kilocode_change start - expose persisted per-agent pick separately from overrides
        saved(name: string) {
          return modelStore.model[name]
        },
        // kilocode_change end
        // kilocode_change start - resolve once all queued writes (atomic write+rename) have settled.
        // Used by tests to deterministically await the writer chain instead of sleeping for a fixed
        // duration, which is too slow on Windows CI where temp-file rename can exceed 50ms under AV.
        async flush() {
          const deadline = Date.now() + 5000
          while (state.pending && Date.now() < deadline) await new Promise((r) => setTimeout(r, 0))
          await state.writer
        },
        // kilocode_change end
        recent() {
          return modelStore.recent
        },
        favorite() {
          return modelStore.favorite
        },
        parsed: createMemo(() => {
          const value = currentModel()
          if (!value) {
            return {
              provider: "Connect a provider",
              model: "No provider selected",
              reasoning: false,
            }
          }
          const provider = sync.data.provider.find((x) => x.id === value.providerID)
          const info = provider?.models[value.modelID]
          return {
            provider: provider?.name ?? value.providerID,
            model: info?.name ?? value.modelID,
            reasoning: info?.capabilities?.reasoning ?? false,
          }
        }),
        cycle(direction: 1 | -1) {
          const current = currentModel()
          if (!current) return
          const recent = modelStore.recent
          const index = recent.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          if (index === -1) return
          let next = index + direction
          if (next < 0) next = recent.length - 1
          if (next >= recent.length) next = 0
          const val = recent[next]
          if (!val) return
          const a = agent.current()
          if (!a) return
          apply(a.name, val, !a.model) // kilocode_change
          save() // kilocode_change
        },
        cycleFavorite(direction: 1 | -1) {
          const favorites = modelStore.favorite.filter((item) => isModelValid(item))
          if (!favorites.length) {
            toast.show({
              variant: "info",
              message: "Add a favorite model to use this shortcut",
              duration: 3000,
            })
            return
          }
          const current = currentModel()
          let index = -1
          if (current) {
            index = favorites.findIndex((x) => x.providerID === current.providerID && x.modelID === current.modelID)
          }
          if (index === -1) {
            index = direction === 1 ? 0 : favorites.length - 1
          } else {
            index += direction
            if (index < 0) index = favorites.length - 1
            if (index >= favorites.length) index = 0
          }
          const next = favorites[index]
          if (!next) return
          const a = agent.current()
          if (!a) return
          apply(a.name, next, !a.model) // kilocode_change
          const uniq = uniqueBy([next, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
          if (uniq.length > 10) uniq.pop()
          setModelStore(
            "recent",
            uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
          )
          save()
        },
        set(model: { providerID: string; modelID: string }, options?: { recent?: boolean }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const a = agent.current()
            if (!a) return
            apply(a.name, model, !a.model) // kilocode_change
            if (options?.recent) {
              const uniq = uniqueBy([model, ...modelStore.recent], (x) => `${x.providerID}/${x.modelID}`)
              if (uniq.length > 10) uniq.pop()
              setModelStore(
                "recent",
                uniq.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
              )
            }
            save() // kilocode_change
          })
        },
        toggleFavorite(model: { providerID: string; modelID: string }) {
          batch(() => {
            if (!isModelValid(model)) {
              toast.show({
                message: `Model ${model.providerID}/${model.modelID} is not valid`,
                variant: "warning",
                duration: 3000,
              })
              return
            }
            const exists = modelStore.favorite.some(
              (x) => x.providerID === model.providerID && x.modelID === model.modelID,
            )
            const next = exists
              ? modelStore.favorite.filter((x) => x.providerID !== model.providerID || x.modelID !== model.modelID)
              : [model, ...modelStore.favorite]
            setModelStore(
              "favorite",
              next.map((x) => ({ providerID: x.providerID, modelID: x.modelID })),
            )
            save()
          })
        },
        variant: {
          selected() {
            const a = agent.current()
            const m = currentModel()
            if (!a || !m) return undefined
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            const same = !a.model || (a.model.providerID === m.providerID && a.model.modelID === m.modelID)
            return resolveSelectedVariant({
              override: modelStore.variant[variantKey(a.name)],
              config:
                a.variant === "default" && same
                  ? "default"
                  : resolveAgentVariant({
                      current: m,
                      config: a.model,
                      variant: a.variant,
                      variants: info?.variants,
                    }),
              variants: info?.variants,
            })
          },
          current() {
            const v = this.selected()
            if (!v || v === "default") return undefined
            return v
          },
          list() {
            const m = currentModel()
            if (!m) return []
            const provider = sync.data.provider.find((x) => x.id === m.providerID)
            const info = provider?.models[m.modelID]
            if (!info?.variants) return []
            return Object.keys(info.variants)
          },
          set(value: string | undefined) {
            const a = agent.current()
            const m = currentModel()
            if (!a || !m) return
            setModelStore("variant", variantKey(a.name), value ?? "default")
            void sdk.client.global.config
              .update({
                config: {
                  agent: {
                    [a.name]: {
                      variant: value ?? "default",
                    },
                  },
                },
              }, { throwOnError: true }) // kilocode_change
              .catch(() => {
                toast.show({
                  message: `Failed to save variant for ${a.name}`,
                  variant: "warning",
                  duration: 3000,
                })
              })
          },
          sync(value: string | undefined) {
            const a = agent.current()
            const m = currentModel()
            if (!a || !m) return
            setModelStore("variant", variantKey(a.name), value)
          },
          cycle() {
            const variants = this.list()
            if (variants.length === 0) return
            const current = this.current()
            if (!current) {
              this.set(variants[0])
              return
            }
            const index = variants.indexOf(current)
            if (index === -1 || index === variants.length - 1) {
              this.set(undefined)
              return
            }
            this.set(variants[index + 1])
          },
        },
      }
    })

    const session = iife(() => {
      const [sessionStore, setSessionStore] = createStore<{
        ready: boolean
        pinned: string[]
      }>({
        ready: false,
        pinned: [],
      })

      const filePath = path.join(Global.Path.state, "session.json")
      const state = {
        pending: false,
      }

      function save() {
        if (!sessionStore.ready) {
          state.pending = true
          return
        }
        state.pending = false
        void Filesystem.writeJson(filePath, {
          pinned: sessionStore.pinned,
        })
      }

      Filesystem.readJson(filePath)
        .then((x: any) => {
          if (Array.isArray(x.pinned)) setSessionStore("pinned", x.pinned)
        })
        .catch(() => {})
        .finally(() => {
          setSessionStore("ready", true)
          if (state.pending) save()
        })

      const route = useRoute()
      const event = useEvent()

      const slots = createMemo(() => {
        const existing = new Set(sync.data.session.filter((x) => x.parentID === undefined).map((x) => x.id))
        return sessionStore.pinned.filter((id) => existing.has(id)).slice(0, 9)
      })

      function prune(sessionID: string) {
        batch(() => {
          if (sessionStore.pinned.includes(sessionID)) {
            setSessionStore(
              "pinned",
              sessionStore.pinned.filter((x) => x !== sessionID),
            )
          }
          save()
        })
      }

      event.onSync("session.deleted.1", (evt) => {
        prune(evt.data.sessionID)
      })

      return {
        get ready() {
          return sessionStore.ready
        },
        pinned() {
          return sessionStore.pinned
        },
        slots,
        isPinned(sessionID: string) {
          return sessionStore.pinned.includes(sessionID)
        },
        togglePin(sessionID: string) {
          batch(() => {
            const exists = sessionStore.pinned.includes(sessionID)
            const next = exists
              ? sessionStore.pinned.filter((x) => x !== sessionID)
              : [...sessionStore.pinned, sessionID]
            setSessionStore("pinned", next)
            save()
          })
        },
        quickSwitch(slot: number) {
          const target = slots()[slot - 1]
          if (!target) return
          if (route.data.type === "session" && route.data.sessionID === target) return
          route.navigate({ type: "session", sessionID: target })
        },
      }
    })

    const mcp = {
      isEnabled(name: string) {
        const status = sync.data.mcp[name]
        return status?.status === "connected"
      },
      async toggle(name: string) {
        const status = sync.data.mcp[name]
        if (status?.status === "connected") {
          // Disable: disconnect the MCP
          await sdk.client.mcp.disconnect({ name })
        } else {
          // Enable/Retry: connect the MCP (handles disabled, failed, and other states)
          await sdk.client.mcp.connect({ name })
        }
      },
    }

    createEffect(() => {
      // kilocode_change start - configured models resolve directly without persistence
      if (!model.ready) return
      const value = agent.current()
      if (!value?.model) return
      if (isModelValid(value.model)) return
      toast.show({
        variant: "warning",
        message: `Agent ${value.name}'s configured model ${value.model.providerID}/${value.model.modelID} is not valid`,
        duration: 3000,
      })
    })
    // kilocode_change end

    const result = {
      model,
      agent,
      mcp,
      session,
    }
    return result
  },
})
