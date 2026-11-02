import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { File } from "../src/components/file"
import { ToolRegistry, type ToolProps } from "../src/components/message-part"
import { FileComponentProvider } from "../src/context/file"

export type Mounted = {
  host: HTMLDivElement
  dispose: () => void
}

export function mount(view: () => JSX.Element): Mounted {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(view, host)
  return {
    host,
    dispose() {
      dispose()
      host.remove()
    },
  }
}

const defaults: ToolProps = {
  input: {},
  metadata: {},
  tool: "",
  partID: "part",
  output: "",
  status: "completed",
  attachments: [],
}

export function mountTool(name: string, props: Partial<ToolProps> = {}) {
  const Renderer = ToolRegistry.render(name)
  if (!Renderer) throw new Error(`No renderer registered for ${name}`)
  const merged = { ...defaults, ...props, tool: name }
  return mount(() => (
    <FileComponentProvider component={File}>
      <Renderer {...merged} />
    </FileComponentProvider>
  ))
}

export async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

export async function waitFor<T>(probe: () => T | null | undefined, timeout = 1000) {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error("Timed out waiting for the rendered element")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export function trigger(host: ParentNode) {
  const element = host.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]')
  if (!element) throw new Error("Collapsible trigger not found")
  return element
}

export function body(host: ParentNode) {
  return host.querySelector<HTMLElement>('[data-slot="collapsible-content"]')
}
