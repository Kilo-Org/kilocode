import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"
import type { Tracer } from "@opentelemetry/api"
import { PostHogSpanExporter } from "./otel-exporter.js"
import { Client } from "./client.js"

let provider: NodeTracerProvider | null = null
let exporter: PostHogSpanExporter | null = null
let tracer: Tracer | null = null

export namespace TracerSetup {
  export function init(options: {
    version: string
    enabled: boolean
    appName: string
    platform: string
    editorName?: string
    vscodeVersion?: string
  }): Tracer {
    if (tracer) return tracer

    const client = Client.getClient()
    if (!client) {
      throw new Error("PostHog client not initialized. Call Client.init() first.")
    }

    exporter = new PostHogSpanExporter(client, {
      appName: options.appName,
      appVersion: options.version,
      platform: options.platform,
      editorName: options.editorName,
      vscodeVersion: options.vscodeVersion,
    })
    exporter.setEnabled(options.enabled)

    provider = new NodeTracerProvider({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: options.appName,
        [ATTR_SERVICE_VERSION]: options.version,
      }),
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    // Register the provider globally so all tracers use our exporter
    provider.register()

    // Get tracer from our provider
    tracer = provider.getTracer(options.appName, options.version)

    return tracer
  }

  export function getTracer(): Tracer | null {
    return tracer
  }

  export function setEnabled(value: boolean) {
    exporter?.setEnabled(value)
  }

  export async function shutdown(): Promise<void> {
    if (provider) {
      await provider.shutdown()
      provider = null
      tracer = null
      exporter = null
    }
  }
}
