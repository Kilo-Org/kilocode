import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"

export namespace Type {
  export type Input = {
    session?: string
    text: string
    ref?: string
    selector?: string
    delay?: number
  }

  export async function run(input: Input): Promise<{ typed: number }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    if (input.ref || input.selector) {
      await Refs.use(page, session, input.ref, input.selector, async (target) => {
        await target.fill("")
        await target.type(input.text, input.delay ? { delay: input.delay } : undefined)
      })
    } else {
      await page.keyboard.type(input.text, input.delay ? { delay: input.delay } : undefined)
    }
    return { typed: input.text.length }
  }
}
