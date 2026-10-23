// Kilo Gateway news on the home screen, as in v1 (`kilocode/plugins/home-news.tsx`, `components/kilo-news.tsx`,
// `notification-banner.tsx` and `dialog-kilo-notifications.tsx`). The `kilocode.gateway` plugin fetches the
// notifications for the active account and team; signed out, it returns none.
import { TextAttributes } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { Link } from "../ui/link"

type Notification = KiloGatewayRpc.Notification

// Events after which the notifications can differ: a login or logout, and a team switch.
const refresh = new Set(["credential.switched", "credential.updated", "rpc.kilocode.gateway.organization"])

export default Plugin.define({
  id: "kilocode.news",
  setup(context) {
    const [store, update] = context.storage.store("news", {
      initial: { read: [] as string[], hidden: false },
    })
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "kilo.news.toggle",
          title: store.hidden ? "Show news" : "Hide news",
          group: "System",
          palette: true,
          enabled: () => context.ui.router.current().type === "home",
          run: () => {
            void update((draft) => {
              draft.hidden = !draft.hidden
            })
            context.ui.dialog.clear()
          },
        },
      ],
    }))
    // Same frame as v1 `home_bottom`: centered below the prompt, at most 75 cells wide, two blank rows above.
    context.ui.slot({
      append: "home.bottom",
      render: () => (
        <box width="100%" maxWidth={75} alignItems="center" paddingTop={2} flexShrink={0}>
          <Show when={!store.hidden}>
            <News
              context={context}
              read={store.read}
              onRead={(ids) =>
                void update((draft) => {
                  draft.read = [...new Set([...draft.read, ...ids])]
                })
              }
            />
          </Show>
        </box>
      ),
    })
  },
})

function News(props: { context: Plugin.Context; read: readonly string[]; onRead: (ids: string[]) => void }) {
  const rpc = props.context.client.rpc(KiloGatewayRpc.Definition)
  const [items, setItems] = createSignal<readonly Notification[]>([])
  const [hover, setHover] = createSignal(false)
  const theme = () => props.context.theme
  const unread = createMemo(() => items().filter((item) => !props.read.includes(item.id)))
  // Only the newest request may update the banner: an older answer can be for the previous account or team.
  let generation = 0
  const load = () => {
    const current = ++generation
    const location = props.context.location ?? props.context.data.location.default()
    rpc.notifications({}, { location: { directory: location.directory } }).then(
      (list) => {
        if (current !== generation) return
        setItems(list.filter((item) => !item.showIn || item.showIn.includes("cli")))
      },
      () => {},
    )
  }
  const open = () => {
    const list = unread()
    if (list.length === 0) return
    props.context.ui.dialog.show(() => <DialogKiloNotifications notifications={list} />)
    props.onRead(list.map((item) => item.id))
  }

  onMount(load)
  onCleanup(props.context.data.listen((event) => refresh.has(event.details.type) && load()))
  onCleanup(() => generation++)

  // v1 `NotificationBanner`. The fixed-height fallback keeps the prompt from moving when the news arrives.
  return (
    <Show when={unread()[0]} fallback={<box height={3} />}>
      {(first) => (
        <box
          flexDirection="column"
          maxWidth="100%"
          backgroundColor={hover() ? theme().background.raised.base : undefined}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={open}
        >
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={hover() ? theme().text.action.primary.selected : theme().text.feedback.info.base}>
              ●
            </text>
            <text wrapMode="none" fg={hover() ? theme().text.action.primary.selected : theme().text.base}>
              {first().title}
            </text>
            <Show when={unread().length > 1}>
              <text flexShrink={0} fg={hover() ? theme().text.action.primary.selected : theme().text.muted}>
                ({unread().length} new)
              </text>
            </Show>
          </box>
          <box paddingLeft={2}>
            <text fg={hover() ? theme().text.base : theme().text.muted} wrapMode="word">
              {first().message}
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}

// v1 `DialogKiloNotifications`: "News" header with esc, one padded row per item, close button.
function DialogKiloNotifications(props: { notifications: readonly Notification[] }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [closeHover, setCloseHover] = createSignal(false)

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "return", title: "Close news", group: "Dialog", run: () => dialog.clear() }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
          News
        </text>
        <box
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={closeHover() ? theme.background.raised.base : undefined}
          onMouseOver={() => setCloseHover(true)}
          onMouseOut={() => setCloseHover(false)}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={closeHover() ? theme.text.base : theme.text.muted}>esc</text>
        </box>
      </box>
      <scrollbox maxHeight={15} flexGrow={1}>
        <box gap={0} paddingBottom={1}>
          <For each={props.notifications}>
            {(notification) => {
              const [hover, setHover] = createSignal(false)
              return (
                <box
                  gap={0}
                  backgroundColor={hover() ? theme.background.raised.base : undefined}
                  paddingTop={1}
                  paddingBottom={1}
                  paddingLeft={2}
                  paddingRight={2}
                  onMouseOver={() => setHover(true)}
                  onMouseOut={() => setHover(false)}
                >
                  <box flexDirection="row" gap={1}>
                    <text fg={hover() ? theme.text.action.primary.selected : theme.text.feedback.info.base}>*</text>
                    <text
                      attributes={TextAttributes.BOLD}
                      fg={hover() ? theme.text.action.primary.selected : theme.text.base}
                    >
                      {notification.title}
                    </text>
                  </box>
                  <box paddingLeft={2}>
                    <text fg={hover() ? theme.text.base : theme.text.muted} wrapMode="word">
                      {notification.message}
                    </text>
                    <Show when={notification.action}>
                      {(action) => (
                        <box flexDirection="row" marginTop={1}>
                          <Link href={action().actionURL} fg={theme.text.action.primary.selected}>
                            [{action().actionText}]
                          </Link>
                        </box>
                      )}
                    </Show>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.background.action.primary.focused}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={theme.text.action.primary.focused}>close</text>
        </box>
      </box>
    </box>
  )
}
