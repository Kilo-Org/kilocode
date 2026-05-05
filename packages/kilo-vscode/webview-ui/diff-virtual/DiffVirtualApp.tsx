import { createMemo, createSignal, onCleanup, Show } from "solid-js"
import type { Component } from "solid-js"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { normalize, text } from "@kilocode/kilo-ui/session-diff"
import { LanguageProvider, useLanguage } from "../src/context/language"
import { ServerProvider, useServer } from "../src/context/server"
import { getVSCodeAPI, VSCodeProvider } from "../src/context/vscode"
import { isMarkdownFile, MarkdownDiffView } from "../agent-manager/MarkdownDiffView"

type DiffStyle = "unified" | "split"

interface DiffVirtualFile {
  file: string
  patch?: string
  before?: string
  after?: string
  additions: number
  deletions: number
}

const DiffVirtualContent: Component = () => {
  const { t } = useLanguage()
  const [diff, setDiff] = createSignal<DiffVirtualFile | null>(null)
  const [style, setStyle] = createSignal<DiffStyle>("unified")
  const [markdown, setMarkdown] = createSignal(false)

  const handler = (event: MessageEvent) => {
    const msg = event.data as {
      type: string
      diff?: DiffVirtualFile
      initialDiffStyle?: DiffStyle
      markdownRender?: boolean
    }
    if (msg?.type === "diffVirtual.data" && msg.diff) {
      setDiff(msg.diff)
      setStyle(msg.initialDiffStyle ?? "unified")
      setMarkdown(msg.markdownRender === true)
    }
  }

  window.addEventListener("message", handler)
  onCleanup(() => window.removeEventListener("message", handler))

  const filename = () => {
    const f = diff()?.file ?? ""
    return f.includes("/") ? (f.split("/").pop() ?? f) : f
  }

  const directory = () => {
    const f = diff()?.file ?? ""
    if (!f.includes("/")) return null
    return f.split("/").slice(0, -1).join("/")
  }

  const resolved = createMemo(() => {
    const d = diff()
    if (!d) return { before: "", after: "" }
    if (d.before !== undefined || d.after !== undefined) return { before: d.before ?? "", after: d.after ?? "" }
    if (d.patch) {
      const view = normalize(d as { file: string; patch: string; additions: number; deletions: number })
      return { before: text(view, "deletions"), after: text(view, "additions") }
    }
    return { before: "", after: "" }
  })

  return (
    <div class="am-review-layout kilo-diff-theme">
      <Show when={diff()}>
        {(d) => (
          <>
            <div class="am-review-toolbar">
              <div class="am-review-toolbar-left">
                <RadioGroup
                  options={["unified", "split"] as const}
                  current={style()}
                  size="small"
                  value={(s) => s}
                  label={(s) =>
                    s === "unified" ? t("ui.sessionReview.diffStyle.unified") : t("ui.sessionReview.diffStyle.split")
                  }
                  onSelect={(s) => {
                    if (s) setStyle(s)
                  }}
                />
                <span class="am-review-toolbar-stats">
                  <FileIcon node={{ path: d().file, type: "file" }} />
                  <Show when={directory()}>
                    <span class="am-review-toolbar-dir">{`\u2066${directory()}/\u2069`}</span>
                  </Show>
                  <span class="am-review-toolbar-fname">{filename()}</span>
                  <span class="am-review-toolbar-adds">+{d().additions}</span>
                  <span class="am-review-toolbar-dels">-{d().deletions}</span>
                </span>
              </div>
              <Show when={isMarkdownFile(d().file)}>
                <Tooltip value={markdown() ? "Show raw Markdown" : "Render Markdown"} placement="bottom">
                  <IconButton
                    icon={markdown() ? "code" : "eye"}
                    size="small"
                    variant="ghost"
                    label={markdown() ? "Show raw Markdown" : "Render Markdown"}
                    onClick={() => {
                      const next = !markdown()
                      setMarkdown(next)
                      getVSCodeAPI().postMessage({ type: "diffVirtual.setMarkdownRender", render: next })
                    }}
                  />
                </Tooltip>
              </Show>
            </div>
            <div class="am-review-diff" style={{ width: "100%" }}>
              <Show
                when={markdown() && isMarkdownFile(d().file)}
                fallback={
                  <Diff
                    before={{ name: d().file, contents: resolved().before }}
                    after={{ name: d().file, contents: resolved().after }}
                    diffStyle={style()}
                  />
                }
              >
                <MarkdownDiffView diff={{ file: d().file, before: resolved().before, after: resolved().after }} />
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}

const DiffVirtualShell: Component = () => {
  const server = useServer()

  return (
    <LanguageProvider vscodeLanguage={server.vscodeLanguage} languageOverride={server.languageOverride}>
      <DiffComponentProvider component={Diff}>
        <CodeComponentProvider component={Code}>
          <FileComponentProvider component={File}>
            <MarkedProvider>
              <DiffVirtualContent />
            </MarkedProvider>
          </FileComponentProvider>
        </CodeComponentProvider>
      </DiffComponentProvider>
    </LanguageProvider>
  )
}

export const DiffVirtualApp: Component = () => {
  return (
    <ThemeProvider defaultTheme="kilo-vscode">
      <VSCodeProvider>
        <ServerProvider>
          <DiffVirtualShell />
        </ServerProvider>
      </VSCodeProvider>
    </ThemeProvider>
  )
}
