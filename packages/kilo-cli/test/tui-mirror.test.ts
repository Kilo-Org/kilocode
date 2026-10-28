import { expect, test } from "bun:test"

const upstream = new URL("../../cli/src/commands/handlers/default.ts", import.meta.url)
const mirror = new URL("../src/tui-handler.ts", import.meta.url)

function normalize(source: string) {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .map((line) => line.replace(/\s+\/\/ kilocode_change.*$/, ""))
    .filter((line) => line.trim() !== "")
    .join("\n")
}

test("the Kilo TUI handler stays in step with the upstream handler", async () => {
  const replacements = new Map([
    ['"../commands"', '"@opencode/cli/commands/commands"'],
    ['"../../framework/runtime"', '"@opencode/cli/framework/runtime"'],
    ['"../../config"', '"@opencode/cli/config/index"'],
    ['"../../services/server-connection"', '"@opencode/cli/services/server-connection"'],
    ['"../../services/updater"', '"@opencode/cli/services/updater"'],
    ['"../../services/update-preflight"', '"../../cli/src/services/update-preflight"'],
    ['"../../version"', '"@opencode/cli/version"'],
    ['"../../env"', '"@opencode/cli/env"'],
    ['"../../session-target"', '"@opencode/cli/session-target"'],
    ['"../../util/error"', '"@opencode/cli/util/error"'],
  ])
  const source = await Bun.file(upstream).text()
  const expected = [...replacements].reduce((text, [from, to]) => {
    expect(text.split(from)).toHaveLength(2)
    return text.replace(from, to)
  }, source)
  const host = await Bun.file(mirror).text()
  expect(host.split('import { createKiloModelPicker } from "../../tui/src/kilocode/dialog-model"')).toHaveLength(2)
  expect(
    host.split('capabilities: { modelPicker: createKiloModelPicker, terminalInput: "attached-only" }'),
  ).toHaveLength(2)
  const actual = host
    .replace('import { createKiloModelPicker } from "../../tui/src/kilocode/dialog-model"\n', "")
    .replace(
      /        capabilities: \{ modelPicker: createKiloModelPicker, terminalInput: "attached-only" \}, \/\/ Kilo: host TUI capabilities; .*\n/,
      "",
    )
  const call =
    "findSession(OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) }), session)"
  expect(expected.split(call)).toHaveLength(2)
  expect(normalize(actual)).toBe(
    normalize(
      expected.replace(
        call,
        `findSession(\n            OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) }),\n            session,\n          )`,
      ),
    ),
  )
})
