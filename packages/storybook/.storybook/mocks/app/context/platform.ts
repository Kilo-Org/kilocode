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
  openLink() {},
  restart: async () => {},
  back() {},
  forward() {},
  notify: async () => {},
  fetch: globalThis.fetch.bind(globalThis),
  parseMarkdown: async (markdown: string) => markdown,
}

export function usePlatform() {
  return value
}
