import {
	TelemetryEvent,
	TelemetryEventName,
	TelemetryClient,
	TelemetryPropertiesProvider,
	TelemetryEventSubscription,
} from "@roo-code/types"

export abstract class BaseTelemetryClient implements TelemetryClient {
	protected providerRef: WeakRef<TelemetryPropertiesProvider> | null = null
	protected telemetryEnabled: boolean = false

	constructor(
		public readonly subscription?: TelemetryEventSubscription,
		protected readonly debug = false,
	) {}

	protected isEventCapturable(eventName: TelemetryEventName): boolean {
		if (!this.subscription) {
			return true
		}

		return this.subscription.type === "include"
			? this.subscription.events.includes(eventName)
			: !this.subscription.events.includes(eventName)
	}

	/**
	 * Determines if a specific property should be included in telemetry events
	 * Override in subclasses to filter specific properties
	 * @param _propertyName The name of the property to check
	 * @param _allProperties All properties for context (e.g., to check organization membership) // kilocode_change
	 */
	protected isPropertyCapturable(
		_propertyName: string,
		_allProperties: Record<string, unknown>, // kilocode_change
	): boolean {
		return true
	}

	protected async getEventProperties(event: TelemetryEvent): Promise<TelemetryEvent["properties"]> {
		let providerProperties: TelemetryEvent["properties"] = {}
		const provider = this.providerRef?.deref()

		if (provider) {
			try {
				// Get properties from the provider
				providerProperties = await provider.getTelemetryProperties()
			} catch (error) {
				// Log error but continue with capturing the event.
				console.error(
					`Error getting telemetry properties: ${error instanceof Error ? error.message : String(error)}`,
				)
				providerProperties.exception = error instanceof Error ? error.stack || error.message : String(error) // kilocode_change
			}
		}

		// Merge provider properties with event-specific properties.
		// Event properties take precedence in case of conflicts.
		const mergedProperties = { ...providerProperties, ...(event.properties || {}) }

		// kilocode_change start
		// Add organization ID if available from provider properties
		// This ensures all events include the organization ID when present
		if (providerProperties.kilocodeOrganizationId && !mergedProperties.kilocodeOrganizationId) {
			mergedProperties.kilocodeOrganizationId = providerProperties.kilocodeOrganizationId
		}
		// kilocode_change end

		// Filter out properties that shouldn't be captured by this client
		return Object.fromEntries(
			Object.entries(mergedProperties).filter(([key]) => this.isPropertyCapturable(key, mergedProperties)), // kilocode_change: pass mergedProperties for org filtering
		)
	}

	public abstract capture(event: TelemetryEvent): Promise<void>

	public setProvider(provider: TelemetryPropertiesProvider): void {
		this.providerRef = new WeakRef(provider)
	}

	public abstract updateTelemetryState(didUserOptIn: boolean): void

	// kilocode_change start
	public async captureException(_error: Error, _properties?: Record<string | number, unknown>): Promise<void> {}

	public updateIdentity(_kilocodeToken: string): Promise<void> {
		return Promise.resolve()
	}
	// kilocode_change end

	public isTelemetryEnabled(): boolean {
		return this.telemetryEnabled
	}

	public abstract shutdown(): Promise<void>
}
