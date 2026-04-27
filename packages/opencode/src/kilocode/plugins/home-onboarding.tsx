import type { TuiPlugin, TuiPluginModule } from "@kilocode/plugin/tui"
import { createMemo, Show } from "solid-js"
import { Tips } from "@/kilocode/components/tips"

const id = "internal:home-onboarding"

const ONBOARDING_TIP = "Using a free model \u2014 run {highlight}/connect{/highlight} to add your API key"

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 99,
    slots: {
      home_bottom() {
        const hidden = createMemo(() => api.kv.get("tips_hidden", false))
        const first = createMemo(() => api.state.session.count() === 0)
        const connected = createMemo(() =>
          api.state.provider.some(
            (x) => (x.id !== "opencode" && x.id !== "kilo") || Object.values(x.models).some((y) => y.cost?.input !== 0),
          ),
        )
        const onboarding = createMemo(() => first() && !connected())
        const show = createMemo(() => onboarding() && !hidden())
        return (
          <Show when={show()}>
            <box height={4} minHeight={0} width="100%" maxWidth={75} alignItems="center" paddingTop={3} flexShrink={1}>
              <Tips tip={ONBOARDING_TIP} />
            </box>
          </Show>
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
