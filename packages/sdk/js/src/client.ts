export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import { type Config } from "./gen/client/types.gen.js"
import { KiloClient } from "./gen/sdk.gen.js"
export { type Config as KiloClientConfig, KiloClient }

export function createKiloClient(config?: Config & { directory?: string }) {
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

  // Node.js/Electron require duplex: "half" when creating Request objects
  // with a body. The option propagates through config → opts → requestInit
  // and is harmless in environments that don't need it (Bun, browsers).
  ;(config as any).duplex = "half"

  const client = createClient(config)
  return new KiloClient({ client })
}
