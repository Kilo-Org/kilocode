import { createSignal, onCleanup, Show } from "solid-js"
import type { Component } from "solid-js"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { FileIcon } from "@kilocode/kilo-ui/file-icon"
import { RadioGroup } from "@kilocode/kilo-ui/radio-group"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { LanguageProvider, useLanguage } from "../src/context/language"
import { ServerProvider, useServer } from "../src/context/server"
import { VSCodeProvider } from "../src/context/vscode"

type DiffStyle = "unified" | "split"

interface DiffVirtualFile {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

const DiffVirtualContent: Component = () => {
  const { t } = useLanguage()
  const [diff, setDiff] = createSignal<DiffVirtualFile | null>(null)
  const [style, setStyle] = createSignal<DiffStyle>("unified")

  const handler = (event: MessageEvent) => {
    const msg = event.data as { type: string; diff?: DiffVirtualFile }
    if (msg?.type === "diffVirtual.data" && msg.diff) {
      setDiff(msg.diff)
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

  return (
    <div class="am-review-layout">
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
                    <span class="am-review-toolbar-dir">{`\u202A${directory()}/\u202C`}</span>
                  </Show>
                  <span class="am-review-toolbar-fname">{filename()}</span>
                  <span class="am-review-toolbar-adds">+{d().additions}</span>
                  <span class="am-review-toolbar-dels">-{d().deletions}</span>
                </span>
              </div>
            </div>
            <div class="am-review-diff" style={{ width: "100%" }}>
              <Diff
                before={{ name: d().file, contents: d().before }}
                after={{ name: d().file, contents: d().after }}
                diffStyle={style()}
              />
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
