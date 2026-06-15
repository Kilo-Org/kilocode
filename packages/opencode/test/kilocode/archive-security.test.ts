import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { tmpdir } from "../fixture/fixture"

test("extracts ZIP paths with PowerShell metacharacters literally", async () => {
  if (process.platform !== "win32") return

  await using tmp = await tmpdir()
  const source = path.join(tmp.path, "content.txt")
  const archive = path.join(tmp.path, "archive'; exit 42; #.zip")
  const dest = path.join(tmp.path, "dest'; exit 42; #")
  const cmd = "Compress-Archive -LiteralPath $env:KILO_TEST_SOURCE -DestinationPath $env:KILO_TEST_ARCHIVE -Force"

  await fs.writeFile(source, "safe")
  await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd], {
    env: {
      KILO_TEST_SOURCE: source,
      KILO_TEST_ARCHIVE: archive,
    },
  })
  await Archive.extractZip(archive, dest)

  expect(await fs.readFile(path.join(dest, "content.txt"), "utf8")).toBe("safe")
})
