import type { ILLM, TabAutocompleteOptions } from "../index.js"
import { MinimalConfigProvider } from "../autocomplete/MinimalConfig.js"

/**
 * Minimal config structure for testing.
 * Matches the shape of config returned by MinimalConfigProvider.loadConfig()
 */
interface MinimalTestConfig {
	modelsByRole?: {
		autocomplete?: ILLM[]
	}
	selectedModelByRole?: {
		autocomplete?: ILLM
		edit?: ILLM
		chat?: ILLM
		rerank?: ILLM
	}
	rules?: unknown[]
}

/**
 * Options for customizing FakeConfigHandler behavior.
 * All options are optional and will use sensible defaults if not provided.
 */
interface FakeConfigHandlerOptions {
	/** Configuration to return from loadConfig() */
	config?: Partial<MinimalTestConfig>

	/** Autocomplete model to use (shorthand for setting selectedModelByRole.autocomplete) */
	autocompleteModel?: ILLM

	/** Whether static contextualization is enabled */
	enableStaticContextualization?: boolean

	/** Tab autocomplete options */
	tabAutocompleteOptions?: TabAutocompleteOptions

	/** Profile type for logging */
	profileType?: "control-plane" | "local" | "platform"
}

export class FakeConfigHandler extends MinimalConfigProvider {
	/** Track calls to onConfigUpdate for assertions */
	public configUpdateCallbacks: Array<
		(event: { config: MinimalTestConfig; configLoadInterrupted: boolean }) => void
	> = []

	constructor(options: FakeConfigHandlerOptions = {}) {
		// Build config from options
		const autocompleteModel = options.autocompleteModel

		const config = {
			tabAutocompleteOptions: options.tabAutocompleteOptions,
			experimental: {
				enableStaticContextualization: options.enableStaticContextualization ?? false,
			},
			modelsByRole: {
				autocomplete: autocompleteModel ? [autocompleteModel] : [],
			},
			selectedModelByRole: {
				autocomplete: autocompleteModel,
			},
			...options.config,
		}

		// Call parent constructor with merged config
		super(config)

		// Set profile if provided
		if (options.profileType) {
			this.currentProfile = {
				profileDescription: {
					profileType: options.profileType,
				},
			}
		}
	}

	/**
	 * Register config update handler
	 * Overrides parent to track callbacks for test assertions
	 */
	override onConfigUpdate(
		handler: (event: { config: MinimalTestConfig; configLoadInterrupted: boolean }) => void,
	): void {
		this.configUpdateCallbacks.push(handler)
	}
}
