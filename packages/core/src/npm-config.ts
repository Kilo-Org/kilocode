export * as NpmConfig from "./npm-config"

import { fileURLToPath } from "url"
// @ts-expect-error npm does not publish types for this internal config API.
import Config from "@npmcli/config"
// @ts-expect-error npm does not publish types for this internal config API.
import { definitions, flatten, nerfDarts, shorthands } from "@npmcli/config/lib/definitions/index.js"
import { Effect } from "effect"

const npmPath = fileURLToPath(new URL("..", import.meta.url))

export const load = (dir: string) =>
  Effect.tryPromise({
    try: async () => {
      const config = new Config({
        npmPath,
        cwd: dir,
        env: { ...process.env },
        argv: [process.execPath, process.execPath],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        // kilocode_change start - npm's user-agent flattener writes to process.env.
        flatten: (data: Record<string, unknown>, flat: Record<string, unknown>) => {
          const agent = process.env.npm_config_user_agent
          try {
            return flatten(data, flat)
          } finally {
            if (agent == null) delete process.env.npm_config_user_agent
            if (agent != null) process.env.npm_config_user_agent = agent
          }
        },
        // kilocode_change end
        nerfDarts,
        shorthands,
        warn: false,
      })
      await config.load()
      return config.flat as Record<string, unknown>
    },
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => ({}) as Record<string, unknown>))

export const registry = (dir: string) =>
  load(dir).pipe(
    Effect.map((config) => {
      const registry = typeof config.registry === "string" ? config.registry : "https://registry.npmjs.org"
      return registry.endsWith("/") ? registry.slice(0, -1) : registry
    }),
  )
