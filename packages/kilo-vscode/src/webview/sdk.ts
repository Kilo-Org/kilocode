export * from "../../../sdk/js/src/v2/gen/types.gen"

import { createClient } from "../../../sdk/js/src/v2/gen/client/client.gen"
import { type Config } from "../../../sdk/js/src/v2/gen/client/types.gen"
import { OpencodeClient } from "../../../sdk/js/src/v2/gen/sdk.gen"

export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & { directory?: string }) {
  if (config?.directory) {
    const isNonASCII = /[^\x00-\x7F]/.test(config.directory)
    const encodedDirectory = isNonASCII ? encodeURIComponent(config.directory) : config.directory
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodedDirectory,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
