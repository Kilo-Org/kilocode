import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { Show, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import { createProviderAction } from "../../utils/provider-action"
import { BEDROCK_ID, VERTEX_ID } from "../../../../src/shared/cloud-provider"

type Mode = "apiKey" | "accessKeys" | "profile"

interface CloudProviderDialogProps {
  providerID: typeof BEDROCK_ID | typeof VERTEX_ID
}

function option(cfg: Record<string, unknown> | undefined, key: string) {
  const value = cfg?.[key]
  return typeof value === "string" ? value : ""
}

const CloudProviderDialog = (props: CloudProviderDialogProps) => {
  const dialog = useDialog()
  const language = useLanguage()
  const provider = useProvider()
  const vscode = useVSCode()
  const { config } = useConfig()
  const action = createProviderAction(vscode)
  onCleanup(action.dispose)
  const item = createMemo(() => provider.providers()[props.providerID])
  const name = () => item()?.name ?? props.providerID
  const cfg = () => config().provider?.[props.providerID]?.options as Record<string, unknown> | undefined
  const [phase, setPhase] = createSignal<"idle" | "connecting">("idle")
  const [error, setError] = createSignal<{ field?: string; message: string }>()
  const [mode, setMode] = createSignal<Mode>("apiKey")
  const [fields, setFields] = createStore({
    region: option(cfg(), "region") || "us-east-1",
    profile: option(cfg(), "profile"),
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "",
    apiKey: "",
    endpoint: option(cfg(), "endpoint"),
    project: option(cfg(), "project"),
    location: option(cfg(), "location") || "us-central1",
    credentials: "",
  })

  const modes = createMemo(() => [
    {
      value: "apiKey" as const,
      label: language.t("provider.connect.bedrock.mode.apiKey.label"),
      hint: language.t("provider.connect.bedrock.mode.apiKey.hint"),
    },
    {
      value: "accessKeys" as const,
      label: language.t("provider.connect.bedrock.mode.accessKeys.label"),
      hint: language.t("provider.connect.bedrock.mode.accessKeys.hint"),
    },
    {
      value: "profile" as const,
      label: language.t("provider.connect.bedrock.mode.profile.label"),
      hint: language.t("provider.connect.bedrock.mode.profile.hint"),
    },
  ])

  function fail(field: string | undefined, message: string) {
    setError({ field, message })
  }

  function required(field: keyof typeof fields, key: string) {
    const value = fields[field].trim()
    if (value) return value
    fail(field, language.t("provider.connect.prompt.required", { field: language.t(key) }))
    return
  }

  function parseVertex() {
    const blob = fields.credentials.trim()
    if (!blob) return { project: required("project", "provider.connect.vertex.project.label") }
    try {
      const parsed = JSON.parse(blob) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("credentials", language.t("provider.connect.vertex.credentials.invalid"))
        return
      }
      const project =
        fields.project.trim() ||
        (typeof (parsed as { project_id?: unknown }).project_id === "string"
          ? (parsed as { project_id: string }).project_id.trim()
          : "")
      if (!project) {
        fail(
          "project",
          language.t("provider.connect.prompt.required", { field: language.t("provider.connect.vertex.project.label") }),
        )
        return
      }
      return { project, credentials: JSON.stringify(parsed) }
    } catch {
      fail("credentials", language.t("provider.connect.vertex.credentials.invalid"))
      return
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault()
    setError()
    const metadata: Record<string, string> = {}
    const apiKey = fields.apiKey.trim()

    if (props.providerID === BEDROCK_ID) {
      const region = required("region", "provider.connect.bedrock.region.label")
      if (!region) return
      metadata.mode = mode()
      metadata.region = region
      const endpoint = fields.endpoint.trim()
      if (endpoint) metadata.endpoint = endpoint
      if (mode() === "apiKey") {
        if (!apiKey) {
          fail("apiKey", language.t("provider.connect.apiKey.required"))
          return
        }
      }
      if (mode() === "accessKeys") {
        const access = required("accessKeyId", "provider.connect.bedrock.accessKeyId.label")
        const secret = required("secretAccessKey", "provider.connect.bedrock.secretAccessKey.label")
        if (!access || !secret) return
        metadata.accessKeyId = access
        metadata.secretAccessKey = secret
        const session = fields.sessionToken.trim()
        if (session) metadata.sessionToken = session
      }
      if (mode() === "profile") {
        const profile = required("profile", "provider.connect.bedrock.profile.label")
        if (!profile) return
        metadata.profile = profile
      }
    }

    if (props.providerID === VERTEX_ID) {
      const parsed = parseVertex()
      if (!parsed) return
      metadata.project = parsed.project
      const location = required("location", "provider.connect.vertex.location.label")
      if (!location) return
      metadata.location = location
      if (parsed.credentials) metadata.credentials = parsed.credentials
    }

    setPhase("connecting")
    action.send(
      {
        type: "connectProvider",
        providerID: props.providerID,
        apiKey,
        metadata,
      },
      {
        onConnected: () => {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.connect.toast.connected.title", { provider: name() }),
            description: language.t("provider.connect.toast.connected.description", { provider: name() }),
          })
          dialog.close()
        },
        onError: (message) => {
          setPhase("idle")
          fail(undefined, message.message)
        },
      },
    )
  }

  return (
    <Dialog title={language.t("provider.connect.title", { provider: name() })} fit>
      <form
        class="dialog-confirm-body"
        style={{ display: "flex", "flex-direction": "column", gap: "16px" }}
        onSubmit={submit}
      >
        <div class="provider-connect-body">
          {language.t(
            props.providerID === BEDROCK_ID
              ? "provider.connect.bedrock.description"
              : "provider.connect.vertex.description",
            { provider: name() },
          )}
        </div>
        <Show when={props.providerID === BEDROCK_ID}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
            <label
              style={{
                "font-size": "var(--kilo-font-size-12)",
                "font-weight": "500",
                color: "var(--text-weak-base)",
              }}
            >
              {language.t("provider.connect.bedrock.mode.label")}
            </label>
            <Select
              options={modes()}
              current={modes().find((item) => item.value === mode())}
              value={(item) => item.value}
              label={(item) => `${item.label} (${item.hint})`}
              onSelect={(item) => setMode(item?.value ?? "apiKey")}
              variant="secondary"
              size="small"
              triggerVariant="settings"
            />
          </div>
          <TextField
            type="text"
            label={language.t("provider.connect.bedrock.region.label")}
            placeholder={language.t("provider.connect.bedrock.region.placeholder")}
            value={fields.region}
            onChange={(next) => setFields("region", next)}
            validationState={error()?.field === "region" ? "invalid" : undefined}
            error={error()?.field === "region" ? error()?.message : undefined}
          />
          <Show when={mode() === "apiKey"}>
            <TextField
              autofocus
              type="password"
              label={language.t("provider.connect.bedrock.apiKey.label")}
              placeholder={language.t("provider.connect.apiKey.placeholder")}
              value={fields.apiKey}
              onChange={(next) => setFields("apiKey", next)}
              validationState={error()?.field === "apiKey" ? "invalid" : undefined}
              error={error()?.field === "apiKey" ? error()?.message : undefined}
            />
          </Show>
          <Show when={mode() === "accessKeys"}>
            <TextField
              autofocus
              type="text"
              label={language.t("provider.connect.bedrock.accessKeyId.label")}
              placeholder={language.t("provider.connect.bedrock.accessKeyId.placeholder")}
              value={fields.accessKeyId}
              onChange={(next) => setFields("accessKeyId", next)}
              validationState={error()?.field === "accessKeyId" ? "invalid" : undefined}
              error={error()?.field === "accessKeyId" ? error()?.message : undefined}
            />
            <TextField
              type="password"
              label={language.t("provider.connect.bedrock.secretAccessKey.label")}
              placeholder={language.t("provider.connect.bedrock.secretAccessKey.placeholder")}
              value={fields.secretAccessKey}
              onChange={(next) => setFields("secretAccessKey", next)}
              validationState={error()?.field === "secretAccessKey" ? "invalid" : undefined}
              error={error()?.field === "secretAccessKey" ? error()?.message : undefined}
            />
            <TextField
              type="password"
              label={language.t("provider.connect.bedrock.sessionToken.label")}
              placeholder={language.t("provider.connect.bedrock.sessionToken.placeholder")}
              value={fields.sessionToken}
              onChange={(next) => setFields("sessionToken", next)}
            />
          </Show>
          <Show when={mode() === "profile"}>
            <TextField
              autofocus
              type="text"
              label={language.t("provider.connect.bedrock.profile.label")}
              placeholder={language.t("provider.connect.bedrock.profile.placeholder")}
              value={fields.profile}
              onChange={(next) => setFields("profile", next)}
              validationState={error()?.field === "profile" ? "invalid" : undefined}
              error={error()?.field === "profile" ? error()?.message : undefined}
            />
          </Show>
          <TextField
            type="text"
            label={language.t("provider.connect.bedrock.endpoint.label")}
            placeholder={language.t("provider.connect.bedrock.endpoint.placeholder")}
            value={fields.endpoint}
            onChange={(next) => setFields("endpoint", next)}
          />
        </Show>
        <Show when={props.providerID === VERTEX_ID}>
          <TextField
            autofocus
            type="text"
            label={language.t("provider.connect.vertex.project.label")}
            placeholder={language.t("provider.connect.vertex.project.placeholder")}
            value={fields.project}
            onChange={(next) => setFields("project", next)}
            validationState={error()?.field === "project" ? "invalid" : undefined}
            error={error()?.field === "project" ? error()?.message : undefined}
          />
          <TextField
            type="text"
            label={language.t("provider.connect.vertex.location.label")}
            placeholder={language.t("provider.connect.vertex.location.placeholder")}
            value={fields.location}
            onChange={(next) => setFields("location", next)}
            validationState={error()?.field === "location" ? "invalid" : undefined}
            error={error()?.field === "location" ? error()?.message : undefined}
          />
          <TextField
            multiline
            type="text"
            label={language.t("provider.connect.vertex.credentials.label")}
            placeholder={language.t("provider.connect.vertex.credentials.placeholder")}
            value={fields.credentials}
            onChange={(next) => setFields("credentials", next)}
            validationState={error()?.field === "credentials" ? "invalid" : undefined}
            error={error()?.field === "credentials" ? error()?.message : undefined}
          />
        </Show>
        <Show when={error() && !error()?.field}>
          <div style={{ color: "var(--vscode-errorForeground)", "font-size": "var(--kilo-font-size-13)" }}>
            {error()?.message}
          </div>
        </Show>
        <div class="dialog-confirm-actions">
          <Button variant="ghost" size="large" type="button" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" type="submit" disabled={phase() === "connecting"}>
            {language.t("common.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

export default CloudProviderDialog
