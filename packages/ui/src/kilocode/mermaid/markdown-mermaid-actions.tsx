import { createSignal, Show } from "solid-js"
import { render } from "solid-js/web"
import { Button } from "../../components/button"
import { DropdownMenu } from "../../components/dropdown-menu"
import type { MermaidLabels } from "./markdown-mermaid"
import { MermaidZoom } from "./markdown-mermaid-zoom"

type Props = {
  labels: MermaidLabels
  svg: () => string
  onCopySource: () => Promise<void>
  onCopySvg: () => Promise<void>
  onCopyPng: () => Promise<void>
  onDownloadSvg: () => void
  onDownloadPng: () => Promise<void>
}

function Chevron() {
  return (
    <span data-slot="markdown-mermaid-chevron" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.6"
        />
      </svg>
    </span>
  )
}

function Expand() {
  return (
    <span data-slot="markdown-mermaid-expand" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M3.5 6.5V3.5H6.5M9.5 3.5H12.5V6.5M12.5 9.5V12.5H9.5M6.5 12.5H3.5V9.5"
          stroke="currentColor"
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.4"
        />
      </svg>
    </span>
  )
}

function Trigger(props: { label: string; copied?: boolean; copiedLabel?: string }) {
  return (
    <DropdownMenu.Trigger as={Button} variant="secondary" size="small" class="markdown-mermaid-trigger">
      <span>{props.copied ? props.copiedLabel : props.label}</span>
      <Chevron />
    </DropdownMenu.Trigger>
  )
}

function Item(props: { label: string; onSelect: () => void }) {
  return (
    <DropdownMenu.Item onSelect={props.onSelect}>
      <DropdownMenu.ItemLabel>{props.label}</DropdownMenu.ItemLabel>
    </DropdownMenu.Item>
  )
}

export function MermaidActions(props: Props) {
  const [copied, setCopied] = createSignal(false)
  const [zoomed, setZoomed] = createSignal(false)
  const copy = (run: () => Promise<void>) => {
    void run()
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch((err) => {
        // Avoid unhandledrejection; Copy PNG used to fail silently under webview CSP.
        console.warn("Mermaid copy failed", err)
      })
  }

  return (
    <div data-slot="markdown-mermaid-actions">
      <Button variant="secondary" size="small" class="markdown-mermaid-trigger" onClick={() => setZoomed(true)}>
        <span>{props.labels.zoom}</span>
        <Expand />
      </Button>
      <DropdownMenu gutter={4} placement="bottom-start">
        <Trigger label={props.labels.copy} copied={copied()} copiedLabel={props.labels.copied} />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <Item label={props.labels.copySource} onSelect={() => copy(props.onCopySource)} />
            <Item label={props.labels.copySvg} onSelect={() => copy(props.onCopySvg)} />
            <Item label={props.labels.copyPng} onSelect={() => copy(props.onCopyPng)} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <DropdownMenu gutter={4} placement="bottom-start">
        <Trigger label={props.labels.download} />
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <Item label={props.labels.downloadSvg} onSelect={props.onDownloadSvg} />
            <Item label={props.labels.downloadPng} onSelect={() => void props.onDownloadPng()} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <Show when={zoomed()}>
        <MermaidZoom svg={props.svg} labels={props.labels} onClose={() => setZoomed(false)} />
      </Show>
    </div>
  )
}

export function mountMermaidActions(el: HTMLElement, props: Props) {
  const host = document.createElement("div")
  host.setAttribute("data-slot", "markdown-mermaid-actions-root")
  el.insertBefore(host, el.firstChild)
  return render(() => <MermaidActions {...props} />, host)
}
