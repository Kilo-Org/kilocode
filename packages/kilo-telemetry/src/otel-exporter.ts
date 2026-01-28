import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base"
import type { ExportResult } from "@opentelemetry/core"
import { ExportResultCode } from "@opentelemetry/core"
import type { PostHog } from "posthog-node"
import { Identity } from "./identity.js"

/**
 * Sensitive attributes that should never be sent to PostHog.
 * This is a defense-in-depth measure - the AI SDK should already filter these
 * when recordInputs/recordOutputs are set to false.
 */
const SENSITIVE_ATTRIBUTES = new Set([
  // AI SDK prompt/message content
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response.text",
  "ai.response.toolCalls",
  "ai.toolCall.args",
  "ai.toolCall.result",
  "ai.value",
  "ai.values",
  "ai.embedding",
  "ai.embeddings",
  "ai.prompt.tools",
  // OpenTelemetry GenAI semantic conventions
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.definitions",
])

/**
 * PostHogSpanExporter converts OpenTelemetry spans to PostHog AI events.
 * Maps OTel spans to PostHog's $ai_span, $ai_generation, and $ai_trace events.
 */
export class PostHogSpanExporter implements SpanExporter {
  private client: PostHog
  private enabled = true
  private appName = "kilo-cli"
  private appVersion = "unknown"

  constructor(client: PostHog, options?: { appVersion?: string }) {
    this.client = client
    if (options?.appVersion) {
      this.appVersion = options.appVersion
    }
  }

  setEnabled(value: boolean) {
    this.enabled = value
    if (value) this.client.optIn()
    else this.client.optOut()
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (!this.enabled) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }

    for (const span of spans) {
      this.exportSpan(span)
    }

    resultCallback({ code: ExportResultCode.SUCCESS })
  }

  private exportSpan(span: ReadableSpan) {
    const distinctId = Identity.getDistinctId()
    const orgId = Identity.getOrganizationId()

    const name = span.name
    const attrs = span.attributes
    const duration = span.endTime[0] - span.startTime[0] + (span.endTime[1] - span.startTime[1]) / 1e9

    // Determine event type based on span name/attributes
    const eventType = this.determineEventType(name, attrs)

    // Build PostHog AI event properties
    const properties: Record<string, unknown> = {
      appName: this.appName,
      appVersion: this.appVersion,
      platform: process.platform,
      $ai_trace_id: span.spanContext().traceId,
      $ai_span_id: span.spanContext().spanId,
      $ai_span_name: name,
      $ai_latency: duration,
      ...(orgId && { kilocodeOrganizationId: orgId }),
    }

    // Add parent ID if present
    if (span.parentSpanId) {
      properties.$ai_parent_id = span.parentSpanId
    }

    // Map span attributes to PostHog properties
    this.mapAttributes(attrs, properties)

    // Handle errors
    if (span.status.code === 2) {
      // SpanStatusCode.ERROR
      properties.$ai_is_error = true
      properties.$ai_error = span.status.message || "Unknown error"
    }

    // Capture the event
    this.client.capture({
      distinctId,
      event: eventType,
      properties,
    })
  }

  private determineEventType(name: string, attrs: Record<string, unknown>): string {
    // AI SDK spans typically have these patterns:
    // - "ai.generateText" / "ai.streamText" -> $ai_generation
    // - "ai.toolCall" -> $ai_span (tool call)
    // - "ai.embed" -> $ai_span (embedding)

    const lowerName = name.toLowerCase()

    if (
      lowerName.includes("generatetext") ||
      lowerName.includes("streamtext") ||
      lowerName.includes("generateobject") ||
      lowerName.includes("streamobject")
    ) {
      return "$ai_generation"
    }

    if (lowerName.includes("toolcall") || lowerName.includes("tool")) {
      return "$ai_span"
    }

    if (lowerName.includes("embed")) {
      return "$ai_span"
    }

    // Check for gen_ai semantic conventions
    if (attrs["gen_ai.operation.name"]) {
      const op = String(attrs["gen_ai.operation.name"])
      if (op === "chat" || op === "text_completion") {
        return "$ai_generation"
      }
    }

    // Default to span for other AI operations
    return "$ai_span"
  }

  private mapAttributes(attrs: Record<string, unknown>, props: Record<string, unknown>) {
    // Map OpenTelemetry semantic conventions to PostHog AI properties

    // Model info
    if (attrs["gen_ai.request.model"]) {
      props.$ai_model = attrs["gen_ai.request.model"]
    }
    if (attrs["gen_ai.system"]) {
      props.$ai_provider = attrs["gen_ai.system"]
    }

    // Token usage
    if (attrs["gen_ai.usage.input_tokens"]) {
      props.$ai_input_tokens = attrs["gen_ai.usage.input_tokens"]
    }
    if (attrs["gen_ai.usage.output_tokens"]) {
      props.$ai_output_tokens = attrs["gen_ai.usage.output_tokens"]
    }
    if (attrs["gen_ai.usage.total_tokens"]) {
      props.$ai_total_tokens = attrs["gen_ai.usage.total_tokens"]
    }

    // Track presence of prompt/completion without content (for analytics)
    if (attrs["gen_ai.prompt"] || attrs["ai.prompt"]) {
      props.$ai_has_prompt = true
    }
    if (attrs["gen_ai.completion"] || attrs["ai.response.text"]) {
      props.$ai_has_completion = true
    }

    // Tool calls - only track name, not args/result
    if (attrs["ai.toolCall.name"]) {
      props.$ai_tool_name = attrs["ai.toolCall.name"]
    }

    // Temperature and other settings
    if (attrs["gen_ai.request.temperature"]) {
      props.$ai_temperature = attrs["gen_ai.request.temperature"]
    }
    if (attrs["gen_ai.request.max_tokens"]) {
      props.$ai_max_tokens = attrs["gen_ai.request.max_tokens"]
    }

    // Finish reason
    if (attrs["gen_ai.response.finish_reasons"]) {
      props.$ai_finish_reason = attrs["gen_ai.response.finish_reasons"]
    }

    // Copy safe ai.* prefixed attributes (filter out sensitive ones)
    for (const [key, value] of Object.entries(attrs)) {
      if (!key.startsWith("ai.")) continue
      if (SENSITIVE_ATTRIBUTES.has(key)) continue
      // Additional pattern-based filtering for safety
      if (key.includes("prompt") || key.includes("messages") || key.includes("response.text")) continue
      const propKey = key.replace(/\./g, "_")
      props[propKey] = value
    }
  }

  async shutdown(): Promise<void> {
    // Only flush, don't shutdown - the shared client is managed by Client namespace
    await this.client.flush()
  }

  async forceFlush(): Promise<void> {
    await this.client.flush()
  }
}
