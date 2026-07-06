import { A, useLocation, useParams } from "@solidjs/router"
import { createMemo, For } from "solid-js"
import { Icon } from "@kilocode/kilo-web-ui/icon"
import { configNav, type ConfigGroup, type ConfigNode } from "./sections"
import { friendly } from "../../shared/utils"
import { settings, strip } from "../../shared/navigation"
import { useConfig } from "../../context/config"

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Project"
}

export function ConfigSidebar() {
  const loc = useLocation()
  const params = useParams()
  const ctx = useConfig()
  const route = createMemo(() => strip(loc.pathname))
  const project = createMemo(() => route().startsWith("/projects/"))
  const scope = createMemo(() => {
    if (!project()) return "Global"
    const dir = ctx.query()?.dir
    if (dir) return friendly(repo(dir))
    return friendly(decodeURIComponent(params.project ?? "Project"))
  })
  const base = createMemo(() => settings(route()))
  const active = createMemo(() => {
    const rest = route().slice(base().length)
    if (rest === "/models") return "/models/default"
    return rest || "/"
  })
  const href = (path: string) => `${path === "/" ? base() : `${base()}${path}`}${loc.search}`
  const current = (path: string) => path === active() || (path !== "/" && active().startsWith(`${path}/`))
  const group = (item: ConfigNode): item is ConfigGroup => "items" in item
  const navigation = createMemo(() => configNav.filter((item) => !project() || !group(item) || !item.globalOnly))

  return (
    <aside class="config-sidebar" aria-label="Configuration sections">
      <div class="config-sidebar-title">
        <span>Settings</span>
        <span class="config-sidebar-scope">
          <span>{scope()}</span>
        </span>
      </div>
      <nav class="config-options">
        <For each={navigation()}>
          {(item) => {
            if (!group(item)) {
              return (
                <A class="config-top-option" classList={{ active: current(item.path) }} href={href(item.path)}>
                  <Icon name={item.icon} size="small" />
                  <span>{item.label}</span>
                </A>
              )
            }

            return (
              <section class="config-group">
                <div class="config-group-title">
                  <span>{item.label}</span>
                </div>
                <div id={`config-group-${item.id}`} class="config-group-items">
                  <For each={item.items}>
                    {(child) => (
                      <A class="config-option" classList={{ active: current(child.path) }} href={href(child.path)}>
                        <Icon name={child.icon} size="small" />
                        <span>{child.label}</span>
                      </A>
                    )}
                  </For>
                </div>
              </section>
            )
          }}
        </For>
      </nav>
    </aside>
  )
}
