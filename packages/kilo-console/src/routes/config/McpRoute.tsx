import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { StatusTag } from "@kilocode/kilo-web-ui/status-tag"
import { ConfirmDialog } from "../../components/ConfirmDialog"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { SearchField } from "../../components/SearchField"
import { ConfigCountTag as CountTag, ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import { useMcpSettings } from "./state/mcp"

type StatusFilter = "all" | "installed" | "notInstalled"

const statusOptions = [
  { value: "all", label: "All" },
  { value: "installed", label: "Installed" },
  { value: "notInstalled", label: "Not installed" },
] satisfies SelectOption<StatusFilter>[]

const typeOptions = [
  { value: "local", label: "Local command" },
  { value: "remote", label: "Remote URL" },
] satisfies SelectOption<"local" | "remote">[]

const stateOptions = [
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
] satisfies SelectOption<"enabled" | "disabled">[]

export function McpRoute() {
  const state = useMcpSettings()

  return (
    <Show when={state.snap()}>
      {(_data) => (
        <ConfigPage
          title={
            <span class="config-title-count">
              MCP Servers
              <CountTag>{state.rows().length}</CountTag>
            </span>
          }
          description="Install, configure, and manage Model Context Protocol servers available to Kilo agents."
          actions={
            <>
              <Button icon="plus" variant="primary" disabled={Boolean(state.ctx.saving())} onClick={state.openMarket}>
                Install MCP
              </Button>
              <Button variant="secondary" disabled={Boolean(state.ctx.saving())} onClick={state.openManual}>
                Manual server
              </Button>
            </>
          }
        >
          <SearchField
            label="Filter MCP servers"
            value={state.search()}
            placeholder="Filter by name, ID, command, URL, or status..."
            onValue={state.setSearch}
          />

          <div class="providers mcp-servers">
            <Show
              when={state.visible().length}
              fallback={
                <p class="empty">
                  {state.rows().length
                    ? "No MCP servers match this filter."
                    : "No MCP servers configured. Install one from the Marketplace or add a manual server."}
                </p>
              }
            >
              <For each={state.visible()}>
                {(row) => (
                  <article class="provider configured-provider mcp-server" classList={{ inherited: row.inherited }}>
                    <div class="provider-title mcp-title">
                      <div>
                        <strong>{row.name}</strong>
                        <span>{row.id}</span>
                        <em>{row.summary}</em>
                      </div>
                    </div>
                    <div class="tags mcp-server-tags">
                      <SourceBadge source={row.source} inherited={row.inherited} overridden={row.overridden} />
                      <Tag>{row.kind}</Tag>
                      <StatusTag status={row.status?.status ?? (row.enabled ? "configured" : "disabled")} />
                    </div>
                    <div class="provider-actions mcp-server-actions">
                      <Show
                        when={row.status?.status === "needs_auth" || row.status?.status === "needs_client_registration"}
                      >
                        <Button
                          variant="secondary"
                          disabled={Boolean(state.ctx.saving())}
                          onClick={() => state.authenticate(row)}
                        >
                          Authenticate
                        </Button>
                      </Show>
                      <Show when={row.status?.status === "connected"}>
                        <Button
                          variant="secondary"
                          disabled={Boolean(state.ctx.saving())}
                          onClick={() => state.disconnect(row)}
                        >
                          Disconnect
                        </Button>
                      </Show>
                      <Show when={row.status?.status === "disabled" && row.enabled}>
                        <Button
                          variant="secondary"
                          disabled={Boolean(state.ctx.saving())}
                          onClick={() => state.connect(row)}
                        >
                          Connect
                        </Button>
                      </Show>
                      <Button
                        variant="secondary"
                        disabled={Boolean(state.ctx.saving())}
                        onClick={() => state.toggle(row)}
                      >
                        {row.enabled ? "Disable" : "Enable"}
                      </Button>
                      <IconButton
                        icon="edit"
                        variant="ghost"
                        aria-label={`Configure ${row.name}`}
                        disabled={Boolean(state.ctx.saving()) || row.editable === false || !row.config}
                        onClick={() => state.edit(row)}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        aria-label={`${row.revert ? "Revert" : "Delete"} ${row.name}`}
                        disabled={Boolean(state.ctx.saving()) || !row.path || (row.inherited && !row.overridden)}
                        onClick={() => state.ask(row)}
                      />
                    </div>
                    <Show when={row.status?.status === "failed" || row.status?.status === "needs_client_registration"}>
                      <p class="mcp-server-error">
                        {row.status && "error" in row.status ? row.status.error : "Authentication setup is required."}
                      </p>
                    </Show>
                  </article>
                )}
              </For>
            </Show>
          </div>

          <Show when={state.mode() === "market"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer mcp-drawer" aria-label="Install MCP server">
              <header class="drawer-header">
                <div>
                  <h2>Install MCP server</h2>
                  <span>Browse the Kilo Marketplace MCP catalog and install into the current settings scope.</span>
                </div>
                <Button variant="ghost" aria-label="Close MCP marketplace overlay" onClick={state.close}>
                  X
                </Button>
              </header>
              <div class="mcp-market-body">
                <div class="mcp-market-filters">
                  <SearchField
                    class="drawer-search mcp-market-search"
                    label="Filter marketplace MCP servers"
                    value={state.filter()}
                    variant="drawer"
                    placeholder="Search marketplace by name, ID, author, or description..."
                    onValue={state.setFilter}
                  />
                  <div class="mcp-status-filter">
                    <span>Status</span>
                    <CustomSelect
                      label="Status filter"
                      value={state.status()}
                      options={statusOptions}
                      class="mcp-status-select"
                      onSelect={state.setStatus}
                    />
                  </div>
                </div>

                <Show when={state.tags().length}>
                  <div class="mcp-tag-filters">
                    <For each={state.tags()}>
                      {(tag) => (
                        <button
                          class="mcp-tag-filter"
                          classList={{ active: state.picked().includes(tag) }}
                          type="button"
                          onClick={() => state.toggleTag(tag)}
                        >
                          <Tag>{tag}</Tag>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>

                <Show when={state.marketError()}>
                  {(message) => (
                    <Card class="banner" variant="info">
                      Marketplace catalog could not be loaded: {message()}
                    </Card>
                  )}
                </Show>

                <Show when={!state.catalog.loading} fallback={<p class="empty">Loading marketplace MCP servers...</p>}>
                  <Show
                    when={state.marketVisible().length}
                    fallback={<p class="empty">No marketplace MCP servers match this filter.</p>}
                  >
                    <div class="mcp-market-grid">
                      <For each={state.marketVisible()}>
                        {(item) => (
                          <article class="mcp-market-card">
                            <div class="mcp-market-card-head">
                              <div>
                                <strong>{item.name}</strong>
                                <Show when={item.author}>
                                  {(author) => <span class="mcp-market-author">by {author()}</span>}
                                </Show>
                                <span class="mcp-market-id">{item.id}</span>
                              </div>
                              <Show when={state.installed().has(item.id)}>
                                <Tag tone="success">Installed</Tag>
                              </Show>
                            </div>
                            <p>{item.description}</p>
                            <div class="tags mcp-market-card-tags">
                              <For each={item.tags ?? []}>{(tag) => <Tag>{tag}</Tag>}</For>
                            </div>
                            <div class="mcp-market-card-footer">
                              <div>
                                <Show when={item.url}>
                                  {(url) => (
                                    <a href={url()} target="_blank" rel="noreferrer">
                                      Source
                                    </a>
                                  )}
                                </Show>
                                <Button
                                  variant="primary"
                                  disabled={Boolean(state.ctx.saving()) || state.installed().has(item.id)}
                                  onClick={() => state.openInstall(item)}
                                >
                                  Install
                                </Button>
                              </div>
                            </div>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </aside>
          </Show>

          <Show when={state.mode() === "install" && state.choice()}>
            {(item) => (
              <>
                <div class="drawer-scrim" onClick={state.close} />
                <aside class="provider-drawer mcp-drawer" aria-label="MCP install parameters">
                  <header class="drawer-header">
                    <div>
                      <h2>{item().name}</h2>
                      <span>{item().id}</span>
                    </div>
                    <Button variant="ghost" aria-label="Close MCP install overlay" onClick={state.close}>
                      X
                    </Button>
                  </header>
                  <div class="provider-auth mcp-install-form">
                    <p>{item().description}</p>
                    <Show when={state.methods().length > 1}>
                      <label>
                        Installation method
                        <CustomSelect
                          label="Installation method"
                          value={state.methodName()}
                          options={state.methods().map((method) => ({ value: method.name, label: method.name }))}
                          onSelect={state.setMethodName}
                        />
                      </label>
                    </Show>
                    <Show when={state.prerequisites().length}>
                      <section class="mcp-install-section">
                        <span>Prerequisites</span>
                        <ul>
                          <For each={state.prerequisites()}>{(item) => <li>{item}</li>}</For>
                        </ul>
                      </section>
                    </Show>
                    <Show
                      when={state.parameters().length}
                      fallback={<p>No parameters are required for this server.</p>}
                    >
                      <section class="mcp-install-section">
                        <span>Parameters</span>
                        <For each={state.parameters()}>
                          {(param) => (
                            <label classList={{ "required-field": !param.optional }}>
                              {param.name}
                              {param.optional ? " (optional)" : ""}
                              <input
                                value={state.params()[param.key] ?? ""}
                                placeholder={param.placeholder ?? param.key}
                                spellcheck={false}
                                onInput={(event) => state.setParam(param.key, event.currentTarget.value)}
                              />
                            </label>
                          )}
                        </For>
                      </section>
                    </Show>
                  </div>
                  <footer class="drawer-footer">
                    <Button variant="ghost" onClick={state.openMarket}>
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      disabled={Boolean(state.ctx.saving()) || !state.valid()}
                      onClick={state.install}
                    >
                      Install MCP
                    </Button>
                  </footer>
                </aside>
              </>
            )}
          </Show>

          <Show when={state.mode() === "config"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer mcp-drawer" aria-label="MCP server configuration">
              <header class="drawer-header">
                <div>
                  <h2>{state.editing() ? "Configure MCP server" : "Add manual MCP server"}</h2>
                  <span>{state.editing() ?? "New MCP server"}</span>
                </div>
                <Button variant="ghost" aria-label="Close MCP configuration overlay" onClick={state.close}>
                  X
                </Button>
              </header>

              <div class="provider-form mcp-config-form">
                <label class="required-field">
                  Server ID
                  <input
                    value={state.id()}
                    disabled={Boolean(state.editing())}
                    spellcheck={false}
                    placeholder="github"
                    onInput={(event) => state.setId(event.currentTarget.value)}
                  />
                </label>
                <label class="required-field">
                  Type
                  <CustomSelect
                    label="MCP server type"
                    value={state.type()}
                    options={typeOptions}
                    class="mcp-config-select"
                    onSelect={state.setType}
                  />
                </label>
                <label class="optional-field">
                  State
                  <CustomSelect
                    label="MCP server state"
                    value={state.enabled() ? "enabled" : "disabled"}
                    options={stateOptions}
                    class="mcp-config-select"
                    onSelect={(value) => state.setEnabled(value === "enabled")}
                  />
                </label>
                <label class="optional-field">
                  Timeout ms
                  <input
                    value={state.limit()}
                    inputmode="numeric"
                    placeholder="30000"
                    onInput={(event) => state.setLimit(event.currentTarget.value)}
                  />
                </label>
                <Show
                  when={state.type() === "remote"}
                  fallback={
                    <>
                      <label class="wide required-field">
                        Command
                        <input
                          value={state.command()}
                          spellcheck={false}
                          placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                          onInput={(event) => state.setCommand(event.currentTarget.value)}
                        />
                      </label>
                      <label class="wide optional-field">
                        Environment JSON
                        <textarea
                          value={state.env()}
                          spellcheck={false}
                          placeholder={'{\n  "GITHUB_TOKEN": "{env:GITHUB_TOKEN}"\n}'}
                          onInput={(event) => state.setEnv(event.currentTarget.value)}
                        />
                      </label>
                    </>
                  }
                >
                  <>
                    <label class="wide required-field">
                      URL
                      <input
                        value={state.url()}
                        spellcheck={false}
                        placeholder="https://mcp.example.com"
                        onInput={(event) => state.setUrl(event.currentTarget.value)}
                      />
                    </label>
                    <label class="wide optional-field">
                      Headers JSON
                      <textarea
                        value={state.headers()}
                        spellcheck={false}
                        placeholder={'{\n  "Authorization": "Bearer {env:MCP_TOKEN}"\n}'}
                        onInput={(event) => state.setHeaders(event.currentTarget.value)}
                      />
                    </label>
                    <label class="wide optional-field">
                      OAuth JSON or false
                      <textarea
                        value={state.auth()}
                        spellcheck={false}
                        placeholder={'{\n  "clientId": "...",\n  "scope": "read"\n}'}
                        onInput={(event) => state.setAuth(event.currentTarget.value)}
                      />
                    </label>
                  </>
                </Show>
              </div>

              <footer class="drawer-footer">
                <Button variant="ghost" onClick={state.close}>
                  Cancel
                </Button>
                <Button variant="primary" disabled={Boolean(state.ctx.saving())} onClick={state.save}>
                  Save MCP
                </Button>
              </footer>
            </aside>
          </Show>

          <ConfirmDialog
            open={Boolean(state.pending())}
            title={`${state.pending()?.revert ? "Revert" : "Delete"} MCP server ${state.pending()?.name ?? ""}?`}
            message={
              state.pending()?.revert
                ? `This removes the current-scope override for ${state.pending()?.id ?? "the MCP server"}.`
                : `This removes ${state.pending()?.id ?? "the MCP server"} from the current configuration.`
            }
            confirm={state.pending()?.revert ? "Revert" : "Delete"}
            busy={Boolean(state.ctx.saving())}
            onCancel={state.cancel}
            onConfirm={state.confirm}
          />
        </ConfigPage>
      )}
    </Show>
  )
}
