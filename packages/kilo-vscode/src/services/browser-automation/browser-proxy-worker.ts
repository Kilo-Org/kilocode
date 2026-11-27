import { parentPort } from "node:worker_threads"
import { BrowserProxy, type BrowserProxyConfig } from "./browser-proxy"

const port = parentPort
if (!port) throw new Error("Browser proxy requires a worker thread")

void BrowserProxy.start("public")
  .then(({ proxy, credentials }) => port.postMessage({ proxy, credentials } satisfies BrowserProxyConfig))
  .catch(() => process.exit(1))
