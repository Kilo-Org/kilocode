import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { RemoteRpc } from "@opencode-ai/schema/kilocode/remote"
import { result, type AdapterOptions } from "./result"

export function createRemoteMethods(client: OpenCodeClient, defaultDirectory: string) {
  const remote = client.rpc(RemoteRpc)
  return {
    status: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(
        () =>
          remote.status({}, { location: { directory: input.directory ?? defaultDirectory }, signal: options?.signal }),
        options,
      ),
    enable: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(
        () =>
          remote.enable({}, { location: { directory: input.directory ?? defaultDirectory }, signal: options?.signal }),
        options,
      ),
    disable: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(
        () =>
          remote.disable({}, { location: { directory: input.directory ?? defaultDirectory }, signal: options?.signal }),
        options,
      ),
  }
}
