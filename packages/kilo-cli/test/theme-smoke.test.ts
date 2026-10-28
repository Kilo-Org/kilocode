import { expect, test } from "bun:test"
import { isKiloHome, isKiloThemePicker, stopProcessGroup } from "../script/theme-smoke"

for (const marker of ["●", "▪"]) {
  test(`recognizes the selected Kilo row with marker ${marker}`, () => {
    expect(isKiloThemePicker(`Themes\n\x1b[33m${marker}\x1b[0m   kilo  \n opencode`)).toBe(true)
  })
}

test("a Kilo path in the footer does not count as a selected theme row", () => {
  expect(isKiloThemePicker("/tmp/kilo-theme-smoke-123/workspace")).toBe(false)
  expect(isKiloThemePicker("Themes\n● opencode\n/tmp/kilo-theme-smoke-123/workspace")).toBe(false)
  expect(isKiloThemePicker("Themes\n● kilo-v1\n/tmp/kilo-theme-smoke-123/workspace")).toBe(false)
  expect(isKiloThemePicker("Themes\nkilo\n● opencode")).toBe(false)
  expect(isKiloThemePicker("● kilo")).toBe(false)
})

for (const mode of ["dark", "light"] as const) {
  test(`the ${mode} home screen requires Kilo's primary color`, () => {
    const background = mode === "dark" ? "\x1b[48;2;12;10;9m" : "\x1b[48;2;255;255;255m"
    const primary = mode === "dark" ? "\x1b[38;2;255;221;0m" : "\x1b[38;2;115;100;0m"
    const upstream = mode === "dark" ? "\x1b[38;2;250;178;131m" : "\x1b[38;2;59;125;216m"
    expect(isKiloHome(`${background}ctrl+p commands`, mode)).toBe(false)
    expect(isKiloHome(`${background}${upstream}ctrl+p commands`, mode)).toBe(false)
    expect(isKiloHome(`${background}${primary}ctrl+p commands`, mode)).toBe(true)
    expect(isKiloHome(`${background}${primary}not ready`, mode)).toBe(false)
    expect(isKiloHome(`${primary}ctrl+p commands`, mode)).toBe(false)
  })
}

test.skipIf(process.platform === "win32")(
  "forced cleanup stops the wrapper and its descendant",
  async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `Bun.spawn([process.execPath, "-e", "console.log('descendant ready'); setInterval(() => {}, 1000)"], {
          stdin: "ignore", stdout: "inherit", stderr: "inherit"
        });
        console.log("wrapper ready");
        setInterval(() => {}, 1000);`,
      ],
      { detached: true, stdin: "ignore", stdout: "pipe", stderr: "inherit" },
    )
    const ready = Promise.withResolvers<void>()
    const output = (async () => {
      const decoder = new TextDecoder()
      const chunks: string[] = []
      for await (const chunk of child.stdout) {
        chunks.push(decoder.decode(chunk, { stream: true }))
        if (chunks.join("").includes("wrapper ready") && chunks.join("").includes("descendant ready")) ready.resolve()
      }
      return chunks.join("")
    })()
    try {
      await Promise.race([
        ready.promise,
        Bun.sleep(5_000).then(() => {
          throw new Error("Timed out waiting for the process tree")
        }),
      ])
      await stopProcessGroup(child)
      expect(child.signalCode).toBe("SIGKILL")
      const text = await Promise.race([
        output,
        Bun.sleep(5_000).then(() => {
          throw new Error("The descendant still holds the output pipe open")
        }),
      ])
      expect(text).toContain("wrapper ready")
      expect(text).toContain("descendant ready")
    } finally {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
      }
      child.kill("SIGKILL")
      await child.exited
      await output
    }
  },
  20_000,
)

test.skipIf(process.platform === "win32")("cleanup accepts an already exited process group", async () => {
  const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], {
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
  expect(await child.exited).toBe(0)
  await expect(stopProcessGroup(child)).resolves.toBeUndefined()
})
