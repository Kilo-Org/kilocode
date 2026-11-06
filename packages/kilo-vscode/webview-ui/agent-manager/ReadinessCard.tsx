// Worktree readiness card: explains why a project can't hold worktrees yet and offers the fix.
// Presentational: it renders a readiness state and reports user intent through callbacks.

/** @jsxImportSource solid-js */

import { type Component, For, Match, Show, Switch, createSignal } from "solid-js"
import { Card, CardActions, CardDescription, CardTitle } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { Collapsible } from "@kilocode/kilo-ui/collapsible"
import { Icon } from "@kilocode/kilo-ui/icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import type { Readiness, ReadinessFix, ReadinessInstaller } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import {
  TOOL_LABELS,
  downloadFix,
  installFix,
  labelForFix,
  toolForCode,
  type Tool,
} from "../../src/shared/worktree-readiness"
import type { ReadinessState } from "./worktree-readiness"

type Blocked = Extract<Readiness, { status: "blocked" }>
type Identity = { name: string; email: string }
type Kind = "restricted" | "git" | "lfs" | "lfs-setup" | "projects" | "commit" | "plain"
type ReadyFixed = "initGit" | "initialCommit" | "installGit" | "installLfs"
const isReadyFixed = (value: string | undefined): value is ReadyFixed =>
  value === "initGit" || value === "initialCommit" || value === "installGit" || value === "installLfs"

export const ReadinessCard: Component<{
  state: ReadinessState
  ref?: (el: HTMLDivElement) => void
  onFix: (fix: ReadinessFix, identity?: Identity) => void
  onProject: (root: string) => void
  onFolder: () => void
  onCheck: () => void
  onReload: () => void
}> = (props) => {
  const blocked = () => {
    const state = props.state
    if (state.status === "blocked") return { result: state.result, error: state.error, fix: undefined }
    if (state.status === "fixing") return { result: state.result, error: undefined, fix: state.fix }
    return undefined
  }
  const ready = () => {
    const state = props.state
    if (state.status !== "ready" || !isReadyFixed(state.fixed)) return undefined
    return { fixed: state.fixed, note: state.note }
  }
  const installing = () => (props.state.status === "installing" ? props.state : undefined)
  const stale = () => (props.state.status === "stale" ? props.state : undefined)
  const unknown = () => (props.state.status === "unknown" ? props.state.detail : undefined)

  return (
    <div class="am-readiness" ref={props.ref} aria-live="polite">
      <Switch>
        <Match when={installing()}>
          {(view) => <InstallingCard state={view()} onFix={props.onFix} onCheck={props.onCheck} />}
        </Match>
        <Match when={stale()}>
          {(view) => <StaleCard state={view()} onCheck={props.onCheck} onReload={props.onReload} />}
        </Match>
        <Match when={blocked()}>
          {(view) => (
            <BlockedCard
              result={view().result}
              error={view().error}
              fixing={view().fix}
              onFix={props.onFix}
              onProject={props.onProject}
              onFolder={props.onFolder}
              onCheck={props.onCheck}
            />
          )}
        </Match>
        <Match when={ready()}>{(view) => <ReadyLine fixed={view().fixed} note={view().note} />}</Match>
        <Match when={unknown()}>{(detail) => <UnknownCard detail={detail()} onCheck={props.onCheck} />}</Match>
      </Switch>
    </div>
  )
}

function Details(props: { text: string }) {
  const { t } = useLanguage()
  return (
    <Collapsible variant="ghost">
      <Collapsible.Trigger>
        <span>{t("error.details.show")}</span>
        <Collapsible.Arrow />
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre class="am-readiness-details">{props.text}</pre>
      </Collapsible.Content>
    </Collapsible>
  )
}

function BlockedCard(props: {
  result: Blocked
  error?: string
  fixing?: ReadinessFix
  onFix: (fix: ReadinessFix, identity?: Identity) => void
  onProject: (root: string) => void
  onFolder: () => void
  onCheck: () => void
}) {
  const { t } = useLanguage()
  const [form, setForm] = createSignal(false)
  const [name, setName] = createSignal("")
  const [email, setEmail] = createSignal("")
  const tool = (): Tool | undefined => toolForCode(props.result.code)
  const fix = (): ReadinessFix => {
    if (props.result.code === "no_commits") return "initialCommit"
    if (props.result.code === "lfs_not_setup") return "setupLfs"
    const kind = tool()
    return kind ? installFix(kind) : "initGit"
  }
  const locked = () => !props.result.trusted
  const projects = () => props.result.projects ?? []
  const install = (): ReadinessInstaller | undefined => props.result.installer
  const kind = (): Kind => {
    if (props.result.restricted) return "restricted"
    const installable = tool()
    if (installable) return installable
    if (props.result.code === "lfs_not_setup") return "lfs-setup"
    if (projects().length > 0) return "projects"
    if (props.result.code === "no_commits") return "commit"
    return "plain"
  }
  const start = () => {
    if (props.result.identity === false) {
      setForm(true)
      return
    }
    props.onFix(fix())
  }
  const save = () => {
    if (!name().trim() || !email().trim()) return
    setForm(false)
    props.onFix(fix(), { name: name().trim(), email: email().trim() })
  }
  const cardCopy: Record<Kind, { title: () => string; body: () => string }> = {
    restricted: {
      title: () => t("agentManager.readiness.restricted.title"),
      body: () => t("agentManager.readiness.restricted.body"),
    },
    git: {
      title: () => t("agentManager.readiness.git.title"),
      body: () =>
        t(
          props.result.platform === "darwin" ? "agentManager.readiness.git.bodyMac" : "agentManager.readiness.git.body",
        ),
    },
    lfs: {
      title: () => t("agentManager.readiness.lfs.title", { name: props.result.name }),
      body: () => t("agentManager.readiness.lfs.body"),
    },
    "lfs-setup": {
      title: () => t("agentManager.readiness.lfsSetup.title", { name: props.result.name }),
      body: () => t("agentManager.readiness.lfsSetup.body"),
    },
    projects: {
      title: () => t("agentManager.readiness.projects.title", { name: props.result.name }),
      body: () => {
        const count = projects().length
        if (count === 1 && !props.result.more)
          return t("agentManager.readiness.projects.bodyOne", { name: props.result.name })
        return t("agentManager.readiness.projects.body", {
          name: props.result.name,
          count: props.result.more ? `${count}+` : String(count),
        })
      },
    },
    commit: {
      title: () => t("agentManager.readiness.commit.title", { name: props.result.name }),
      body: () => t("agentManager.readiness.commit.body"),
    },
    plain: {
      title: () => t("agentManager.readiness.plain.title", { name: props.result.name }),
      body: () => t("agentManager.readiness.plain.body"),
    },
  }
  const title = () => (form() && !props.fixing ? t("agentManager.readiness.identity.title") : cardCopy[kind()].title())
  const body = () => (form() && !props.fixing ? t("agentManager.readiness.identity.body") : cardCopy[kind()].body())
  const working = () => {
    if (props.fixing === "initGit") return t("agentManager.readiness.working.initGit")
    if (props.fixing === "initialCommit") return t("agentManager.readiness.working.initialCommit")
    if (props.fixing === "setupLfs") return t("agentManager.readiness.working.setupLfs")
    return t("agentManager.readiness.working.project")
  }

  const actions = () => {
    const value = kind()
    switch (value) {
      case "restricted":
        return (
          <Button size="small" variant="secondary" disabled={locked()} onClick={props.onFolder} data-readiness-action>
            {t("agentManager.readiness.restricted.action")}
          </Button>
        )
      case "git":
      case "lfs":
        return (
          <>
            <Button
              size="small"
              variant="secondary"
              disabled={locked()}
              onClick={() => props.onFix(installFix(value))}
              data-readiness-action
            >
              {t(install() ? "agentManager.readiness.tool.install" : "agentManager.readiness.tool.get", {
                tool: TOOL_LABELS[value],
              })}
            </Button>
            <Show when={install()}>
              <button class="am-readiness-link" type="button" onClick={() => props.onFix(downloadFix(value))}>
                {t("agentManager.readiness.tool.other")}
              </button>
            </Show>
          </>
        )
      case "lfs-setup":
        return (
          <Button size="small" variant="secondary" disabled={locked()} onClick={start} data-readiness-action>
            {t("agentManager.readiness.lfsSetup.action")}
          </Button>
        )
      case "projects":
        return (
          <Show
            when={props.result.more}
            fallback={
              <>
                <For each={projects()}>
                  {(project, index) => (
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={locked()}
                      onClick={() => props.onProject(project.root)}
                      data-readiness-action={index() === 0 ? "" : undefined}
                    >
                      {t("agentManager.readiness.projects.use", { name: project.label })}
                    </Button>
                  )}
                </For>
                <button class="am-readiness-link" type="button" disabled={locked()} onClick={props.onFolder}>
                  {t("agentManager.readiness.projects.other")}
                </button>
              </>
            }
          >
            <Button size="small" variant="secondary" disabled={locked()} onClick={props.onFolder} data-readiness-action>
              {t("agentManager.readiness.restricted.action")}
            </Button>
          </Show>
        )
      case "commit":
        return (
          <Button size="small" variant="secondary" disabled={locked()} onClick={start} data-readiness-action>
            {t("agentManager.readiness.commit.action")}
          </Button>
        )
      case "plain":
        return (
          <>
            <Button size="small" variant="secondary" disabled={locked()} onClick={start} data-readiness-action>
              {t("agentManager.readiness.plain.action")}
            </Button>
            <button class="am-readiness-link" type="button" disabled={locked()} onClick={props.onFolder}>
              {t("agentManager.readiness.plain.other")}
            </button>
          </>
        )
    }
  }

  return (
    <Card variant={form() ? "normal" : "warning"}>
      <CardTitle
        variant={form() ? "normal" : "warning"}
        icon={form() ? false : undefined}
        tabIndex={-1}
        data-readiness-title
      >
        {title()}
      </CardTitle>
      <CardDescription>{body()}</CardDescription>
      <Show when={locked()}>
        <CardDescription>{t("agentManager.readiness.untrusted")}</CardDescription>
      </Show>
      <Show when={props.error}>
        {(error) => (
          <>
            <CardDescription>{t("agentManager.readiness.error")}</CardDescription>
            <Details text={error()} />
          </>
        )}
      </Show>
      <Show
        when={!props.fixing}
        fallback={
          <div class="am-readiness-working" role="status">
            <Spinner />
            <span>{working()}</span>
          </div>
        }
      >
        <Show when={form()}>
          <form
            class="am-readiness-form"
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
          >
            <div class="am-readiness-fields">
              <TextField
                label={t("agentManager.readiness.identity.name")}
                value={name()}
                onChange={setName}
                autocomplete="name"
                data-readiness-action
              />
              <TextField
                label={t("agentManager.readiness.identity.email")}
                type="email"
                value={email()}
                onChange={setEmail}
                autocomplete="email"
              />
            </div>
            <CardActions>
              <Button
                type="submit"
                size="small"
                variant="secondary"
                disabled={locked() || !name().trim() || !email().trim()}
              >
                {fix() === "initialCommit"
                  ? t("agentManager.readiness.identity.saveCommit")
                  : t("agentManager.readiness.identity.saveInit")}
              </Button>
              <button class="am-readiness-link" type="button" onClick={() => setForm(false)}>
                {t("common.cancel")}
              </button>
            </CardActions>
          </form>
        </Show>
        <Show when={!form()}>
          <CardActions>
            {actions()}
            <button class="am-readiness-link am-readiness-check" type="button" onClick={props.onCheck}>
              {t("agentManager.readiness.check")}
            </button>
          </CardActions>
        </Show>
      </Show>
    </Card>
  )
}

function InstallingCard(props: {
  state: Extract<ReadinessState, { status: "installing" }>
  onFix: (fix: ReadinessFix, identity?: Identity) => void
  onCheck: () => void
}) {
  const { t } = useLanguage()
  const apple = () => props.state.mode === "apple"
  const name = () => labelForFix(props.state.fix)
  return (
    <Card>
      <div class="am-readiness-working" role="status">
        <Spinner />
        <span>
          {apple()
            ? t("agentManager.readiness.install.apple.title")
            : t("agentManager.readiness.install.terminal.title", { tool: name() })}
        </span>
      </div>
      <CardDescription>
        {apple() ? t("agentManager.readiness.install.apple.body") : t("agentManager.readiness.install.terminal.body")}
      </CardDescription>
      <Show when={apple()}>
        <CardActions>
          <button
            class="am-readiness-link"
            type="button"
            onClick={() => props.onFix(props.state.fix === "installGit" ? "downloadGit" : "downloadLfs")}
          >
            {t("agentManager.readiness.tool.other")}
          </button>
          <button class="am-readiness-link am-readiness-check" type="button" onClick={props.onCheck}>
            {t("agentManager.readiness.check")}
          </button>
        </CardActions>
      </Show>
    </Card>
  )
}

function StaleCard(props: {
  state: Extract<ReadinessState, { status: "stale" }>
  onCheck: () => void
  onReload: () => void
}) {
  const { t } = useLanguage()
  const name = () => labelForFix(props.state.fix)
  return (
    <Card variant="warning">
      <CardTitle variant="warning" tabIndex={-1} data-readiness-title>
        {t("agentManager.readiness.install.stale.title", { tool: name() })}
      </CardTitle>
      <CardDescription>{t("agentManager.readiness.install.stale.body")}</CardDescription>
      <CardActions>
        <Button size="small" variant="secondary" onClick={props.onReload} data-readiness-action>
          {t("agentManager.readiness.install.reload")}
        </Button>
        <button class="am-readiness-link am-readiness-check" type="button" onClick={props.onCheck}>
          {t("agentManager.readiness.check")}
        </button>
      </CardActions>
    </Card>
  )
}

function ReadyLine(props: { fixed: ReadyFixed; note?: "uncommitted" }) {
  const { t } = useLanguage()
  const title = () => {
    if (props.fixed === "installGit") return t("agentManager.readiness.ready.git")
    if (props.fixed === "installLfs") return t("agentManager.readiness.ready.lfs")
    if (props.fixed === "initGit") return t("agentManager.readiness.ready.initGit")
    return t("agentManager.readiness.ready.initialCommit")
  }
  const note = () => {
    if (props.fixed === "initGit") return t("agentManager.readiness.ready.initGitNote")
    if (props.fixed === "initialCommit") return t("agentManager.readiness.ready.initialCommitNote")
    return undefined
  }
  return (
    <div class="am-readiness-ready" role="status">
      <Icon name="circle-check" size="small" />
      <div>
        <div class="am-readiness-ready-title">{title()}</div>
        <Show when={props.note === "uncommitted" && note()}>
          {(text) => <div class="am-readiness-ready-body">{text()}</div>}
        </Show>
      </div>
    </div>
  )
}

function UnknownCard(props: { detail: string; onCheck: () => void }) {
  const { t } = useLanguage()
  return (
    <Card>
      <CardTitle icon={false} tabIndex={-1} data-readiness-title>
        {t("agentManager.readiness.unknown.title")}
      </CardTitle>
      <CardDescription>{props.detail.split("\n").at(0)}</CardDescription>
      <Details text={props.detail} />
      <CardActions>
        <button class="am-readiness-link am-readiness-check" type="button" onClick={props.onCheck}>
          {t("agentManager.readiness.check")}
        </button>
      </CardActions>
    </Card>
  )
}
