import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { WorktreeSkeleton } from "../Skeleton"
import { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import type { OpenCodeClient } from "@opencode/client"
import { WorkspaceRowBody } from "../WorkspaceRowBody"
import { useLanguage } from "../../src/context/language"
import type { AgentProjectSnapshot } from "../../src/types/messages/agent-manager"

import type { PanelData } from "../v2/panel-data"
import { createCloudCatalog, uniqueBy } from "./catalog"
import type { CloudNavigation, CloudProject } from "./route"

export function CloudRow(props: {
  project: AgentProjectSnapshot
  panel: PanelData
  nav: CloudNavigation
  revision: number
}) {
  const { t } = useLanguage()
  const catalog = createMemo(() => {
    props.revision
    if (props.panel.connection.status() !== "connected") return
    return untrack(() => {
      const result = createCloudCatalog(props.panel.api, props.project.root)
      void result.read()
      return result
    })
  })
  const status = () => catalog()?.status()
  const project = createMemo((): CloudProject | undefined => {
    const info = status()
    if (info?.state !== "ready" || !info.repository || !info.scope) return
    return {
      projectID: props.project.id,
      directory: props.project.root,
      scope: info.scope,
      restoreKey: info.restoreKey,
      repository: info.repository,
    }
  })
  const items = () =>
    catalog()
      ?.items()
      .filter((item) => item.deletionState === "active") ?? []
  createEffect(() => {
    const context = project()
    if (!context) return
    for (const row of items()) {
      const routes = row.sessions.map((session) => ({
        ...context,
        kind: "session" as const,
        title: session.title || t("agentManager.session.untitled"),
        target: {
          scope: context.scope,
          providerID: "kilo-cloud" as const,
          workspaceID: row.workspaceID,
          sessionID: session.sessionID,
        },
      }))
      if (untrack(() => props.nav.restore(routes))) {
        break
      }
    }
  })
  return (
    <>
      <Show when={catalog()?.loading() && !items().length}>
        <WorktreeSkeleton count={1} />
      </Show>
      <Show when={project()} keyed>
        {(context) => (
          <For each={items()}>
            {(row) => <WorkspaceRow workspace={row} project={context} nav={props.nav} api={props.panel.api} />}
          </For>
        )}
      </Show>
      <Show when={catalog()?.failed()}>
        <button class="am-cloud-link" onClick={() => void catalog()?.read()}>
          {t("agentManager.cloud.loadFailed")} · {t("common.retry")}
        </button>
      </Show>
      <Show when={catalog()?.cursor()}>
        {(page) => (
          <button class="am-cloud-link" onClick={() => void catalog()?.read(page())}>
            {t("common.loadMore")}
          </button>
        )}
      </Show>
    </>
  )
}

function WorkspaceRow(props: {
  workspace: KiloHostedRpc.Workspace
  project: CloudProject
  nav: CloudNavigation
  api: OpenCodeClient
}) {
  const { t } = useLanguage()
  const name = () => props.workspace.name || props.workspace.branch || props.workspace.workspaceID
  const selected = () => {
    const current = props.nav.current()
    return (
      current?.directory === props.project.directory &&
      current.scope === props.project.scope &&
      (current.kind === "session" ? current.target.workspaceID : current.workspaceID) === props.workspace.workspaceID
    )
  }
  const activity = () => props.nav.workspaceState(props.project, props.workspace.workspaceID)
  const [sessions, setSessions] = createSignal(props.workspace.sessions)
  const [cursor, setCursor] = createSignal(props.workspace.cursor)
  const [loading, setLoading] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const life = new AbortController()
  onCleanup(() => life.abort())
  const more = async () => {
    if (!cursor() || loading()) return
    setLoading(true)
    setFailed(false)
    try {
      const result = await props.api
        .rpc(KiloHostedRpc.Definition)
        .workspace(
          { scope: props.project.scope, workspaceID: props.workspace.workspaceID, cursor: cursor() },
          { location: { directory: props.project.directory }, signal: life.signal },
        )
      if (life.signal.aborted) return
      setSessions((prev) => uniqueBy([...prev, ...result.sessions], (session) => session.sessionID))
      setCursor(result.cursor)
    } catch {
      if (!life.signal.aborted) setFailed(true)
    } finally {
      if (!life.signal.aborted) setLoading(false)
    }
  }
  const open = () => {
    if (!sessions().length) {
      props.nav.select({
        ...props.project,
        kind: "create",
        workspaceID: props.workspace.workspaceID,
        workspaceName: name(),
      })
      return
    }
    props.nav.workspace(
      sessions().map((s) => ({
        ...props.project,
        kind: "session",
        title: s.title || t("agentManager.session.untitled"),
        target: {
          providerID: "kilo-cloud",
          scope: props.project.scope,
          workspaceID: props.workspace.workspaceID,
          sessionID: s.sessionID,
        },
      })),
    )
  }
  return (
    <div class="am-cloud-workspace">
      <button
        class="am-worktree-item"
        classList={{ "am-worktree-item-active": !!selected() }}
        title={name()}
        onClick={open}
      >
        <WorkspaceRowBody
          cloud
          state={activity()}
          primary={
            <span class="am-worktree-branch">
              <span class="am-wt-name">
                {props.workspace.name || props.workspace.branch || props.project.repository.split("/").at(-1)}
              </span>
            </span>
          }
        >
          <span class="am-worktree-subtitle">
            {t("session.tab.cloud")}
            {props.workspace.branch ? ` · ${props.workspace.branch}` : ""}
          </span>
        </WorkspaceRowBody>
      </button>
      <Show when={cursor()}>
        <button
          class="am-cloud-link"
          disabled={loading()}
          onClick={async () => {
            await more()
            if (!failed()) open()
          }}
        >
          {t(failed() ? "common.retry" : "common.loadMore")}
        </button>
      </Show>
    </div>
  )
}
