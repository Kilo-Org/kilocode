import { batch, createSignal } from "solid-js"
import { focusSelectedTab, tabForKey } from "../../src/utils/tab-navigation"
import type { ChatRoute } from "./route"

export function createCloudShells(route: ChatRoute) {
  const first = crypto.randomUUID()
  const [tabs, setTabs] = createSignal<string[]>([first])
  const [active, setActive] = createSignal<string>(first)
  const [request, setRequest] = createSignal<{ id: string; serial: number }>({ id: first, serial: 1 })
  const focus = (id: string) =>
    batch(() => {
      setActive(id)
      setRequest((prev) => ({ id, serial: prev.serial + 1 }))
    })
  const add = () => {
    const id = crypto.randomUUID()
    setTabs((p) => [...p, id])
    focus(id)
  }
  const remove = (id: string) => {
    const index = tabs().indexOf(id)
    const left = tabs().filter((tab) => tab !== id)
    if (id === active() && left.length) setActive(left[Math.min(index, left.length - 1)]!)
    setTabs(left)
    return left.length
  }
  return { route, tabs, setTabs, active, setActive, add, focus, remove, request }
}

export type CloudShells = ReturnType<typeof createCloudShells>

export function cloudShellAction(name: string, shells: CloudShells | undefined, close: () => void) {
  if (!shells) return false
  const owner = document.activeElement?.closest(".am-cloud-terminal")
  if (name === "closeTab" && owner) {
    const strip = document.activeElement?.closest('[role="tablist"]')
    if (!shells.remove(shells.active())) close()
    else if (strip) focusSelectedTab(owner)
    else shells.focus(shells.active())
    return true
  }
  const next = name === "terminalNext" || (owner && name === "tabNext")
  const previous = name === "terminalPrevious" || (owner && name === "tabPrevious")
  if (!next && !previous) return false
  const id = tabForKey(shells.tabs(), shells.active(), next ? "ArrowRight" : "ArrowLeft")
  if (id) shells.focus(id)
  return true
}
