const WRITE = new Set(["write", "edit", "patch", "multiedit", "apply_patch"])

type UsageEvent = {
  ide: "vscode" | "jetbrains" | "android"
  occurred_at: string
  event: string
  metrics: Record<string, number | string>
}

const queue: UsageEvent[] = []
let timer: ReturnType<typeof setTimeout> | null = null

function platform(): string {
  return (process.env.KILO_ENTERPRISE_PLATFORM_URL ?? "").replace(/\/+$/, "")
}

function token(): string {
  return (process.env.KILO_ENTERPRISE_USAGE_TOKEN ?? "").trim()
}

function ide(): UsageEvent["ide"] {
  const raw = (process.env.KILO_PLATFORM ?? "vscode").toLowerCase()
  if (raw === "jetbrains" || raw === "android") return raw
  return "vscode"
}

function enabled() {
  return Boolean(platform() && token())
}

function schedule() {
  if (!timer) {
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, 500)
  }
}

export function postUsage(event: string, metrics: Record<string, number | string>) {
  if (!enabled()) return
  queue.push({
    ide: ide(),
    occurred_at: new Date().toISOString(),
    event,
    metrics,
  })
  schedule()
}

export function forwardPlatformUsage(event: string, props?: Record<string, unknown>) {
  if (!enabled()) return
  const mapped = map(event, props)
  if (!mapped) return
  queue.push(mapped)
  schedule()
}

async function flush() {
  const base = platform()
  const auth = token()
  if (!base || !auth || queue.length === 0) return
  const batch = queue.splice(0, 100)
  try {
    const res = await fetch(`${base}/api/v1/usage/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: batch }),
    })
    if (!res.ok) {
      queue.unshift(...batch)
    }
  } catch {
    queue.unshift(...batch)
  }
  if (queue.length > 0) schedule()
}

function map(event: string, props?: Record<string, unknown>): UsageEvent | null {
  const base: UsageEvent = {
    ide: ide(),
    occurred_at: new Date().toISOString(),
    event: "",
    metrics: {},
  }

  if (event === "LLM Completion") {
    return {
      ...base,
      event: "llm.tokens",
      metrics: {
        input: num(props, "inputTokens") || num(props, "input"),
        output: num(props, "outputTokens") || num(props, "output"),
      },
    }
  }

  if (event === "Tool Used") {
    const tool = String(props?.tool ?? props?.toolName ?? "").toLowerCase()
    if (!WRITE.has(tool)) return null
    return {
      ...base,
      event: "agent.file.edited",
      metrics: { path: String(props?.path ?? props?.file ?? "") },
    }
  }

  return null
}

function num(props: Record<string, unknown> | undefined, key: string): number {
  const v = props?.[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return 0
}
