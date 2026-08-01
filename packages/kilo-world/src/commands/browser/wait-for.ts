import { Runner } from "../../core/browser/runner"
import { Launch } from "../../core/browser/launch"

export namespace WaitFor {
  export type Input = {
    session?: string
    selector?: string
    text?: string
    url?: string
    timeoutMs?: number
  }

  export async function run(input: Input): Promise<{ matched: boolean }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session)
    const page = Runner.activePage(live)
    const timeout = input.timeoutMs ?? Launch.TIMEOUT_MS_DEFAULT
    if (input.selector) {
      await page.waitForSelector(input.selector, { timeout })
      return { matched: true }
    }
    if (input.text) {
      await page.getByText(input.text).first().waitFor({ timeout })
      return { matched: true }
    }
    if (input.url) {
      await page.waitForURL(input.url, { timeout })
      return { matched: true }
    }
    throw new Error("must provide one of --selector, --text, or --url")
  }
}
