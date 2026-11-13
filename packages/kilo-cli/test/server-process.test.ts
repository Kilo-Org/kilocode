import { expect, test } from "bun:test"
import path from "node:path"
import { KiloBinary } from "../src/binary"
import { KiloBranding } from "../src/branding/text"

// The branding loader renames `opencode <command>` only in the upstream files it lists, so a command hint the mirror
// copies stays unbranded unless the mirror names the Kilo binary itself. The mirror is compared with the upstream
// file as the host loads it (branded): a hint that reads `opencode ...` again, or any other drift, fails here.
test("server process mirror differs from the branded upstream file only at host integration points", async () => {
  const file = path.join(import.meta.dir, "../../cli/src/server-process.ts")
  const upstream = KiloBranding.transform(file, await Bun.file(file).text())
  // The registry marker added by #16130 is not part of the upstream comparison.
  const mirror = (await Bun.file(path.join(import.meta.dir, "../src/server-process.ts")).text())
    .replaceAll("\r\n", "\n")
    .replace(/^\/\/ kilo_mirror: \S+\n/, "")
  const replace = (source: string, from: string, to: string) => {
    expect(source.split(from)).toHaveLength(2)
    return source.replace(from, to)
  }
  const imports = [
    "version",
    "env",
    "services/port-owner",
    "services/service-config",
    "services/retained-image",
    "services/service-registration",
    "services/remote-tunnel",
    "services/web-ui",
    "database-path",
  ].reduce(
    (source, name) => replace(source, `from "./${name}"`, `from "@opencode/cli/${name}"`),
    "// Kilo-owned mirror of @opencode/cli/server-process: adds authenticated remote HTTP aliases.\n" + upstream,
  )
  const edits = [
    [
      'import { databasePath } from "@opencode/cli/database-path"',
      'import { databasePath } from "@opencode/cli/database-path"\nimport { KiloBinary } from "./binary"\nimport { RemoteHttp } from "./remote/http"',
    ],
    ["        transform,\n", "        (app) => RemoteHttp.transform(transform ? transform(app) : app),\n"],
    ["options.overrides, // kilocode_change(host) seam - pass the overrides through", "options.overrides,"],
    // The hint the branding loader produces for the upstream file is the text the mirror renders.
    [
      `"Configure another port with \`${KiloBinary} service set port <port>\` and start the service again.",`,
      "// Kilo: the branding loader renames commands only in the upstream file, so the mirror names the binary.\n" +
        "                  `Configure another port with \\`${KiloBinary} service set port <port>\\` and start the service again.`,",
    ],
  ] as const
  expect(mirror).toBe(edits.reduce((source, [from, to]) => replace(source, from, to), imports))
})
