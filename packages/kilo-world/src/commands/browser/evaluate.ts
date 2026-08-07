import { Runner } from "../../core/browser/runner"

export namespace Evaluate {
  export type Input = {
    session?: string
    js: string
  }

  function safeStringify(value: unknown): unknown {
    if (value === undefined) return null
    if (typeof value === "bigint") return value.toString()
    try {
      return JSON.parse(JSON.stringify(value))
    } catch {
      if (typeof value === "string") return value
      return "[unserializable value]"
    }
  }

  export async function run(input: Input): Promise<{ result: unknown }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    const result = await page.evaluate(input.js)
    return { result: safeStringify(result) }
  }
}
