import type { ACPService } from "@opencode/cli/acp/service"
import { Effect } from "effect"
import { KiloBinary } from "./binary"

export function wrap(service: ACPService.Interface): ACPService.Interface {
  return {
    ...service,
    initialize: (input) =>
      service.initialize(input).pipe(
        Effect.map((response) => {
          if (response.authMethods == null) return response
          return {
            ...response,
            authMethods: response.authMethods.map((method) => {
              if (method.id !== "opencode-login") return method
              const terminal = method._meta?.["terminal-auth"]
              if (
                !terminal ||
                typeof terminal !== "object" ||
                Array.isArray(terminal) ||
                !("command" in terminal) ||
                terminal.command !== "opencode"
              )
                return method
              return {
                ...method,
                _meta: { ...method._meta, "terminal-auth": { ...terminal, command: KiloBinary } },
              }
            }),
          }
        }),
      ),
  }
}

export * as KiloACP from "./acp-service"
