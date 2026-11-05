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
import type { Readiness, ReadinessFix } from "../src/types/messages"
import { useLanguage } from "../src/context/language"
import type { ReadinessState } from "./worktree-readiness"

type Blocked = Extract<Readiness, { status: "blocked" }>
type Identity = { name: string; email: string }

export const ReadinessCard: Component<{
  state: ReadinessState
  ref?: (el: HTMLDivElement) => void
  onFix: (fix: ReadinessFix, identity?: Identity) => void
  onProject: (root: string) => void
  onFolder: () => void
  onCheck: () => void
}> = (props) => {
  const blocked = () => {
    const state = props.state
    if (state.status === "blocked") return { result: state.result, error: state.error, fix: undefined }
    if (state.status === "fixing") return { result: state.result, error: undefined, fix: state.fix }
    return undefined
  }
  const ready = () => {
    const state = props.state
    if (state.status !== "ready" || (state.fixed !== "initGit" && state.fixed !== "initialCommit")) return undefined
    return { fixed: state.fixed, note: state.note }
  }
  const unknown = () => (props.state.status === "unknown" ? props.state.detail : undefined)

  return (
    <div class="am-readiness" ref={props.ref} aria-live="polite">
      <Switch>
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
  const fix = (): ReadinessFix => (props.result.code === "no_commits" ? "initialCommit" : "initGit")
  const locked = () => !props.result.trusted
  const projects = () => props.result.projects ?? []
  const kind = () => {
    if (props.result.restricted) return "restricted"
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
  const title = () => {
    if (form() && !props.fixing) return t("agentManager.readiness.identity.title")
    if (kind() === "restricted") return t("agentManager.readiness.restricted.title")
    if (kind() === "projects") return t("agentManager.readiness.projects.title", { name: props.result.name })
    if (kind() === "commit") return t("agentManager.readiness.commit.title", { name: props.result.name })
    return t("agentManager.readiness.plain.title", { name: props.result.name })
  }
  const body = () => {
    if (form() && !props.fixing) return t("agentManager.readiness.identity.body")
    if (kind() === "restricted") return t("agentManager.readiness.restricted.body")
    if (kind() === "projects") {
      const count = projects().length
      if (count === 1 && !props.result.more)
        return t("agentManager.readiness.projects.bodyOne", { name: props.result.name })
      return t("agentManager.readiness.projects.body", {
        name: props.result.name,
        count: props.result.more ? `${count}+` : String(count),
      })
    }
    if (kind() === "commit") return t("agentManager.readiness.commit.body")
    return t("agentManager.readiness.plain.body")
  }
  const working = () => {
    if (props.fixing === "initGit") return t("agentManager.readiness.working.initGit")
    if (props.fixing === "initialCommit") return t("agentManager.readiness.working.initialCommit")
    return t("agentManager.readiness.working.project")
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
            <Switch>
              <Match when={kind() === "restricted"}>
                <Button
                  size="small"
                  variant="secondary"
                  disabled={locked()}
                  onClick={props.onFolder}
                  data-readiness-action
                >
                  {t("agentManager.readiness.restricted.action")}
                </Button>
              </Match>
              <Match when={kind() === "projects"}>
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
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={locked()}
                    onClick={props.onFolder}
                    data-readiness-action
                  >
                    {t("agentManager.readiness.restricted.action")}
                  </Button>
                </Show>
              </Match>
              <Match when={kind() === "commit"}>
                <Button size="small" variant="secondary" disabled={locked()} onClick={start} data-readiness-action>
                  {t("agentManager.readiness.commit.action")}
                </Button>
              </Match>
              <Match when={kind() === "plain"}>
                <Button size="small" variant="secondary" disabled={locked()} onClick={start} data-readiness-action>
                  {t("agentManager.readiness.plain.action")}
                </Button>
                <button class="am-readiness-link" type="button" disabled={locked()} onClick={props.onFolder}>
                  {t("agentManager.readiness.plain.other")}
                </button>
              </Match>
            </Switch>
            <button class="am-readiness-link am-readiness-check" type="button" onClick={props.onCheck}>
              {t("agentManager.readiness.check")}
            </button>
          </CardActions>
        </Show>
      </Show>
    </Card>
  )
}

function ReadyLine(props: { fixed: "initGit" | "initialCommit"; note?: "uncommitted" }) {
  const { t } = useLanguage()
  return (
    <div class="am-readiness-ready" role="status">
      <Icon name="circle-check" size="small" />
      <div>
        <div class="am-readiness-ready-title">
          {props.fixed === "initGit"
            ? t("agentManager.readiness.ready.initGit")
            : t("agentManager.readiness.ready.initialCommit")}
        </div>
        <Show when={props.note === "uncommitted"}>
          <div class="am-readiness-ready-body">
            {props.fixed === "initGit"
              ? t("agentManager.readiness.ready.initGitNote")
              : t("agentManager.readiness.ready.initialCommitNote")}
          </div>
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
