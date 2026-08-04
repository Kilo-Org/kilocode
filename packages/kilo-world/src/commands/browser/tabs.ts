import { Runner } from "../../core/browser/runner"
import { Refs } from "../../core/browser/refs"
import type { TabInfo } from "../../types"

export namespace Tabs {
  export async function list(session?: string): Promise<TabInfo[]> {
    const name = session ?? "default"
    const live = await Runner.attach(name)
    const pages = live.context.pages()
    const out: TabInfo[] = []
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]
      const url = page.url()
      let title: string | undefined
      try {
        title = await page.title()
      } catch {
        title = undefined
      }
      out.push({ index, url, ...(title ? { title } : {}), active: page === live.active })
    }
    return out
  }

  export async function open(input: { session?: string; url?: string }): Promise<{ index: number; url: string }> {
    const name = input.session ?? "default"
    const url = input.url ?? "about:blank"
    const live = await Runner.attach(name)
    const page = await live.context.newPage()
    live.active = page
    Refs.reset(name)
    await page.goto(url, { waitUntil: "load" })
    Runner.touch(name, page.url())
    return { index: live.context.pages().indexOf(page), url: page.url() }
  }

  export async function select(input: { session?: string; index: number }): Promise<{ index: number; url: string }> {
    const name = input.session ?? "default"
    const live = await Runner.attach(name)
    const pages = live.context.pages()
    if (input.index < 0 || input.index >= pages.length) {
      throw new Error(`tab index out of range: ${input.index}`)
    }
    const page = pages[input.index]
    live.active = page
    Refs.reset(name)
    Runner.touch(name, page.url())
    return { index: input.index, url: page.url() }
  }

  export async function close(input: {
    session?: string
    index?: number
  }): Promise<{ closed: number; remaining: number }> {
    const name = input.session ?? "default"
    const live = await Runner.attach(name)
    const pages = live.context.pages()
    const target = input.index ?? pages.indexOf(Runner.activePage(live))
    if (target < 0 || target >= pages.length) throw new Error(`tab index out of range: ${target}`)
    const page = pages[target]
    await page.close()
    const remaining = live.context.pages()
    if (page === live.active)
      live.active = remaining[Math.min(target, remaining.length - 1)] ?? (await live.context.newPage())
    Refs.reset(name)
    Runner.touch(name, live.active.url())
    return { closed: target, remaining: live.context.pages().length }
  }
}
