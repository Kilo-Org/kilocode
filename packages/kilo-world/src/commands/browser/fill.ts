import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"

export namespace Fill {
  export type Input = {
    session?: string
    value: string
    ref?: string
    selector?: string
    force?: boolean
  }

  export async function run(input: Input): Promise<{ length: number }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    await Refs.use(page, session, input.ref, input.selector, (target) =>
      target.fill(input.value, input.force ? { force: true } : undefined),
    )
    return { length: input.value.length }
  }
}
