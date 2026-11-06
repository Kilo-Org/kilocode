import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
  untrack,
} from "solid-js"
import { Dynamic } from "solid-js/web"
import { checksum } from "@opencode/util/encode"
import { useClipboard } from "../context/clipboard"
import { useFileComponent } from "../context/file"
import { useI18n } from "../context/i18n"
import { BasicTool } from "./basic-tool"
import { executeArgs, executeCalls, executeRaw, type ExecuteCall } from "./execute-data"
import { Icon } from "./icon"
import { IconButton } from "./icon-button"
import type { ToolProps } from "./message-part"
import { Spinner } from "./spinner"
import { TextShimmer } from "./text-shimmer"
import { Tooltip } from "./tooltip"
import { busy } from "./tool-utils"

/** Calls shown before the list folds the rest behind a "more" row. */
const VISIBLE = 6
/** How long a running script must have no running call before the header says it is working. */
const PAUSE = 400

/**
 * Code Mode card. The header is the whole story: a ring with one segment per tool call
 * and a line that names the call running now. The body lists the calls and keeps the
 * script and the raw result behind one more click.
 */
export function ExecuteTool(props: ToolProps) {
  const i18n = useI18n()
  const calls = createMemo(() => executeCalls(props.metadata))
  const running = () => busy(props.status)
  // Only a card the user watched while it ran animates; a reload or a scroll back shows the end state.
  const live = untrack(running)
  const failed = () => props.metadata.error === true || props.status === "error"
  const code = () => (typeof props.input.code === "string" ? props.input.code.trimEnd() : "")
  const error = () => (failed() ? firstLine(props.output.replace(/^Error:\s*/, "")) : "")
  // Calls in a row leave gaps shorter than one 100 ms update; "Working" only after a real pause avoids a flicker.
  const [paused, setPaused] = createSignal(false)
  createEffect(() => {
    const between = running() && calls().length > 0 && !calls().some((call) => call.status === "running")
    if (!between) return setPaused(false)
    const timer = setTimeout(() => setPaused(true), PAUSE)
    onCleanup(() => clearTimeout(timer))
  })
  const errors = () => calls().filter((call) => call.status === "error").length
  const line = createMemo(() => {
    const list = calls()
    // One line has no room for arguments, which keep the order the script sent them; the list shows them in full.
    const count = list.length > 1 ? i18n.plural("ui.tool.execute.calls", list.length) : undefined
    if (running()) {
      const call = list.findLast((item) => item.status === "running") ?? (paused() ? undefined : list.at(-1))
      const now = call
        ? call.tool
        : list.length > 0
          ? i18n.t("ui.tool.execute.working")
          : i18n.t("ui.tool.execute.running")
      return [now, count].filter(Boolean).join(" · ")
    }
    if (failed()) return i18n.t("ui.tool.execute.scriptFailed")
    if (list.length === 0) return i18n.t("ui.tool.execute.ran")
    if (list.length === 1) return list[0]!.tool
    const names = [...new Set(list.map((call) => call.tool))]
    return [
      i18n.plural("ui.tool.execute.calls", list.length),
      names.length > 2 ? `${names.slice(0, 2).join(", ")}, …` : names.join(", "),
      errors() > 0 ? i18n.t("ui.tool.execute.someFailed", { count: errors() }) : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
  })
  // Most scripts finish in milliseconds; a time only carries signal once the user had to wait.
  const duration = () => {
    const time = props.time
    if (!time?.completed) return ""
    const ms = time.completed - (time.ran ?? time.created)
    if (ms < 1000) return ""
    return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`
  }

  return (
    <div data-component="execute-tool" data-failed={failed() ? "" : undefined}>
      <BasicTool
        {...props}
        icon="code"
        iconNode={<ExecuteRing calls={calls()} running={running()} failed={failed() || errors() > 0} live={live} />}
        hasDetails
        defaultOpen={props.defaultOpen ?? false}
        allowPendingToggle
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.execute")} active={running()} />
              </span>
              <ExecuteTicker text={line()} live={live} />
            </div>
            <Show when={duration()}>{(text) => <span data-slot="execute-duration">{text()}</span>}</Show>
          </div>
        }
      >
        <ExecuteBody
          calls={calls()}
          error={error()}
          code={code()}
          output={props.output}
          failed={failed()}
          live={live}
        />
      </BasicTool>
    </div>
  )
}

/** One line that rises out as the next rises in, like the working status above the composer. */
function ExecuteTicker(props: { text: string; live: boolean }) {
  let key = 0
  const [lines, setLines] = createSignal([{ key, text: props.text, old: false, still: true }])
  const timers = new Set<ReturnType<typeof setTimeout>>()
  onCleanup(() => timers.forEach(clearTimeout))
  createEffect(
    on(
      () => props.text,
      (text) => {
        key += 1
        if (!props.live) return setLines([{ key, text, old: false, still: true }])
        const gone = new Set(lines().map((item) => item.key))
        setLines((prev) => [...prev.map((item) => ({ ...item, old: true })), { key, text, old: false, still: false }])
        const timer = setTimeout(() => {
          timers.delete(timer)
          setLines((prev) => prev.filter((item) => !gone.has(item.key)))
        }, 260)
        timers.add(timer)
      },
      { defer: true },
    ),
  )
  return (
    <span data-slot="basic-tool-tool-subtitle" data-component="execute-ticker">
      <For each={lines()}>
        {(item) => (
          <span
            data-slot="execute-ticker-line"
            data-old={item.old ? "" : undefined}
            data-still={item.still ? "" : undefined}
            aria-hidden={item.old ? "true" : undefined}
          >
            {item.text}
          </span>
        )}
      </For>
    </span>
  )
}

const R = 8
const C = 2 * Math.PI * R
/** More segments than this read as noise, so the ring fills continuously instead. */
const SEGMENTS = 12

/** The todo ring, one segment per tool call. The total is unknown until the script returns, so segments split as calls start. */
function ExecuteRing(props: { calls: ExecuteCall[]; running: boolean; failed: boolean; live: boolean }) {
  let el: HTMLSpanElement | undefined
  const settled = () => props.calls.filter((call) => call.status !== "running").length
  const done = () => !props.running && !props.failed
  createEffect(
    on(settled, (next, prev) => {
      if (!props.live || prev === undefined || next <= prev || !el || !motion()) return
      el.animate([{ transform: "scale(1)" }, { transform: "scale(1.16)" }, { transform: "scale(1)" }], {
        duration: 340,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      })
    }),
  )
  const gap = () => (props.calls.length > 1 ? 1.9 : 0)
  const length = () => C / props.calls.length - gap()
  const turn = (index: number) => -90 + (index * 360) / props.calls.length + (gap() / C) * 180
  const ratio = () => settled() / Math.max(1, props.calls.length)
  return (
    <span
      ref={el}
      data-slot="execute-ring"
      data-done={done() ? "" : undefined}
      data-celebrate={done() && props.live ? "" : undefined}
      aria-hidden="true"
    >
      <Show when={props.calls.length > 0 || !props.running} fallback={<Spinner />}>
        <svg viewBox="0 0 20 20">
          <Show
            when={!done()}
            fallback={
              <>
                <circle data-slot="execute-check-bg" cx="10" cy="10" r={R} />
                <path data-slot="execute-check" d="M6.3 10.3 L8.9 12.8 L13.8 7.7" />
              </>
            }
          >
            <Show
              when={props.calls.length > 0 && props.calls.length <= SEGMENTS}
              fallback={
                <>
                  <circle data-slot="execute-track" cx="10" cy="10" r={R} />
                  <circle
                    data-slot="execute-fill"
                    data-failed={props.failed ? "" : undefined}
                    cx="10"
                    cy="10"
                    r={R}
                    stroke-dasharray={String(C)}
                    stroke-dashoffset={String(C * (1 - (props.calls.length ? ratio() : 1)))}
                    transform="rotate(-90 10 10)"
                  />
                </>
              }
            >
              <Index each={props.calls}>
                {(call, index) => (
                  <circle
                    data-slot="execute-segment"
                    data-status={call().status}
                    cx="10"
                    cy="10"
                    r={R}
                    stroke-dasharray={`${length()} ${C}`}
                    transform={`rotate(${turn(index)} 10 10)`}
                  />
                )}
              </Index>
            </Show>
          </Show>
        </svg>
      </Show>
    </span>
  )
}

function ExecuteBody(props: {
  calls: ExecuteCall[]
  error: string
  code: string
  output: string
  failed: boolean
  live: boolean
}) {
  const i18n = useI18n()
  const [all, setAll] = createSignal(false)
  const [script, setScript] = createSignal(false)
  // Keep the newest calls in view; the oldest fold away first.
  // Folding a single call saves nothing, so the fold starts at two hidden calls.
  const hidden = () => (all() || props.calls.length <= VISIBLE + 1 ? 0 : props.calls.length - VISIBLE)
  const shown = () => props.calls.slice(hidden())
  return (
    <div data-slot="execute-body">
      <Show when={props.calls.length > 0}>
        <ul data-slot="execute-calls">
          <Show when={hidden() > 0}>
            <li>
              <button type="button" data-slot="execute-more" onClick={() => setAll(true)}>
                {i18n.plural("ui.tool.execute.more", hidden())}
              </button>
            </li>
          </Show>
          <Index each={shown()}>
            {(call) => (
              <li data-slot="execute-call" data-status={call().status} data-live={props.live ? "" : undefined}>
                <CallMark status={call().status} />
                <span data-slot="execute-call-text" title={`${call().tool} ${executeArgs(call().input)}`.trim()}>
                  <span data-slot="execute-call-name">{call().tool}</span>
                  <Show when={executeArgs(call().input)}>
                    {(text) => <span data-slot="execute-call-args"> {text()}</span>}
                  </Show>
                </span>
              </li>
            )}
          </Index>
        </ul>
      </Show>
      <Show when={props.error}>
        <div data-slot="execute-error">{props.error}</div>
      </Show>
      <Show when={props.code || props.output}>
        <button
          type="button"
          data-slot="execute-script-toggle"
          aria-expanded={script()}
          onClick={() => setScript((value) => !value)}
        >
          {script() ? i18n.t("ui.tool.execute.hideScript") : i18n.t("ui.tool.execute.showScript")}
        </button>
        <Show when={script()}>
          <ExecuteDetails code={props.code} output={props.output} failed={props.failed} />
        </Show>
      </Show>
    </div>
  )
}

function CallMark(props: { status: string }) {
  return (
    <span data-slot="execute-call-mark">
      <Switch fallback={<span data-slot="execute-call-dot" />}>
        <Match when={props.status === "running"}>
          <Spinner />
        </Match>
        <Match when={props.status === "completed"}>
          <Icon name="check-small" size="small" />
        </Match>
        <Match when={props.status === "error"}>
          <Icon name="close-small" size="small" />
        </Match>
      </Switch>
    </span>
  )
}

function ExecuteDetails(props: { code: string; output: string; failed: boolean }) {
  const i18n = useI18n()
  const component = useFileComponent()
  const raw = createMemo(() => executeRaw(props.output))
  return (
    <div data-slot="execute-details">
      <Show when={props.code}>
        <section data-slot="execute-details-section">
          <header data-slot="execute-details-header">
            <span>{i18n.t("ui.tool.execute.script")}</span>
            <CopyButton value={props.code} />
          </header>
          <Dynamic
            component={component}
            mode="text"
            file={{ name: "execute.js", contents: props.code, cacheKey: checksum(props.code) }}
            overflow="wrap"
          />
        </section>
      </Show>
      <Show when={props.output}>
        <section data-slot="execute-details-section">
          <header data-slot="execute-details-header">
            <span>{props.failed ? i18n.t("ui.tool.execute.error") : i18n.t("ui.tool.execute.result")}</span>
            <CopyButton value={props.output} />
          </header>
          <Show when={!props.failed} fallback={<pre data-slot="execute-details-error">{props.output}</pre>}>
            <Dynamic
              component={component}
              mode="text"
              file={{
                name: raw().json ? "result.json" : "result.txt",
                contents: raw().text,
                cacheKey: checksum(raw().text),
              }}
              overflow="wrap"
            />
          </Show>
        </section>
      </Show>
    </div>
  )
}

function CopyButton(props: { value: string }) {
  const i18n = useI18n()
  const clipboard = useClipboard()
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    await clipboard.write(props.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Tooltip value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top" gutter={4}>
      <IconButton
        icon={copied() ? "check" : "copy"}
        size="small"
        variant="ghost"
        onClick={copy}
        aria-label={i18n.t("ui.message.copy")}
      />
    </Tooltip>
  )
}

function firstLine(text: string) {
  return (
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? text.trim()
  )
}

function motion() {
  if (typeof window === "undefined" || typeof document === "undefined") return false
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false
  return !document.body.classList.contains("vscode-reduce-motion")
}
