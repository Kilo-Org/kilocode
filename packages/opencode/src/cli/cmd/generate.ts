import { Server } from "../../server/server"
import type { CommandModule } from "yargs"

export const GenerateCommand = {
  command: "generate",
  handler: async () => {
    const specs = await Server.openapi()
    // kilocode_change start
    specs.info.title = "kilo"
    specs.info.description = "kilo api"
    // kilocode_change end
    for (const item of Object.values(specs.paths)) {
      for (const method of ["get", "post", "put", "delete", "patch"] as const) {
        const operation = item[method]
        if (!operation?.operationId) continue
        // @ts-expect-error
        operation["x-codeSamples"] = [
          // kilocode_change start
          {
            lang: "js",
            source: [
              `import { createKiloClient } from "@kilocode/sdk`,
              ``,
              `const client = createKiloClient()`,
              `await client.${operation.operationId}({`,
              `  ...`,
              `})`,
            ].join("\n"),
          },
          // kilocode_change end,
        ]
      }
    }
    // kilocode_change start - replace upstream product name in all descriptions
    const json = JSON.stringify(specs, null, 2)
      .replaceAll("OpenCode", "Kilo")
      .replaceAll("opencode.local", "kilo.local")
      .replaceAll("opencode serve", "kilo serve")
      .replaceAll("https://opencode.ai/", "https://kilo.ai/")
    // kilocode_change end

    // Wait for stdout to finish writing before process.exit() is called
    await new Promise<void>((resolve, reject) => {
      process.stdout.write(json, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  },
} satisfies CommandModule
