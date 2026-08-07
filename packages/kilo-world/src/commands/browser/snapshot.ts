import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"

export namespace Snapshot {
  export async function run(session?: string): Promise<{ snapshot: string; refs: import("../../types").RefEntry[] }> {
    const name = session ?? "default"
    const live = await Runner.attach(name)
    const page = Runner.activePage(live)
    return Refs.capture(name, page)
  }
}
