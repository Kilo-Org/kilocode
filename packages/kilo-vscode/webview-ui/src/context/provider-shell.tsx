import { onCleanup, onMount, type Component, type ParentComponent } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { MarkedProvider } from "@kilocode/kilo-ui/context/marked"
import { CodeComponentProvider } from "@kilocode/kilo-ui/context/code"
import { DiffComponentProvider } from "@kilocode/kilo-ui/context/diff"
import { FileComponentProvider } from "@kilocode/kilo-ui/context/file"
import { Code } from "@kilocode/kilo-ui/code"
import { Diff } from "@kilocode/kilo-ui/diff"
import { File } from "@kilocode/kilo-ui/file"
import { Toast } from "@kilocode/kilo-ui/toast"
import { VSCodeProvider, useVSCode } from "./vscode"
import { ServerProvider } from "./server"
import { ProviderProvider } from "./provider"
import { ConfigProvider } from "./config"
import { DisplayProvider } from "./display"
import { IndexingProvider } from "./indexing"
import { AgentRequirementsProvider } from "./agent-requirements"
import { MemoryProvider } from "./memory"
import { SessionProvider } from "./session"
import { LanguageBridge } from "./language-bridge"
import { NotificationsProvider } from "./notifications"
import { FeedbackProvider } from "./feedback"
import { KiloEmbeddingModelsProvider } from "./kilo-embedding-models"
import { ImageModelsProvider } from "./image-models"
import { SpeechToTextModelsProvider } from "./speech-to-text-models"
import { SpeechToTextPrewarm } from "../components/speech-to-text/SpeechToTextPrewarm"

type MermaidImageEvent = CustomEvent<{ dataUrl: string; filename: string }>

const MermaidDownloadBridge: Component = () => {
  const vscode = useVSCode()

  onMount(() => {
    const save = (event: Event) => {
      const detail = (event as MermaidImageEvent).detail
      if (!detail?.dataUrl || !detail.filename) return
      event.preventDefault()
      vscode.postMessage({ type: "saveImage", dataUrl: detail.dataUrl, filename: detail.filename })
    }
    window.addEventListener("kilo:save-image", save)
    onCleanup(() => window.removeEventListener("kilo:save-image", save))
  })

  return null
}

const Root: ParentComponent = (props) => (
  <ThemeProvider defaultTheme="kilo-vscode">
    <DialogProvider>
      <VSCodeProvider>
        <MermaidDownloadBridge />
        <ServerProvider>
          <LanguageBridge>
            <MarkedProvider>
              <DiffComponentProvider component={Diff}>
                <CodeComponentProvider component={Code}>
                  <FileComponentProvider component={File}>
                    <ProviderProvider>
                      <ConfigProvider>
                        <SpeechToTextPrewarm />
                        <DisplayProvider>{props.children}</DisplayProvider>
                      </ConfigProvider>
                    </ProviderProvider>
                  </FileComponentProvider>
                </CodeComponentProvider>
              </DiffComponentProvider>
            </MarkedProvider>
          </LanguageBridge>
        </ServerProvider>
      </VSCodeProvider>
      <Toast.Region />
    </DialogProvider>
  </ThemeProvider>
)

const Session: ParentComponent = (props) => (
  <IndexingProvider>
    <KiloEmbeddingModelsProvider>
      <ImageModelsProvider>
        <SpeechToTextModelsProvider>
          <NotificationsProvider>
            <SessionProvider>{props.children}</SessionProvider>
          </NotificationsProvider>
        </SpeechToTextModelsProvider>
      </ImageModelsProvider>
    </KiloEmbeddingModelsProvider>
  </IndexingProvider>
)

const Chat: ParentComponent = (props) => (
  <AgentRequirementsProvider>
    <MemoryProvider>
      <FeedbackProvider>{props.children}</FeedbackProvider>
    </MemoryProvider>
  </AgentRequirementsProvider>
)

export const ProviderShell = { Root, Session, Chat }
