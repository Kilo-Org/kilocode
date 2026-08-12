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
import { buildCloudConnect, type CloudError, type CloudMode } from "./cloud-provider-form"

interface CloudProviderDialogProps {
  providerID: typeof BEDROCK_ID | typeof VERTEX_ID
}

function option(cfg: Record<string, unknown> | undefined, key: string) {
  const value = cfg?.[key]
  return typeof value === "string" ? value : ""
}

function Field(props: {
  label: string
  placeholder?: string
  value: string
  type?: "text" | "password"
  multiline?: boolean
  autofocus?: boolean
  field: string
  error?: CloudError
  onChange: (next: string) => void
}) {
  return (
    <TextField
      autofocus={props.autofocus}
      multiline={props.multiline}
      type={props.type ?? "text"}
      label={props.label}
      placeholder={props.placeholder}
      value={props.value}
      onChange={props.onChange}
      validationState={props.error?.field === props.field ? "invalid" : undefined}
      error={props.error?.field === props.field ? props.error.message : undefined}
    />
  )
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
  const [error, setError] = createSignal<CloudError>()
  const [mode, setMode] = createSignal<CloudMode>("apiKey")
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

  function submit(e: SubmitEvent) {
    e.preventDefault()
    setError()
    const parsed = buildCloudConnect(props.providerID, fields, mode(), language.t)
    if ("field" in parsed) {
      setError(parsed)
      return
    }
    setPhase("connecting")
    action.send(
      {
        type: "connectProvider",
        providerID: props.providerID,
        apiKey: parsed.apiKey,
        metadata: parsed.metadata,
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
          setError({ message: message.message })
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
          <Field
            field="region"
            label={language.t("provider.connect.bedrock.region.label")}
            placeholder={language.t("provider.connect.bedrock.region.placeholder")}
            value={fields.region}
            error={error()}
            onChange={(next) => setFields("region", next)}
          />
          <Show when={mode() === "apiKey"}>
            <Field
              autofocus
              field="apiKey"
              type="password"
              label={language.t("provider.connect.bedrock.apiKey.label")}
              placeholder={language.t("provider.connect.apiKey.placeholder")}
              value={fields.apiKey}
              error={error()}
              onChange={(next) => setFields("apiKey", next)}
            />
          </Show>
          <Show when={mode() === "accessKeys"}>
            <Field
              autofocus
              field="accessKeyId"
              label={language.t("provider.connect.bedrock.accessKeyId.label")}
              placeholder={language.t("provider.connect.bedrock.accessKeyId.placeholder")}
              value={fields.accessKeyId}
              error={error()}
              onChange={(next) => setFields("accessKeyId", next)}
            />
            <Field
              field="secretAccessKey"
              type="password"
              label={language.t("provider.connect.bedrock.secretAccessKey.label")}
              placeholder={language.t("provider.connect.bedrock.secretAccessKey.placeholder")}
              value={fields.secretAccessKey}
              error={error()}
              onChange={(next) => setFields("secretAccessKey", next)}
            />
            <Field
              field="sessionToken"
              type="password"
              label={language.t("provider.connect.bedrock.sessionToken.label")}
              placeholder={language.t("provider.connect.bedrock.sessionToken.placeholder")}
              value={fields.sessionToken}
              onChange={(next) => setFields("sessionToken", next)}
            />
          </Show>
          <Show when={mode() === "profile"}>
            <Field
              autofocus
              field="profile"
              label={language.t("provider.connect.bedrock.profile.label")}
              placeholder={language.t("provider.connect.bedrock.profile.placeholder")}
              value={fields.profile}
              error={error()}
              onChange={(next) => setFields("profile", next)}
            />
          </Show>
          <Field
            field="endpoint"
            label={language.t("provider.connect.bedrock.endpoint.label")}
            placeholder={language.t("provider.connect.bedrock.endpoint.placeholder")}
            value={fields.endpoint}
            onChange={(next) => setFields("endpoint", next)}
          />
        </Show>
        <Show when={props.providerID === VERTEX_ID}>
          <Field
            autofocus
            field="project"
            label={language.t("provider.connect.vertex.project.label")}
            placeholder={language.t("provider.connect.vertex.project.placeholder")}
            value={fields.project}
            error={error()}
            onChange={(next) => setFields("project", next)}
          />
          <Field
            field="location"
            label={language.t("provider.connect.vertex.location.label")}
            placeholder={language.t("provider.connect.vertex.location.placeholder")}
            value={fields.location}
            error={error()}
            onChange={(next) => setFields("location", next)}
          />
          <Field
            multiline
            field="credentials"
            label={language.t("provider.connect.vertex.credentials.label")}
            placeholder={language.t("provider.connect.vertex.credentials.placeholder")}
            value={fields.credentials}
            error={error()}
            onChange={(next) => setFields("credentials", next)}
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
