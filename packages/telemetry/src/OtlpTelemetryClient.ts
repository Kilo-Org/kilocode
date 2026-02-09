import { trace, context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api"
import { BasicTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto"
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto"
import { Resource } from "@opentelemetry/resources"
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions"

import { type TelemetryEvent, TelemetryEventName, type OtlpExportSettings } from "@roo-code/types"

import { BaseTelemetryClient } from "./BaseTelemetryClient"

/**
 * OtlpTelemetryClient exports telemetry as OpenTelemetry traces and logs
 * to any OTLP-compatible backend (Datadog, Honeycomb, Grafana Cloud, Jaeger, etc.).
 *
 * Runs alongside PostHog — does not replace it.
 *
 * - Task lifecycle events → trace spans
 * - All events → OTLP log records
 */
export class OtlpTelemetryClient extends BaseTelemetryClient {
	private tracerProvider: BasicTracerProvider | null = null
	private loggerProvider: LoggerProvider | null = null
	private tracer: Tracer | null = null
	private activeSpans: Map<string, Span> = new Map()
	private settings: OtlpExportSettings | null = null

	constructor(private readonly extensionVersion: string) {
		super()
	}

	/**
	 * Configure or reconfigure the OTLP exporters from settings.
	 * Shuts down old providers before creating new ones.
	 */
	public async configure(settings: OtlpExportSettings): Promise<void> {
		// Shut down existing providers first
		await this.shutdownProviders()

		this.settings = settings

		if (!settings.enabled) {
			this.telemetryEnabled = false
			return
		}

		const resource = new Resource({
			[ATTR_SERVICE_NAME]: settings.serviceName || "kilocode-extension",
			[ATTR_SERVICE_VERSION]: this.extensionVersion,
		})

		const headers = this.buildHeaders(settings.headers)

		// Set up trace exporter if endpoint is configured
		if (settings.tracesEndpoint) {
			const traceExporter = new OTLPTraceExporter({
				url: settings.tracesEndpoint,
				headers,
			})

			this.tracerProvider = new BasicTracerProvider({ resource })
			this.tracerProvider.addSpanProcessor(new BatchSpanProcessor(traceExporter))
			this.tracerProvider.register()
			this.tracer = trace.getTracer("kilocode-extension", this.extensionVersion)
		}

		// Set up log exporter if endpoint is configured
		if (settings.logsEndpoint) {
			const logExporter = new OTLPLogExporter({
				url: settings.logsEndpoint,
				headers,
			})

			this.loggerProvider = new LoggerProvider({ resource })
			this.loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter))
		}

		this.telemetryEnabled = true
	}

	public override async capture(event: TelemetryEvent): Promise<void> {
		if (!this.isTelemetryEnabled() || !this.settings?.enabled) {
			return
		}

		const properties = await this.getEventProperties(event)
		const taskId = properties?.taskId as string | undefined

		// Route task lifecycle events to spans
		switch (event.event) {
			case TelemetryEventName.TASK_CREATED:
				if (taskId) {
					this.startSpan("task_lifecycle", taskId, properties)
				}
				break
			case TelemetryEventName.TASK_COMPLETED:
				if (taskId) {
					this.endSpan(taskId, properties)
				}
				break
			case TelemetryEventName.TASK_RESTARTED:
				if (taskId) {
					// End old span, start new one
					this.endSpan(taskId, properties)
					this.startSpan("task_lifecycle", taskId, properties)
				}
				break
			default:
				// Add as event to active span if there's a taskId
				if (taskId) {
					const span = this.activeSpans.get(taskId)
					if (span) {
						span.addEvent(event.event, this.sanitizeAttributes(properties))
					}
				}
				break
		}

		// Emit all events as OTLP log records
		this.emitLogRecord(event.event, properties)
	}

	public override updateTelemetryState(didUserOptIn: boolean): void {
		// Respect global opt-out, but otherwise controlled by settings.enabled
		if (!didUserOptIn) {
			this.telemetryEnabled = false
		} else if (this.settings?.enabled) {
			this.telemetryEnabled = true
		}
	}

	public override async shutdown(): Promise<void> {
		// End all active spans
		for (const [taskId] of this.activeSpans) {
			this.endSpan(taskId)
		}

		await this.shutdownProviders()
	}

	private async shutdownProviders(): Promise<void> {
		if (this.tracerProvider) {
			try {
				await this.tracerProvider.shutdown()
			} catch {
				// Ignore shutdown errors
			}
			this.tracerProvider = null
			this.tracer = null
		}

		if (this.loggerProvider) {
			try {
				await this.loggerProvider.shutdown()
			} catch {
				// Ignore shutdown errors
			}
			this.loggerProvider = null
		}
	}

	private startSpan(name: string, taskId: string, properties?: Record<string, unknown>): void {
		if (!this.tracer) {
			return
		}

		const span = this.tracer.startSpan(name, {
			attributes: this.sanitizeAttributes({ taskId, ...properties }),
		})

		this.activeSpans.set(taskId, span)
	}

	private endSpan(taskId: string, properties?: Record<string, unknown>): void {
		const span = this.activeSpans.get(taskId)
		if (!span) {
			return
		}

		if (properties) {
			span.addEvent("completed", this.sanitizeAttributes(properties))
		}

		span.setStatus({ code: SpanStatusCode.OK })
		span.end()
		this.activeSpans.delete(taskId)
	}

	private emitLogRecord(eventName: string, properties?: Record<string, unknown>): void {
		if (!this.loggerProvider) {
			return
		}

		const logger = this.loggerProvider.getLogger("kilocode-extension", this.extensionVersion)
		logger.emit({
			body: eventName,
			attributes: this.sanitizeAttributes(properties),
		})
	}

	/**
	 * Convert [{key, value}] array to Record<string, string> for OTLP headers.
	 */
	private buildHeaders(headers?: Array<{ key: string; value: string }>): Record<string, string> {
		if (!headers || headers.length === 0) {
			return {}
		}

		return Object.fromEntries(headers.map((h) => [h.key, h.value]))
	}

	/**
	 * Sanitize properties to valid OpenTelemetry attribute values.
	 * OTLP attributes only support string, number, boolean, and arrays of those.
	 */
	private sanitizeAttributes(properties?: Record<string, unknown>): Record<string, string | number | boolean> {
		if (!properties) {
			return {}
		}

		const result: Record<string, string | number | boolean> = {}
		for (const [key, value] of Object.entries(properties)) {
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				result[key] = value
			} else if (value != null) {
				result[key] = String(value)
			}
		}
		return result
	}
}
