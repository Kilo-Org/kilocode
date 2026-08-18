import type { JSX } from "solid-js"
import type { PermissionRequest } from "@kilocode/sdk/v2"

export type PermissionInfo = { icon: string; title: string; body: JSX.Element }
export type PermissionRenderer = (request: PermissionRequest) => PermissionInfo

export namespace MemoryPermissionRegistry {
  const renderers = new Map<string, PermissionRenderer>()

  export function register(id: string, renderer: PermissionRenderer) {
    renderers.set(id, renderer)
  }

  export function render(id: string, request: PermissionRequest) {
    return renderers.get(id)?.(request)
  }
}
