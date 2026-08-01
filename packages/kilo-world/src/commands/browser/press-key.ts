import { Runner } from "../../core/browser/runner"

export namespace PressKey {
  export type Input = {
    session?: string
    chord: string
  }

  export async function run(input: Input): Promise<{ chord: string; keys: number }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    const plus = input.chord.endsWith("+")
    const base = plus ? input.chord.slice(0, -1) : input.chord
    const keys = base
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean)
    if (plus) keys.push("+")
    if (keys.length === 0) throw new Error("chord cannot be empty")
    await page.keyboard.press(keys.map((key) => (key === "+" ? "Shift+Equal" : key)).join("+"))
    return { chord: input.chord, keys: keys.length }
  }
}
