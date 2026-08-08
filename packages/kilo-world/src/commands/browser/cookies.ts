import type { BrowserContext, Cookie } from "playwright"
import { Runner } from "../../core/browser/runner"
import type { CookieEntry } from "../../types"

type AddCookieInput = Parameters<BrowserContext["addCookies"]>[0][number]

export namespace Cookies {
  function matchesDomain(cookie: Cookie, domain: string): boolean {
    return cookie.domain === domain || cookie.domain.endsWith(`.${domain}`)
  }

  function fromPlaywright(c: Cookie): CookieEntry {
    const out: CookieEntry = { name: c.name, value: c.value, domain: c.domain, path: c.path }
    if (typeof c.expires === "number") out.expires = c.expires
    if (typeof c.httpOnly === "boolean") out.httpOnly = c.httpOnly
    if (typeof c.secure === "boolean") out.secure = c.secure
    if (c.sameSite === "Strict" || c.sameSite === "Lax" || c.sameSite === "None") {
      out.sameSite = c.sameSite
    }
    return out
  }

  export async function get(input: {
    session?: string
    domain: string
  }): Promise<{ cookies: CookieEntry[]; count: number }> {
    const name = input.session ?? "default"
    const live = await Runner.attach(name)
    const all = await live.context.cookies()
    const filtered = all.filter((cookie: Cookie) => matchesDomain(cookie, input.domain))
    const entries = filtered.map(fromPlaywright)
    return { cookies: entries, count: entries.length }
  }

  export async function set(input: {
    session?: string
    name: string
    value: string
    domain: string
    path?: string
  }): Promise<{ cookie: CookieEntry }> {
    const name = input.session ?? "default"
    const live = await Runner.attach(name)
    const cookie: AddCookieInput = {
      name: input.name,
      value: input.value,
      domain: input.domain,
      path: input.path ?? "/",
    }
    await live.context.addCookies([cookie])
    const path = input.path ?? "/"
    const cookies = await live.context.cookies()
    const stored =
      cookies.find((item) => item.name === input.name && item.domain === input.domain && item.path === path) ??
      cookies.find((item) => item.name === input.name && matchesDomain(item, input.domain))
    if (!stored) throw new Error(`cookie ${input.name} was not stored for ${input.domain}`)
    return { cookie: fromPlaywright(stored) }
  }

  export async function clear(input: { session?: string; domain?: string }): Promise<{ cleared: number }> {
    const name = input.session ?? "default"
    const live = await Runner.attach(name)
    const before = (await live.context.cookies()).length
    if (input.domain) {
      const matched = (await live.context.cookies()).filter((cookie) => matchesDomain(cookie, input.domain!))
      for (const cookie of matched) {
        await live.context.clearCookies({
          name: cookie.name,
          domain: cookie.domain,
          path: cookie.path,
        })
      }
    } else {
      await live.context.clearCookies()
    }
    const after = (await live.context.cookies()).length
    return { cleared: before - after }
  }
}
