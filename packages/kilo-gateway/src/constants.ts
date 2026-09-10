/** Original Kilo presence relay configuration; importing this module performs no I/O. */
export const KILO_EVENT_SERVICE_URL_ENV = "EVENT_SERVICE_URL"
export const KILO_DEFAULT_EVENT_SERVICE_URL = "wss://events.kiloapps.io"
export const KILO_EVENT_SERVICE_URL = process.env[KILO_EVENT_SERVICE_URL_ENV] || KILO_DEFAULT_EVENT_SERVICE_URL
