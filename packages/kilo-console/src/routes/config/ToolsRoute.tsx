import { createMemo, createSignal, For, Show } from "solid-js"
import { ConfigRow, SectionTitle, StatusTag } from "@kilocode/kilo-web-ui/console"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { SearchField } from "../../components/SearchField"
import { useConfig } from "../../context/config"
import { toolCapabilities, toolName } from "../../shared/utils"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"

export function ToolsRoute() {
  const ctx = useConfig()
  const [search, setSearch] = createSignal("")
  const snap = () => ctx.data()
  const websearch = createMemo(() => snap()?.overlay.fields["experimental.websearch"])
  const searchEnabled = createMemo(() => websearch()?.value === true)
  const rows = createMemo(() => {
    const data = snap()
    if (!data) return []
    const details = new Map(data.toolDetails.map((item) => [item.id, item]))
    return data.tools
      .map((id) => {
        const item = { id, detail: details.get(id) }
        return { ...item, caps: toolCapabilities(item) }
      })
      .sort((a, b) => toolName(a.id).localeCompare(toolName(b.id)))
  })
  const visible = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return rows()
    return rows().filter((tool) => `${toolName(tool.id)} ${tool.id} ${tool.caps.join(" ")}`.toLowerCase().includes(q))
  })
  const servers = createMemo(() => {
    const data = snap()
    if (!data) return []
    return Object.entries(data.mcp).sort(([a], [b]) => a.localeCompare(b))
  })
  const visibleServers = createMemo(() => {
    const q = search().trim().toLowerCase()
    if (!q) return servers()
    return servers().filter(([name, status]) => `${name} ${status.status}`.toLowerCase().includes(q))
  })
  const empty = createMemo(() => {
    if (!rows().length) return "No tools registered."
    return "No tools match this filter."
  })

  return (
    <Show when={snap()}>
      {(data) => (
        <ConfigPage
          title={
            <span class="config-title-count">
              Tools
              <CountTag>{data().tools.length}</CountTag>
            </span>
          }
          description="Built-in tools available to agents, including file access, terminal execution, search, fetch, and orchestration tools."
        >
          <Card class="ui-card" padding={0}>
            <header class="ui-card-header">
              <div>
                <h2>Web search</h2>
                <p>Control web search availability for models from providers that do not enable it by default.</p>
              </div>
              <Show when={ctx.query()?.scope === "project" && websearch()?.overridden}>
                <Button
                  variant="secondary"
                  disabled={Boolean(ctx.saving())}
                  onClick={() => ctx.unset([["experimental", "websearch"]])}
                >
                  Revert
                </Button>
              </Show>
            </header>
            <div class="ui-form">
              <button
                class="ui-toggle"
                classList={{ selected: searchEnabled() }}
                type="button"
                aria-pressed={searchEnabled()}
                disabled={Boolean(ctx.saving()) || websearch()?.editable === false}
                onClick={() => ctx.save({ experimental: { websearch: !searchEnabled() } })}
              >
                <span>
                  <strong>Enable for all providers</strong>
                  <small>Search requests connect directly to Exa or Parallel.</small>
                  <Show when={websearch()?.reason}>{(reason) => <small>{reason()}</small>}</Show>
                </span>
                <span class="tags">
                  <SourceBadge
                    source={websearch()?.source}
                    inherited={websearch()?.inherited}
                    overridden={websearch()?.overridden}
                  />
                  <Tag tone={searchEnabled() ? "success" : "neutral"}>{searchEnabled() ? "On" : "Off"}</Tag>
                </span>
              </button>
            </div>
          </Card>

          <SearchField
            label="Filter tools"
            value={search()}
            placeholder="Filter by name, ID, or description..."
            onValue={setSearch}
          />

          <div class="tools tool-grid">
            <Show when={visible().length} fallback={<p class="empty">{empty()}</p>}>
              <For each={visible()}>
                {(tool) => (
                  <ConfigRow
                    title={toolName(tool.id)}
                    subtitle={
                      <span class="tool-subtitle">
                        <span class="tool-id">{tool.id}</span>
                        <span class="tool-description">{tool.caps.join(" ")}</span>
                      </span>
                    }
                  />
                )}
              </For>
            </Show>
          </div>

          <Show when={visibleServers().length}>
            <section class="tool-section">
              <SectionTitle
                trailing={<CountTag>{visibleServers().length}</CountTag>}
                description="MCP server connection status available to agents."
              >
                MCP Servers
              </SectionTitle>
              <div class="tools">
                <For each={visibleServers()}>
                  {([name, status]) => (
                    <ConfigRow title={name} subtitle="MCP server" status={<StatusTag status={status.status} />} />
                  )}
                </For>
              </div>
            </section>
          </Show>
        </ConfigPage>
      )}
    </Show>
  )
}
