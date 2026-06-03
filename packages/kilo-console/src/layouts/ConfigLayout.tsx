import { Show } from "solid-js"
import type { JSX } from "solid-js"
import { Card } from "@kilocode/kilo-web-ui/card"
import { LoadingScreen } from "../components/LoadingScreen"
import { ConfigProvider } from "../context/ConfigProvider"
import { useConfig } from "../context/config"
import { ConfigSidebar } from "../routes/config/ConfigSidebar"
import { errMsg } from "../shared/utils"

export function ConfigLayout(props: { children?: JSX.Element }) {
  return (
    <ConfigProvider>
      <ConfigContent>{props.children}</ConfigContent>
    </ConfigProvider>
  )
}

function ConfigContent(props: { children?: JSX.Element }) {
  const ctx = useConfig()

  return (
    <section class="config-shell">
      <ConfigSidebar />
      <section class="content">
        <Show when={ctx.failure()}>
          {(item) => (
            <Card class="banner" variant="error">
              <strong>Dashboard update failed</strong>
              <span>{item()}</span>
            </Card>
          )}
        </Show>
        <Show when={ctx.saving()}>
          {(item) => (
            <Card class="banner" variant="info">
              {item()}...
            </Card>
          )}
        </Show>
        <Show when={ctx.data.error}>
          <Card class="banner" variant="error">
            <strong>Dashboard request failed</strong>
            <span>{errMsg(ctx.data.error)}</span>
          </Card>
        </Show>
        <Show when={ctx.data.loading && !ctx.data()}>
          <LoadingScreen variant="content" />
        </Show>
        {props.children}
      </section>
    </section>
  )
}
