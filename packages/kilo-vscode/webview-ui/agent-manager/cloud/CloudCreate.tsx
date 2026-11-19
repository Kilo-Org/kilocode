import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { SessionMessage } from "@opencode/schema/session-message"
import type { OpenCodeClient } from "@opencode/client"
import { PromptInput } from "../../src/v2/prompt"
import { Selectors } from "../../src/v2/selectors"
import { createCloudSelection } from "./selection"
import { SetupOverlay } from "../SetupOverlay"
import { TranscriptLoading } from "../../src/v2/transcript-loading"
import { SpeechToTextStatusProvider } from "../../src/components/speech-to-text/status"
import { Button } from "@kilocode/kilo-ui/button"
import { Icon } from "@kilocode/kilo-ui/icon"
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { useLanguage } from "../../src/context/language"
import type { CloudNavigation, CreateRoute } from "./route"
import type { PromptAttachment } from "../../../src/protocol"
import { cloudImages, stageCloudImages } from "./attachments"
import { cloudDraftMayFocus } from "./focus"

export function CloudCreate(props: {
  route: CreateRoute
  api: OpenCodeClient
  nav: CloudNavigation
  refresh: (directory: string) => void
}) {
  const { t } = useLanguage()
  const route = props.route
  const life = new AbortController()
  onCleanup(() => life.abort())
  const options = { location: { directory: route.directory }, signal: life.signal }
  const rpc = props.api.rpc(KiloHostedRpc.Definition)
  const composer = createCloudSelection(() => undefined, true)
  const [profiles, setProfiles] = createSignal<Awaited<ReturnType<typeof rpc.profiles>>>()
  const [profileID, setProfileID] = createSignal("")
  const [branch, setBranch] = createSignal("")

  const [loading, setLoading] = createSignal(true)
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<"load" | "create">()
  createEffect(() => props.nav.report(route, sending() || loading() ? "busy" : error() ? "error" : "idle"))
  const title = t(route.workspaceID ? "agentManager.cloud.newSession" : "agentManager.cloud.newWorkspace")
  const load = async () => {
    setLoading(true)
    setError(undefined)
    try {
      const profiles = route.workspaceID ? undefined : await rpc.profiles({ scope: route.scope }, options)
      if (life.signal.aborted) return
      setProfiles(profiles)
    } catch {
      if (!life.signal.aborted) setError("load")
    } finally {
      if (!life.signal.aborted) setLoading(false)
    }
  }
  onMount(load)
  const defaultProfile = () => profiles()?.items.find((item) => item.id === profiles()?.effectiveDefaultProfileID)?.name
  const valid = () => !loading() && !!composer.choice() && error() !== "load"
  const needsText = (value: string) => !!route.workspaceID && !value.trim()
  // Retry an ambiguous failure with the same operation and prompt IDs, unless the user changes its payload.
  let previous: { payload: string; operationKey: string; messageID: string } | undefined
  const submit = async (value: string, items: readonly PromptAttachment[] = []) => {
    const agent = composer.choice()
    if (!agent || !valid() || sending() || needsText(value)) return false
    setSending(true)
    setError(undefined)
    const text = value.trim()
    const payload = JSON.stringify([agent, text, branch().trim(), profileID(), items.map((item) => item.id)])
    if (previous?.payload !== payload)
      previous = { payload, operationKey: crypto.randomUUID(), messageID: SessionMessage.ID.create() }
    const input = { operationKey: previous.operationKey, scope: route.scope, agent }
    try {
      const attachments = await stageCloudImages(
        props.api,
        route.directory,
        route.scope,
        previous.messageID,
        cloudImages(items),
        life.signal,
      )
      const result = route.workspaceID
        ? await rpc.start(
            { ...input, workspaceID: route.workspaceID, prompt: text, messageID: previous.messageID },
            options,
          )
        : await rpc.create(
            {
              ...input,
              branch: branch().trim() || undefined,
              profileID: profileID() || undefined,
              ...((text || attachments) && { prompt: text, messageID: previous.messageID }),
              ...(attachments && { attachments }),
            },
            options,
          )
      if (
        !life.signal.aborted &&
        props.nav.created(route, result.target, text || t("agentManager.session.newSession"), agent)
      )
        props.refresh(route.directory)
      return true
    } catch {
      if (!life.signal.aborted) setError("create")
      return false
    } finally {
      if (!life.signal.aborted) setSending(false)
    }
  }
  return (
    <div class="chat-view" data-cloud-create>
      <Show when={sending()}>
        <SetupOverlay
          cloud
          title={title}
          state={{
            active: true,
            branch: branch() || route.workspaceName,
            message: t("migration.sessionProgress.preparing"),
          }}
        />
      </Show>
      <div class="chat-messages-wrapper">
        <TranscriptLoading session={loading() ? route.projectID : undefined} label={t("common.loading")} />
        <div class="message-list-content-empty am-cloud-launch">
          <div class="message-list-empty">
            <Icon name="cloud" size="large" />
            <h2>{title}</h2>
            <p class="kilo-about-text">
              {t(route.workspaceID ? "agentManager.cloud.launchSibling" : "agentManager.cloud.launchWorkspace")}
            </p>
            <span class="am-cloud-repo" title={route.repository}>
              {route.repository.replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "")}
            </span>
          </div>
        </div>
      </div>
      <div class="chat-input">
        <Show when={!route.workspaceID}>
          <details class="am-cloud-options">
            <summary>
              {t("agentManager.cloud.profile")} · {defaultProfile() || t("common.default")}
            </summary>
            <label>
              {t("agentManager.dialog.baseBranch")}
              <input
                value={branch()}
                maxLength={255}
                placeholder={t("common.default")}
                onInput={(e) => setBranch(e.currentTarget.value)}
              />
            </label>
            <label>
              {t("agentManager.cloud.profile")}
              <select value={profileID()} onChange={(e) => setProfileID(e.currentTarget.value)}>
                <option value="">{defaultProfile() || t("common.default")}</option>
                <For each={profiles()?.items}>{(p) => <option value={p.id}>{p.name}</option>}</For>
              </select>
            </label>
            <Button
              variant="ghost"
              size="small"
              loading={sending()}
              disabled={!valid() || sending()}
              onClick={() => void submit("")}
            >
              {title}
            </Button>
          </details>
        </Show>
        <Show when={error()}>
          <div role="alert">
            {t(error() === "create" ? "agentManager.cloud.createFailed" : "common.requestFailed")}{" "}
            <Show when={error() === "load"}>
              <Button size="small" onClick={load}>
                {t("common.retry")}
              </Button>
            </Show>
          </div>
        </Show>
        <SpeechToTextStatusProvider>
          <PromptInput
            textOnly
            allowImages={!route.workspaceID}
            draftKey={JSON.stringify([route.directory, route.scope, route.workspaceID, "create"])}
            disabled={!valid() || sending()}
            running={false}
            focusOnDraftChange={cloudDraftMayFocus}
            onStop={() => {}}
            onSend={(text, _delivery, input) => submit(text, input?.items)}
            selectors={<Selectors selection={composer.selection} blocked={sending()} />}
          />
        </SpeechToTextStatusProvider>
      </div>
    </div>
  )
}
