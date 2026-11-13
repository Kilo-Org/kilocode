import { expect, test } from "bun:test"
import { hasKiloPrompt, isKiloHome, isKiloThemePicker, stopProcessGroup } from "../script/theme-smoke"

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

for (const frame of [
  {
    mode: "dark",
    ink: "255;221;0",
    terminal: "12;10;9",
    kiloPrompt: "41;37;36",
    kiloText: "166;160;155",
    upstreamBackground: "10;10;10",
    upstreamPrompt: "30;30;30",
    upstreamText: "128;128;128",
  },
  {
    mode: "light",
    ink: "115;100;0",
    terminal: "255;255;255",
    kiloPrompt: "245;245;244",
    kiloText: "121;113;107",
    upstreamBackground: "255;255;255",
    upstreamPrompt: "245;245;245",
    upstreamText: "138;138;138",
  },
] as const) {
  const logo = `\x1b[15;32H\x1b[38;2;${frame.ink}m\x1b[48;2;${frame.upstreamBackground}m██  ██`
  const kiloLogo = `\x1b[15;32H\x1b[38;2;${frame.ink}m\x1b[48;2;${frame.terminal}m██  ██`
  const prompt = `\x1b[0m\x1b[19;27H\x1b[38;2;${frame.kiloText}m\x1b[48;2;${frame.kiloPrompt}mAsk anything… "Fix broken tests"`
  const upstream = `${logo}\x1b[0m\x1b[19;27H\x1b[38;2;${frame.upstreamText}m\x1b[48;2;${frame.upstreamPrompt}mAsk anything… "Fix broken tests"`
  const footer = "\x1b[0m\x1b[24;75Hctrl+p commands"

  test(`recognizes the Kilo ${frame.mode} prompt at home and after cancel`, () => {
    expect(hasKiloPrompt(`${kiloLogo}${prompt}`, frame.mode)).toBe(true)
    expect(isKiloHome(`${kiloLogo}${prompt}`, frame.mode)).toBe(false)
    expect(isKiloHome(`${kiloLogo}${prompt}${footer}`, frame.mode)).toBe(true)
    expect(hasKiloPrompt(`${upstream}${prompt}`, frame.mode)).toBe(true)
    expect(hasKiloPrompt(prompt, frame.mode === "dark" ? "light" : "dark")).toBe(false)
  })

  test(`rejects the upstream ${frame.mode} home and cancel frame with Kilo logo ink`, () => {
    expect(hasKiloPrompt(upstream, frame.mode)).toBe(false)
    expect(isKiloHome(`${upstream}${footer}`, frame.mode)).toBe(false)
    const withTerminalBackground = `\x1b[48;2;${frame.terminal}m ${upstream}`
    expect(hasKiloPrompt(withTerminalBackground, frame.mode)).toBe(false)
    expect(isKiloHome(`${withTerminalBackground}${footer}`, frame.mode)).toBe(false)
  })

  test(`requires the ${frame.mode} Kilo background on the prompt itself`, () => {
    expect(hasKiloPrompt(logo, frame.mode)).toBe(false)
    expect(hasKiloPrompt(`\x1b[38;2;${frame.kiloPrompt}mAsk anything`, frame.mode)).toBe(false)
    expect(hasKiloPrompt(`48;2;${frame.kiloPrompt}mAsk anything`, frame.mode)).toBe(false)
    expect(
      hasKiloPrompt(
        `\x1b[48;2;${frame.kiloPrompt}mOther text\x1b[48;2;${frame.upstreamPrompt}mAsk anything`,
        frame.mode,
      ),
    ).toBe(false)
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
    let stopped = false
    try {
      await Promise.race([
        ready.promise,
        Bun.sleep(5_000).then(() => {
          throw new Error("Timed out waiting for the process tree")
        }),
      ])
      await stopProcessGroup(child)
      const text = await Promise.race([
        output,
        Bun.sleep(5_000).then(() => {
          throw new Error("The descendant still holds the output pipe open")
        }),
      ])
      stopped = true
      expect(child.signalCode).toBe("SIGKILL")
      expect(text).toContain("wrapper ready")
      expect(text).toContain("descendant ready")
    } finally {
      if (!stopped) {
        try {
          process.kill(-child.pid, "SIGKILL")
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
        }
        child.kill("SIGKILL")
        await child.exited
        await output
      }
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
