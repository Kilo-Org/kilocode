import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@kilocode/kilo-ui/button"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useLanguage } from "../../context/language"
import type {
  InstallInput,
  MarketplaceItem,
  MarketplaceRecord,
  MarketplaceScope,
} from "../../v2/marketplace-data"
import type { createMcp } from "../../v2/mcp"
import { message } from "../../v2/scope"
import { mergeParameters, optionFor, prerequisitesFor } from "./utils"

const MARKETPLACE_DOCS = "https://kilo.ai/docs/customize/marketplace"
const MCP_DOCS = "https://kilo.ai/docs/automate/mcp/what-is-mcp"

type Preview = { config: string; server: string; parameters: readonly string[]; secrets: readonly string[] }
type Step = "configure" | "review" | "result"
type ServerState = "checking" | "connected" | "needsAuth" | "failed" | "unknown"

interface Props {
  item: MarketplaceItem
  workspace: boolean
  defaultScope?: MarketplaceScope
  /** The method an existing record was installed with, so a repair starts from it. */
  defaultOption?: string
  mcp: ReturnType<typeof createMcp>
  onClose: () => void
  onPreview: (item: MarketplaceItem, input: InstallInput) => Promise<Preview>
  onInstall: (item: MarketplaceItem, input: InstallInput) => Promise<MarketplaceRecord>
  onOpen: (url: string) => void
}

export const InstallModal = (props: Props) => {
  const language = useLanguage()
  const [step, setStep] = createSignal<Step>("configure")
  const [scope, setScope] = createSignal<MarketplaceScope | undefined>(props.defaultScope)
  const [optionName, setOptionName] = createSignal(props.defaultOption ?? props.item.options[0]?.name)
  const [params, setParams] = createSignal<Record<string, string>>({})
  const [preview, setPreview] = createSignal<Preview>()
  const [record, setRecord] = createSignal<MarketplaceRecord>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [serverState, setServerState] = createSignal<ServerState>()
  const [serverError, setServerError] = createSignal<string>()
  const [signing, setSigning] = createSignal(false)
  const [signedIn, setSignedIn] = createSignal(false)

  const isMcp = () => props.item.kind === "mcp"
  const option = createMemo(() => optionFor(props.item, optionName()))
  const parameters = createMemo(() => mergeParameters(props.item, option()))
  const prerequisites = createMemo(() => prerequisitesFor(props.item, option()))
  const scopeOptions = () =>
    props.workspace
      ? [
          { value: "project" as const, label: language.t("marketplace.install.scope.project") },
          { value: "global" as const, label: language.t("marketplace.install.scope.global") },
        ]
      : [{ value: "global" as const, label: language.t("marketplace.install.scope.global") }]
  const currentScope = () => scope() ?? scopeOptions()[0].value
  const valid = () => parameters().every((parameter) => parameter.optional || params()[parameter.key]?.trim())
  const input = (): InstallInput => {
    const values = Object.fromEntries(
      Object.entries(params()).filter(([, value]) => value.trim() !== ""),
    )
    return {
      scope: currentScope(),
      option: option()?.name,
      params: Object.keys(values).length > 0 ? values : undefined,
    }
  }
  const setParam = (key: string, value: string) => setParams((current) => ({ ...current, [key]: value }))
  const reset = () => {
    setPreview(undefined)
    setError(undefined)
    setStep("configure")
  }

  const review = async () => {
    if (!isMcp()) {
      await install()
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setPreview(await props.onPreview(props.item, input()))
      setStep("review")
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const installed = await props.onInstall(props.item, input())
      setRecord(installed)
      setStep("result")
      if (installed.kind === "mcp" && installed.server) void waitForServer(installed.server)
    } catch (failure) {
      setError(message(failure))
    } finally {
      setBusy(false)
    }
  }

  const waitForServer = async (name: string) => {
    setServerState("checking")
    for (let attempt = 0; attempt < 15; attempt++) {
      await props.mcp.sync().catch(() => undefined)
      const status = props.mcp.status(name)
      if (status && status.status !== "pending" && status.status !== "disabled") {
        if (status.status === "needs_auth") setServerState("needsAuth")
        else if (status.status === "connected") setServerState("connected")
        else if (status.status === "failed") {
          setServerState("failed")
          setServerError(status.error)
        } else setServerState("unknown")
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    setServerState("unknown")
  }

  const signIn = async () => {
    const name = record()?.server
    if (!name) return
    setSigning(true)
    try {
      await props.mcp.signIn(name)
      await props.mcp.sync().catch(() => undefined)
      const connected = props.mcp.status(name)?.status === "connected"
      setSignedIn(connected)
      if (connected) setServerState("connected")
    } finally {
      setSigning(false)
    }
  }

  const openDocs = (url: string) => props.onOpen(url)

  const done = () => (
    <div class="dialog-confirm-actions">
      <Button variant="primary" size="large" onClick={props.onClose}>
        {language.t("marketplace.install.done")}
      </Button>
    </div>
  )

  const warnings = () => {
    const items: string[] = []
    if (isMcp()) items.push(language.t("marketplace.install.mcp.warning"))
    if (props.item.kind === "agent") items.push(language.t("marketplace.install.agent.warning"))
    if (props.item.kind === "skill") items.push(language.t("marketplace.install.skill.warning"))
    if (currentScope() === "project") items.push(language.t("marketplace.install.project.warning"))
    return items
  }

  return (
    <Dialog title={language.t("marketplace.install.title", { name: props.item.name })} fit>
      <Show when={step() === "configure"}>
        <div class="install-modal-body">
          <div class="install-modal-about">
            <p>{language.t(`marketplace.install.about.${props.item.kind}`)}</p>
            <div class="install-modal-links">
              <button type="button" class="link" onClick={() => openDocs(MARKETPLACE_DOCS)}>
                {language.t("marketplace.install.learnMore")}
              </button>
              <Show when={isMcp()}>
                <button type="button" class="link" onClick={() => openDocs(MCP_DOCS)}>
                  {language.t("marketplace.install.learnMcp")}
                </button>
              </Show>
            </div>
          </div>

          <div class="install-modal-section">
            <span class="install-modal-label">{language.t("marketplace.install.scope")}</span>
            <RadioGroup
              options={scopeOptions()}
              current={scopeOptions().find((item) => item.value === currentScope())}
              value={(item: { value: MarketplaceScope }) => item.value}
              label={(item: { label: string }) => item.label}
              onSelect={(item: { value: MarketplaceScope } | undefined) => item && setScope(item.value)}
            />
            <p class="install-modal-help">{language.t(`marketplace.install.scope.${currentScope()}.description`)}</p>
          </div>

          <div class="install-modal-warning">
            <For each={warnings()}>{(warning) => <p>{warning}</p>}</For>
          </div>

          <Show when={props.item.kind === "agent" && props.item.agent}>
            {(agent) => (
              <div class="install-modal-section">
                <span class="install-modal-label">{language.t("marketplace.remove.type.agent")}</span>
                <p class="install-modal-help">
                  {agent().mode ? `mode: ${agent().mode}` : ""}
                  {agent().steps ? ` · steps: ${agent().steps}` : ""}
                </p>
                <Show when={agent().permissions}>
                  <pre class="install-modal-code">{JSON.stringify(agent().permissions, null, 2)}</pre>
                </Show>
              </div>
            )}
          </Show>

          <Show when={props.item.options.length > 1}>
            <div class="install-modal-section">
              <span class="install-modal-label">{language.t("marketplace.install.method")}</span>
              <Select
                options={[...props.item.options]}
                current={option()}
                value={(value: { name: string }) => value.name}
                label={(value: { name: string }) => value.name}
                onSelect={(value: { name: string } | undefined) => {
                  if (!value) return
                  setOptionName(value.name)
                  setParams({})
                }}
              />
              <Show when={option()?.description}>
                <p class="install-modal-help">{option()!.description}</p>
              </Show>
            </div>
          </Show>

          <Show when={prerequisites().length > 0}>
            <div class="install-modal-section">
              <span class="install-modal-label">{language.t("marketplace.install.prerequisites")}</span>
              <ul class="install-modal-prerequisites">
                <For each={prerequisites()}>{(item) => <li>{item}</li>}</For>
              </ul>
            </div>
          </Show>

          <Show when={parameters().length > 0}>
            <div class="install-modal-section">
              <span class="install-modal-label">{language.t("marketplace.install.parameters")}</span>
              <For each={parameters()}>
                {(parameter) => (
                  <div class="install-modal-param">
                    <TextField
                      label={`${parameter.name}${parameter.optional ? ` ${language.t("marketplace.install.optional")}` : ""}`}
                      placeholder={parameter.placeholder ?? ""}
                      type={parameter.secret ? "password" : "text"}
                      autocomplete="off"
                      value={params()[parameter.key] ?? ""}
                      onChange={(value: string) => setParam(parameter.key, value)}
                    />
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={error()}>
            <p class="install-modal-error-msg">{error()}</p>
          </Show>

          <div class="install-modal-footer">
            <Button variant="secondary" onClick={props.onClose} disabled={busy()}>
              {language.t("marketplace.install.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void review()} disabled={busy() || !valid()}>
              <Show when={busy()} fallback={isMcp() ? language.t("marketplace.install.review") : language.t("marketplace.install")}>
                <Spinner /> {language.t("marketplace.install.installing")}
              </Show>
            </Button>
          </div>
        </div>
      </Show>

      <Show when={step() === "review" && preview()}>
        {(value) => (
          <div class="install-modal-body">
            <div class="install-modal-section">
              <span class="install-modal-label">{language.t("marketplace.install.config")}</span>
              <code>{value().config}</code>
            </div>
            <div class="install-modal-section">
              <span class="install-modal-label">{language.t("marketplace.install.server")}</span>
              <pre class="install-modal-code">{value().server}</pre>
            </div>
            <Show when={value().parameters.length > 0}>
              <div class="install-modal-section">
                <span class="install-modal-label">{language.t("marketplace.install.parameters")}</span>
                <ul class="install-modal-prerequisites">
                  <For each={value().parameters}>{(name) => <li>{name}</li>}</For>
                </ul>
              </div>
            </Show>
            <Show when={value().secrets.length > 0}>
              <div class="install-modal-warning">
                <span class="install-modal-label">{language.t("marketplace.install.secrets")}</span>
                <p>{language.t("marketplace.install.secret.warning", { secrets: value().secrets.join(", ") })}</p>
                <Show when={currentScope() === "project"}>
                  <p>{language.t("marketplace.install.secret.project")}</p>
                </Show>
              </div>
            </Show>
            <Show when={error()}>
              <p class="install-modal-error-msg">{error()}</p>
            </Show>
            <div class="install-modal-footer">
              <Button variant="secondary" onClick={reset} disabled={busy()}>
                {language.t("marketplace.install.back")}
              </Button>
              <Button variant="primary" onClick={() => void install()} disabled={busy()}>
                <Show when={busy()} fallback={language.t("marketplace.install")}>
                  <Spinner /> {language.t("marketplace.install.installing")}
                </Show>
              </Button>
            </div>
          </div>
        )}
      </Show>

      <Show when={step() === "result"}>
        <div class="dialog-confirm-body install-modal-result">
          <p class="install-modal-success">{language.t("marketplace.install.success")}</p>
          <Show when={record()?.warnings?.length}>
            <div class="install-modal-warning">
              <span class="install-modal-label">{language.t("marketplace.install.warnings")}</span>
              <ul class="install-modal-prerequisites">
                <For each={record()!.warnings}>{(warning) => <li>{warning}</li>}</For>
              </ul>
            </div>
          </Show>
          <Show when={record()?.kind === "mcp" && record()?.server} fallback={done()}>
            <Show
              when={serverState() === "needsAuth"}
              fallback={
                <Show
                  when={serverState() === "failed"}
                  fallback={
                    <Show
                      when={serverState() === "connected" || signedIn()}
                      fallback={
                        <p class="install-modal-mcp-signin-msg">
                          <Show when={serverState() === "checking"}>
                            <Spinner /> {language.t("marketplace.install.mcp.signIn.waiting")}
                          </Show>
                          <Show when={serverState() === "unknown"}>
                            {language.t("marketplace.install.mcp.signIn.message", { name: record()!.server! })}
                          </Show>
                        </p>
                      }
                    >
                      <p class="install-modal-mcp-signin-success">
                        {language.t("marketplace.install.mcp.signIn.success", { name: record()!.server! })}
                      </p>
                      {done()}
                    </Show>
                  }
                >
                  <p class="install-modal-error-msg">
                    {serverError() ?? language.t("marketplace.install.mcp.signIn.failed", { name: record()!.server! })}
                  </p>
                  {done()}
                </Show>
              }
            >
              <Show
                when={serverState() === "checking"}
                fallback={
                  <>
                    <p class="install-modal-mcp-signin-msg">
                      {language.t("marketplace.install.mcp.signIn.message", { name: record()!.server! })}
                    </p>
                    <Show when={error()}>
                      <p class="install-modal-error-msg">{error()}</p>
                    </Show>
                    <div class="dialog-confirm-actions">
                      <Button variant="ghost" size="large" onClick={props.onClose}>
                        {language.t("marketplace.install.mcp.signIn.skip")}
                      </Button>
                      <Show
                        when={signing() || props.mcp.busy().includes(record()!.server!)}
                        fallback={
                          <Button
                            variant="primary"
                            size="large"
                            onClick={() => {
                              setError(undefined)
                              void signIn().then(() => {
                                if (!signedIn()) {
                                  setError(
                                    language.t("marketplace.install.mcp.signIn.failed", {
                                      name: record()!.server!,
                                    }),
                                  )
                                }
                              })
                            }}
                          >
                            {language.t("marketplace.install.mcp.signIn.button")}
                          </Button>
                        }
                      >
                        <Button variant="ghost" size="large" onClick={() => props.mcp.cancel(record()!.server!)}>
                          {language.t("marketplace.install.mcp.signIn.cancel")}
                        </Button>
                      </Show>
                    </div>
                  </>
                }
              >
                <p class="install-modal-mcp-signin-msg">
                  <Spinner /> {language.t("marketplace.install.mcp.signIn.waiting")}
                </p>
              </Show>
            </Show>
          </Show>
        </div>
      </Show>
    </Dialog>
  )
}
