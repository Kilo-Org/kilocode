import { Runner } from "../../core/browser/runner"

export namespace Close {
  export async function run(session?: string): Promise<{ closed: boolean }> {
    const name = session ?? "default"
    const existed = await Runner.close(name)
    return { closed: existed }
  }
}
