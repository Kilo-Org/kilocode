import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js" // kilocode_change
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import path from "path" // kilocode_change

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [global, setGlobal] = createSignal(true) // kilocode_change - show all worktrees by default

  // kilocode_change start - always fetch from experimental endpoint (returns GlobalSession with worktree info)
  const [searchResults, searchActions] = createResource(
    () => search(),
    async (query) => {
      const result = await sdk.client.experimental.session.list(
        {
          search: query || undefined,
          roots: true,
          worktrees: true,
          limit: 30,
        },
        { throwOnError: true },
      )
      return result.data ?? []
    },
  )
  // kilocode_change end

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  // kilocode_change start - client-side worktree filtering when global is off
  const sessions = createMemo(() => {
    const all = searchResults() ?? []
    if (global()) return all
    const root = sync.data.path.worktree
    if (!root || root === "/") return all
    return all.filter((s) => s.directory === root || s.directory.startsWith(root + path.sep))
  })
  // kilocode_change end

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const all = global() // kilocode_change
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          description: all && x.worktreeName ? `(${x.worktreeName})` : undefined, // kilocode_change - worktree label
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={global() ? "Sessions (all worktrees)" : "Sessions (current worktree)"} // kilocode_change
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              // kilocode_change start
              await sdk.client.session.delete({
                sessionID: option.value,
              })
              // kilocode_change end
              setToDelete(undefined)
              void searchActions.refetch() // kilocode_change
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename", // kilocode_change
          // kilocode_change start
          onTrigger: async (option) => {
            const item = sessions().find((x) => x.id === option.value)
            dialog.replace(() => (
              <DialogSessionRename
                session={option.value}
                title={item?.title}
                onConfirm={() => {
                  void searchActions.refetch()
                }}
              />
            ))
          },
        },
        {
          keybind: { name: "a", ctrl: true, meta: false, shift: false, leader: false },
          title: global() ? "current" : "all",
          onTrigger: async () => {
            setToDelete(undefined)
            setGlobal((v) => !v)
          },
        },
        // kilocode_change end
      ]}
    />
  )
}
