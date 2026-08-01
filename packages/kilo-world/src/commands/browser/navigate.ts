import { Runner } from "../../core/browser/runner"
import { Launch } from "../../core/browser/launch"
import { Refs } from "../../core/browser/refs"

export namespace Navigate {
  export type Input = {
    session?: string
    url: string
    wait?: string
    timeoutMs?: number
  }

  export async function run(input: Input): Promise<{ url: string; finalUrl: string; status: number | null }> {
    const session = input.session ?? "default"
    const live = await Runner.attach(session, input.timeoutMs)
    const page = Runner.activePage(live)
    const timeout = input.timeoutMs ?? Launch.TIMEOUT_MS_DEFAULT
    Refs.reset(session)
    const response = await page.goto(input.url, { waitUntil: "load", timeout })
    if (input.wait) {
      await page.waitForSelector(input.wait, { timeout })
    }
    const url = page.url()
    Runner.touch(session, url)
    return { url: input.url, finalUrl: url, status: response?.status() ?? null }
  }
}
