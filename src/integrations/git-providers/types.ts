/**
 * Git Provider Integration Interface
 */
export interface GitProviderIntegration {
	getContext(): string
	isActive(): boolean
	getName(): string
}
