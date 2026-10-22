// kilocode_change start
type Platform = {
  platform: "web"
  openLink(url: string): void
  restart(): Promise<void>
  back(): void
  forward(): void
  notify(message: string): Promise<void>
  fetch: typeof fetch
  parseMarkdown(markdown: string): Promise<string>
}
// kilocode_change end

const value: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
}

export function usePlatform() {
  return value
}
