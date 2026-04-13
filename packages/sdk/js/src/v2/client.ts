export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { KiloClient } from "./gen/sdk.gen.js"
export { type Config as KiloClientConfig, KiloClient }

function pick(value: string | null, fallback?: string, encode?: (value: string) => string) {
  if (!value) return
  if (!fallback) return value
  if (value === fallback) return fallback
  if (encode && value === encode(fallback)) return fallback
  return value
}

function rewrite(request: Request, values: { directory?: string; workspace?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") return request

  const url = new URL(request.url)
  let changed = false

  for (const [name, key] of [
    ["x-kilo-directory", "directory"],
    ["x-kilo-workspace", "workspace"],
  ] as const) {
    const value = pick(
      request.headers.get(name),
      key === "directory" ? values.directory : values.workspace,
      key === "directory" ? encodeURIComponent : undefined,
    )
    if (!value) continue
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value)
    }
    changed = true
  }

  if (!changed) return request

  const next = new Request(url, request)
  next.headers.delete("x-kilo-directory")
  next.headers.delete("x-kilo-workspace")
  return next
}

export function createKiloClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // Pass duplex in the init arg so it survives VS Code's proxy-agent
      // fetch wrapper, which calls originalFetch(request, { ...init, dispatcher })
      // and would otherwise drop duplex from the cloned Request.
      // timeout: false disables Bun's default request timeout for long-running
      // streaming calls (replaces the old req.timeout = false assignment which
      // wouldn't survive the clone triggered by passing an init object).
      return fetch(req, { duplex: "half", timeout: false } as any)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-kilo-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-kilo-workspace": config.experimental_workspaceID,
    }
  }

  // Node.js/Electron require duplex: "half" when creating Request objects
  // with a body. The option propagates through config → opts → requestInit
  // and is harmless in environments that don't need it (Bun, browsers).
  ;(config as any).duplex = "half"

  const client = createClient(config)
  client.interceptors.request.use((request) =>
    rewrite(request, {
      directory: config?.directory,
      workspace: config?.experimental_workspaceID,
    }),
  )
  return new KiloClient({ client })
}
