declare module "eventsource" {
  interface EventSourceInit {
    headers?: Record<string, string>
    https?: Record<string, unknown>
    proxy?: string
    rejectUnauthorized?: boolean
    withCredentials?: boolean
  }

  interface MessageEvent {
    data: string
    lastEventId: string
    origin: string
  }

  class EventSource {
    static readonly CONNECTING: 0
    static readonly OPEN: 1
    static readonly CLOSED: 2

    readonly readyState: 0 | 1 | 2
    readonly url: string

    constructor(url: string, eventSourceInitDict?: EventSourceInit)

    onopen: ((event: Event) => void) | null
    onmessage: ((event: MessageEvent) => void) | null
    onerror: ((event: Event) => void) | null

    close(): void
    addEventListener(type: string, listener: (event: MessageEvent) => void): void
    removeEventListener(type: string, listener: (event: MessageEvent) => void): void
  }

  export = EventSource
}
