import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"

export namespace Hover {
  export type Input = {
    session?: string
    ref?: string
    selector?: string
  }

  export async function run(input: Input): Promise<{ ref?: string; selector?: string }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    await Refs.use(page, session, input.ref, input.selector, (target) => target.hover())
    return {
      ...(input.ref ? { ref: input.ref } : {}),
      ...(input.selector ? { selector: input.selector } : {}),
    }
  }
}
