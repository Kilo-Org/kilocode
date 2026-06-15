import { For, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { Card } from "@kilocode/kilo-web-ui/card"
import { Banner, StatusDot, StatusTag } from "@kilocode/kilo-web-ui/console"
import { useConfig } from "../../context/config"
import { friendly, size, text } from "../../shared/utils"
import { ConfigPage } from "./ConfigPage"

function repo(input: string) {
  const parts = input.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? "Project"
}

export function OverviewRoute() {
  const ctx = useConfig()
  const params = useParams()

  return (
    <Show when={ctx.data()}>
      {(snap) => (
        <Show when={ctx.query()}>
          {(q) => {
            const cfg = () => snap().effective
            const project = () => q().scope === "project"
            const label = () => {
              if (!project()) return "Global"
              const dir = q().dir
              if (dir) return friendly(repo(dir))
              return friendly(decodeURIComponent(params.project ?? "Project"))
            }
            const desc = () => {
              if (project()) return `Effective configuration for ${label()}. Values inherited from global are marked.`
              return "Effective global configuration. Applies to all projects unless overridden."
            }
            const state = () => (snap().health.healthy ? "healthy" : "unhealthy")
            const rows = () => [
              { label: "Default model", value: text(cfg().model), mono: true },
              { label: "Small model", value: text(cfg().small_model), mono: true },
              { label: "Default agent", value: text(cfg().default_agent), mono: true },
              { label: "Providers", value: String(snap().providers.all.length) },
              { label: "Agents", value: String(size(cfg().agent)) },
              { label: "MCP servers", value: String(size(cfg().mcp)) },
            ]
            const facts = () => [
              { term: "Scope", value: project() ? `Project / ${label()}` : "Global" },
              { term: "Server URL", value: q().url, mono: true },
              { term: "Server version", value: snap().health.version, mono: true },
              { term: "Config directory", value: q().dir || "Server default", mono: !!q().dir },
              { term: "Active project", value: project() ? label() : "None", mono: project() },
              { term: "Default model", value: text(cfg().model), mono: true },
            ]

            return (
              <ConfigPage
                title={
                  <span class="overview-heading">
                    Overview
                    <StatusTag status={state()} />
                  </span>
                }
                description={desc()}
              >
                <section class="server-strip" aria-label="Server status">
                  <div class="server-strip-info">
                    <span>Server</span>
                    <strong class="mono" title={q().url}>
                      {q().url}
                    </strong>
                    <span class="server-strip-separator" aria-hidden="true" />
                    <span>Version</span>
                    <strong class="mono" title={snap().health.version}>
                      {snap().health.version}
                    </strong>
                  </div>
                  <span class="server-strip-state">
                    <StatusDot tone={snap().health.healthy ? "success" : "critical"} />
                    {snap().health.healthy ? "Online" : "Unavailable"}
                  </span>
                </section>

                <section class="metrics" aria-label="Configuration metrics">
                  <For each={rows()}>
                    {(row) => (
                      <Card class="metric" padding={12}>
                        <span>{row.label}</span>
                        <strong classList={{ mono: row.mono }} title={row.value}>
                          {row.value}
                        </strong>
                      </Card>
                    )}
                  </For>
                </section>

                <section class="overview-details">
                  <Card class="panel" padding={0}>
                    <div class="title">
                      <div>
                        <h2>Diagnostics</h2>
                        <p>Where the dashboard is talking to.</p>
                      </div>
                    </div>
                    <dl class="facts">
                      <For each={facts()}>
                        {(row) => (
                          <div>
                            <dt>{row.term}</dt>
                            <dd classList={{ mono: row.mono }} title={row.value}>
                              {row.value}
                            </dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </Card>
                </section>

                <Show when={project()}>
                  <div class="overview-banner">
                    <Banner tone="info">
                      Values shown here are <em>effective</em> for this project. Use the section pages to see where each
                      value comes from.
                    </Banner>
                  </div>
                </Show>
              </ConfigPage>
            )
          }}
        </Show>
      )}
    </Show>
  )
}
