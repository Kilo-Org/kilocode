import { createMiddleware } from "@solidjs/start/middleware"
import { Resource } from "@opencode/console-resource"
import { LOCALE_HEADER, cookie, fromPathname, strip } from "~/lib/language"
import { sanitizeServerActionRequest } from "~/lib/server-action"

export default createMiddleware({
  async onRequest(event) {
    event.request = sanitizeServerActionRequest(event.request)

    const url = new URL(event.request.url)
    const locale = fromPathname(url.pathname)
    if (locale) {
      url.pathname = strip(url.pathname)
      const request = new Request(url, event.request)
      request.headers.set(LOCALE_HEADER, locale)
      event.request = request
      event.response.headers.append("set-cookie", cookie(locale))
    }

    // The legacy dashboard and its sign-in moved to the new Console.
    if (/^\/(auth|workspace)(\/|$)/.test(url.pathname) && Resource.ConsoleMigration.consoleUrl)
      return new Response(null, {
        status: 302,
        headers: { Location: `${Resource.ConsoleMigration.consoleUrl}/login`, "Cache-Control": "no-store" },
      })
  },
})
