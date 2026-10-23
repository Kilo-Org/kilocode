// Kilo Gateway news on the home screen, as in v1 (`kilocode/plugins/home-news.tsx`, `components/kilo-news.tsx`,
// `notification-banner.tsx` and `dialog-kilo-notifications.tsx`). The `kilocode.gateway` plugin fetches the
// notifications for the active account and team; signed out, it returns none.
import { TextAttributes } from "@opentui/core"
import { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
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
    context.ui.slot({
      before: "home.footer",
      render: () => (
        <box width="100%" alignItems="center" paddingLeft={2} paddingRight={2}>
          <box width="100%" maxWidth={75}>
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
  const load = () => {
    const location = props.context.location ?? props.context.data.location.default()
    rpc.notifications({}, { location: { directory: location.directory } }).then(
      (list) => setItems(list.filter((item) => !item.showIn || item.showIn.includes("cli"))),
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

  // The fixed-height fallback keeps the prompt from moving when the news arrives.
  return (
    <Show when={unread()[0]} fallback={<box height={3} />}>
      {(first) => (
        <box
          flexDirection="column"
          paddingTop={1}
          backgroundColor={hover() ? theme().background.action.primary.hovered : undefined}
          onMouseOver={() => setHover(true)}
          onMouseOut={() => setHover(false)}
          onMouseUp={open}
        >
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme().text.feedback.info.base}>
              ●
            </text>
            <text wrapMode="none" fg={theme().text.base}>
              {first().title}
            </text>
            <Show when={unread().length > 1}>
              <text flexShrink={0} fg={theme().text.muted}>
                ({unread().length} new)
              </text>
            </Show>
          </box>
          <box paddingLeft={2}>
            <text fg={theme().text.muted} wrapMode="word">
              {first().message}
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}

function DialogKiloNotifications(props: { notifications: readonly Notification[] }) {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "return", title: "Close news", group: "Dialog", run: () => dialog.clear() }],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="News" />}
      footer={{ actions: { primary: [{ title: "close", key: "enter", onTrigger: () => dialog.clear() }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={theme.text.action.primary.focused}>close</text>
          </box>
        </box>
      }
    >
      <scrollbox maxHeight={15}>
        <box gap={1}>
          <For each={props.notifications}>
            {(notification) => (
              <box>
                <text attributes={TextAttributes.BOLD} fg={theme.text.base}>
                  {notification.title}
                </text>
                <text fg={theme.text.muted} wrapMode="word">
                  {notification.message}
                </text>
                <Show when={notification.action}>
                  {(action) => (
                    <Link href={action().actionURL} fg={theme.text.action.primary.selected}>
                      [{action().actionText}]
                    </Link>
                  )}
                </Show>
              </box>
            )}
          </For>
        </box>
      </scrollbox>
    </DialogLayout>
  )
}
