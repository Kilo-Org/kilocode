import { For, Show } from "solid-js"
import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import { IconButton } from "@kilocode/kilo-web-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-web-ui/provider-icon"
import { StatusTag } from "@kilocode/kilo-web-ui/status-tag"
import { ConfirmDialog } from "../../components/ConfirmDialog"
import { CustomSelect } from "../../components/CustomSelect"
import { SearchField } from "../../components/SearchField"
import { ConfigCountTag as CountTag, ConfigPage, SourceBadge } from "./ConfigPage"
import { useProviderSettings } from "./state/providers"

export function ProvidersRoute() {
  const state = useProviderSettings()
  const project = () => state.ctx.query()?.scope === "project"

  return (
    <Show when={state.snap()}>
      {(data) => (
        <ConfigPage
          title={
            <span class="config-title-count">
              Providers
              <CountTag>{state.configured().length}</CountTag>
            </span>
          }
          description="Credentials and endpoints for upstream model providers. Each provider exposes one or more models."
          actions={
            <>
              <Button
                icon="plus"
                variant="primary"
                disabled={Boolean(state.ctx.saving()) || project()}
                onClick={state.add}
              >
                Add provider
              </Button>
            </>
          }
        >
          <Show when={project()}>
            <Card class="banner" variant="info">
              Providers are global credentials. Project settings show inherited providers as read-only.
            </Card>
          </Show>

          <SearchField
            label="Filter providers"
            value={state.search()}
            placeholder="Filter by name or ID..."
            onValue={state.setSearch}
          />

          <div class="providers">
            <Show when={state.visible().length} fallback={<p class="empty">No providers match this filter.</p>}>
              <For each={state.visible()}>
                {(provider) => (
                  <article class="provider configured-provider" classList={{ inherited: provider.inherited }}>
                    <div class="provider-title">
                      <ProviderIcon id={provider.id} class="provider-icon" />
                      <div>
                        <strong>{provider.name}</strong>
                        <span>{provider.id}</span>
                      </div>
                    </div>
                    <div class="tags">
                      <SourceBadge
                        source={provider.source}
                        inherited={provider.inherited}
                        overridden={provider.overridden}
                      />
                      <span class="provider-model-count">{`${provider.models} ${provider.models === 1 ? "model" : "models"}`}</span>
                      <Show when={data().providers.connected.includes(provider.id)}>
                        <StatusTag status="connected" />
                      </Show>
                      <Show when={data().providers.failed.includes(provider.id)}>
                        <StatusTag status="failed" />
                      </Show>
                    </div>
                    <div class="provider-actions">
                      <IconButton
                        icon="edit"
                        variant="ghost"
                        aria-label={`Edit ${provider.name}`}
                        disabled={Boolean(state.ctx.saving()) || project() || provider.editable === false}
                        onClick={() => state.edit(provider)}
                      />
                      <IconButton
                        icon="trash"
                        variant="ghost"
                        aria-label={`Delete ${provider.name}`}
                        disabled={Boolean(state.ctx.saving()) || project() || provider.editable === false}
                        onClick={() => state.ask(provider)}
                      />
                    </div>
                  </article>
                )}
              </For>
            </Show>
          </div>

          <Show when={state.mode() !== "closed"}>
            <div class="drawer-scrim" onClick={state.close} />
            <aside class="provider-drawer" aria-label="Provider configuration">
              <Show
                when={state.mode() === "form"}
                fallback={
                  <>
                    <header class="drawer-header">
                      <div>
                        <h2>Add provider</h2>
                        <span>Choose a provider, then enter credentials.</span>
                      </div>
                      <Button variant="ghost" aria-label="Close provider overlay" onClick={state.close}>
                        X
                      </Button>
                    </header>
                    <div class="add-provider-body">
                      <section class="add-provider-field">
                        <h3>Choose provider</h3>
                        <SearchField
                          class="drawer-search add-provider-search"
                          label="Filter providers"
                          value={state.filter()}
                          variant="drawer"
                          placeholder="Search by name or ID"
                          onValue={state.setFilter}
                        />
                        <div class="provider-picker add-provider-picker">
                          <Show
                            when={state.available().length}
                            fallback={<p class="empty">No available providers match.</p>}
                          >
                            <For each={state.available()}>
                              {(provider) => (
                                <button
                                  class="provider-option add-provider-option"
                                  classList={{ selected: state.target()?.id === provider.id }}
                                  type="button"
                                  aria-pressed={state.target()?.id === provider.id}
                                  onClick={() => state.choose(provider)}
                                  onDblClick={() => state.pick(provider)}
                                >
                                  <ProviderIcon id={provider.id} class="provider-icon" />
                                  <div>
                                    <strong>{provider.name}</strong>
                                    <span>{provider.id}</span>
                                  </div>
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                      </section>
                      <Card class="add-provider-step" padding={16}>
                        <Show when={state.target()} fallback={<span>Select a provider to enter credentials.</span>}>
                          {(provider) => (
                            <span>
                              Step 2 · enter credentials for <strong>{provider().name}</strong>
                            </span>
                          )}
                        </Show>
                      </Card>
                    </div>
                    <footer class="drawer-footer">
                      <Button variant="ghost" onClick={state.close}>
                        Cancel
                      </Button>
                      <Button variant="primary" disabled={!state.target()} onClick={state.next}>
                        Add provider
                      </Button>
                    </footer>
                  </>
                }
              >
                <header class="drawer-header provider-config-header">
                  <div class="provider-title provider-drawer-title">
                    <ProviderIcon id={state.id() || state.selected()?.id || "synthetic"} class="provider-icon" />
                    <div>
                      <h2>{state.name() || state.selected()?.name || state.id() || "Provider"}</h2>
                      <span>{state.id() || "New provider"}</span>
                    </div>
                  </div>
                  <Button variant="ghost" aria-label="Close provider overlay" onClick={state.close}>
                    X
                  </Button>
                </header>

                <Show
                  when={state.auth()}
                  fallback={
                    <>
                      <div class="provider-form">
                        <label class="required-field">
                          Provider ID
                          <input
                            value={state.id()}
                            spellcheck={false}
                            onInput={(event) => state.setId(event.currentTarget.value)}
                          />
                        </label>
                        <label class="required-field">
                          Display name
                          <input value={state.name()} onInput={(event) => state.setName(event.currentTarget.value)} />
                        </label>
                        <label class="optional-field">
                          Environment variables
                          <input
                            value={state.env()}
                            placeholder="ANTHROPIC_API_KEY, OPENAI_API_KEY"
                            spellcheck={false}
                            onInput={(event) => state.setEnv(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          API key
                          <input
                            value={state.apiKey()}
                            placeholder="sk-... or {env:PROVIDER_API_KEY}"
                            spellcheck={false}
                            onInput={(event) => state.setApiKey(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          Base URL
                          <input
                            value={state.baseURL()}
                            placeholder="https://api.example.com/v1"
                            spellcheck={false}
                            onInput={(event) => state.setBaseURL(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          NPM package
                          <input
                            value={state.npm()}
                            placeholder="@ai-sdk/openai-compatible"
                            spellcheck={false}
                            onInput={(event) => state.setNpm(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          API identifier
                          <input
                            value={state.api()}
                            placeholder="openai-compatible"
                            spellcheck={false}
                            onInput={(event) => state.setApi(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          Model whitelist
                          <input
                            value={state.whitelist()}
                            placeholder="model-a, model-b"
                            spellcheck={false}
                            onInput={(event) => state.setWhitelist(event.currentTarget.value)}
                          />
                        </label>
                        <label class="optional-field">
                          Model blacklist
                          <input
                            value={state.blacklist()}
                            placeholder="model-a, model-b"
                            spellcheck={false}
                            onInput={(event) => state.setBlacklist(event.currentTarget.value)}
                          />
                        </label>
                        <label class="wide optional-field">
                          Extra options JSON
                          <textarea
                            value={state.options()}
                            spellcheck={false}
                            placeholder={'{\n  "timeout": 300000\n}'}
                            onInput={(event) => state.setOptions(event.currentTarget.value)}
                          />
                        </label>
                        <label class="wide optional-field">
                          Model overrides JSON
                          <textarea
                            value={state.models()}
                            spellcheck={false}
                            placeholder={'{\n  "model-id": { "name": "Model Name" }\n}'}
                            onInput={(event) => state.setModels(event.currentTarget.value)}
                          />
                        </label>
                      </div>

                      <footer class="drawer-footer">
                        <Button variant="ghost" onClick={state.close}>
                          Cancel
                        </Button>
                        <Button variant="primary" disabled={Boolean(state.ctx.saving())} onClick={state.save}>
                          Save Provider
                        </Button>
                      </footer>
                    </>
                  }
                >
                  <div class="provider-auth">
                    <Show when={state.methods().length > 1 && state.methodIndex() === undefined}>
                      <p>Select how to connect {state.name() || state.id()}.</p>
                      <div class="auth-methods">
                        <For each={state.methods()}>
                          {(method, index) => (
                            <Button variant="secondary" onClick={() => state.selectMethod(index())}>
                              {method.label}
                            </Button>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={state.phase() === "authorizing"}>
                      <p>Preparing authorization...</p>
                    </Show>

                    <Show when={state.method()?.type === "api"}>
                      <p>
                        Connect {state.name() || state.id()} with an API key. Extra fields are provided by the server.
                      </p>
                      <label>
                        API key
                        <input
                          type="password"
                          value={state.authKey()}
                          placeholder="Paste API key"
                          autocomplete="off"
                          spellcheck={false}
                          classList={{ invalid: state.authField() === "apiKey" }}
                          onInput={(event) => state.setAuthKey(event.currentTarget.value)}
                        />
                      </label>
                      <For each={state.prompts()}>
                        {(prompt) => (
                          <label>
                            {prompt.message}
                            <Show
                              when={prompt.type === "select"}
                              fallback={
                                <input
                                  value={state.fields()[prompt.key] ?? ""}
                                  placeholder={prompt.type === "text" ? prompt.placeholder : undefined}
                                  classList={{ invalid: state.authField() === prompt.key }}
                                  onInput={(event) => state.setField(prompt.key, event.currentTarget.value)}
                                />
                              }
                            >
                              <CustomSelect
                                label={prompt.message}
                                value={state.fields()[prompt.key] ?? ""}
                                options={
                                  prompt.type === "select"
                                    ? [
                                        { value: "", label: "Select an option" },
                                        ...prompt.options.map((option) => ({
                                          value: option.value,
                                          label: option.hint ? `${option.label} (${option.hint})` : option.label,
                                        })),
                                      ]
                                    : []
                                }
                                invalid={state.authField() === prompt.key}
                                onSelect={(value) => state.setField(prompt.key, value)}
                              />
                            </Show>
                          </label>
                        )}
                      </For>
                    </Show>

                    <Show when={state.authorization()?.method === "code"}>
                      <p>Open the authorization page and paste the code returned by {state.name() || state.id()}.</p>
                      <a href={state.authorization()?.url ?? "#"} target="_blank" rel="noreferrer">
                        Open authorization page
                      </a>
                      <label>
                        Authorization code
                        <input
                          value={state.authCode()}
                          placeholder="Paste authorization code"
                          classList={{ invalid: state.authField() === "code" }}
                          onInput={(event) => state.setAuthCode(event.currentTarget.value)}
                        />
                      </label>
                    </Show>

                    <Show when={state.authorization()?.method === "auto"}>
                      <p>
                        Complete authorization in the browser window. This page will refresh once the provider is
                        connected.
                      </p>
                      <Show when={state.authorization()?.instructions}>{(text) => <code>{text()}</code>}</Show>
                    </Show>

                    <Show when={state.authError()}>{(message) => <p class="form-error">{message()}</p>}</Show>
                  </div>

                  <footer class="drawer-footer">
                    <Button variant="ghost" onClick={state.close}>
                      Cancel
                    </Button>
                    <Show when={state.method()?.type === "api"}>
                      <Button variant="primary" disabled={Boolean(state.ctx.saving())} onClick={state.connectAuth}>
                        Save Provider
                      </Button>
                    </Show>
                    <Show when={state.authorization()?.method === "code"}>
                      <Button
                        variant="primary"
                        disabled={Boolean(state.ctx.saving())}
                        onClick={() => state.completeOAuth()}
                      >
                        Save Provider
                      </Button>
                    </Show>
                  </footer>
                </Show>
              </Show>
            </aside>
          </Show>
          <ConfirmDialog
            open={Boolean(state.pending())}
            title={`Delete provider ${state.pending()?.name ?? ""}?`}
            message={`This removes ${state.pending()?.id ?? "the provider"} from the current configuration.`}
            confirm="Delete"
            busy={Boolean(state.ctx.saving())}
            onCancel={state.cancel}
            onConfirm={state.confirm}
          />
        </ConfigPage>
      )}
    </Show>
  )
}
