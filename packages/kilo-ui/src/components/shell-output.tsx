import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import { getSharedHighlighter } from "@pierre/diffs"
import { useClipboard } from "../context/clipboard"
import { deferredHighlight } from "../context/marked"
import { useI18n } from "../context/i18n"
import { createAutoScroll } from "../hooks/create-auto-scroll"
import { escapeHtml } from "../util/escape-html"
import { IconButton } from "./icon-button"
import { bashLineUpdate } from "./tool-utils"
import { Tooltip } from "./tooltip"

function Copy(props: { value: string }) {
  const i18n = useI18n()
  const clipboard = useClipboard()
  const [copied, setCopied] = createSignal(false)
  const copy = async () => {
    if (!props.value) return
    await clipboard.write(props.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Tooltip value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="bottom" gutter={4}>
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

const highlighter: { current?: ReturnType<typeof getSharedHighlighter> } = {}

async function highlight(text: string) {
  try {
    highlighter.current ??= getSharedHighlighter({ themes: ["Kilo"], langs: [] }).catch((error: unknown) => {
      highlighter.current = undefined
      throw error
    })
    const value = await highlighter.current
    if (!value.getLoadedLanguages().includes("log")) await value.loadLanguage("log")
    const node = document.createElement("div")
    node.innerHTML = value.codeToHtml(text, { lang: "log", theme: "Kilo", tabindex: false })
    return node.querySelector("code")?.innerHTML
  } catch (error) {
    console.warn("Shell output highlight failed", error)
    return undefined
  }
}

export function ShellOutput(props: { cmd: string; output: string; active: boolean; running: boolean }) {
  const output = createMemo(() =>
    stripAnsi(props.output)
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => {
        if (!line.includes("\r")) return line
        return line.split("\r").findLast((frame) => frame !== "") ?? ""
      })
      .join("\n"),
  )
  const [command, setCommand] = createSignal<HTMLDivElement>()
  const [result, setResult] = createSignal<HTMLDivElement>()
  const rendered = { lines: [] as string[], version: 0 }
  const scroll = createAutoScroll({ working: () => props.running })
  const bind = (node: HTMLDivElement) => {
    setResult(node)
    scroll.scrollRef(node)
    scroll.contentRef(node)
  }
  const paint = async (node: HTMLDivElement, text: string, version: number) => {
    const lines = text.split("\n")
    const plan = node.querySelector("code")
      ? bashLineUpdate(rendered.lines, lines)
      : { start: 0, skip: false, shift: 0 }
    if (plan.skip) return
    const inner = await highlight(lines.slice(plan.start).join("\n"))
    if (version !== rendered.version || !node.isConnected) return
    if (inner === undefined) {
      rendered.lines = []
      node.innerHTML = `<pre data-slot="bash-pre"><code>${escapeHtml(text)}</code></pre>`
      return
    }
    const code = node.querySelector("code")
    if (!code) {
      node.innerHTML = `<pre data-slot="bash-pre"><code>${inner}</code></pre>`
      rendered.lines = lines.slice(plan.start)
      return
    }
    if (plan.start === 0) code.textContent = ""
    if (plan.start > 0 && plan.shift > 0) {
      const first = code.children.item(plan.shift)
      const range = document.createRange()
      range.setStart(code, 0)
      if (first) range.setEndBefore(first)
      if (!first && code.lastChild) range.setEndAfter(code.lastChild)
      range.deleteContents()
    }
    const first = code.children.item(plan.start)
    if (plan.start > 0 && first && code.lastChild) {
      const range = document.createRange()
      range.setStartBefore(first)
      range.setEndAfter(code.lastChild)
      range.deleteContents()
    }
    const tail = code.lastChild
    const separator =
      code.childNodes.length && !(tail?.nodeType === Node.TEXT_NODE && tail.textContent === "\n") ? "\n" : ""
    code.insertAdjacentHTML("beforeend", separator + inner)
    rendered.lines = lines
  }
  createEffect(() => {
    const node = command()
    const text = props.cmd
    if (!props.active || !node || !text) return
    const signal = { aborted: false }
    node.innerHTML = `<pre data-slot="bash-pre"><code data-lang="shellscript">${escapeHtml(text)}</code></pre>`
    void deferredHighlight(node, undefined, signal)
    onCleanup(() => {
      signal.aborted = true
    })
  })
  createEffect(() => {
    const node = result()
    const text = output()
    if (!node) return
    if (!props.active || !text) {
      rendered.version++
      rendered.lines = []
      if (!text) node.innerHTML = ""
      return
    }
    void paint(node, text, ++rendered.version)
  })
  onCleanup(() => {
    rendered.version++
  })
  return (
    <div data-component="bash-output">
      <Show when={props.cmd}>
        <div data-slot="bash-terminal" data-kind="command">
          <div data-slot="bash-section" data-kind="command">
            <span data-slot="bash-prompt" aria-hidden="true">
              $
            </span>
            <div data-slot="bash-section-code" data-scrollable ref={setCommand} />
            <div data-slot="bash-section-actions">
              <Copy value={props.cmd} />
            </div>
          </div>
        </div>
      </Show>
      <Show when={output()}>
        <div data-slot="bash-terminal" data-kind="output">
          <div data-slot="bash-section" data-kind="output">
            <div data-slot="bash-section-code" data-scrollable ref={bind} />
            <div data-slot="bash-section-actions">
              <Copy value={output()} />
            </div>
          </div>
        </div>
      </Show>
    </div>
  )
}
