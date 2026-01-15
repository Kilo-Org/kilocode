/**
 * Tests for teams command autocomplete functionality
 */

import { describe, it, expect, beforeEach } from "vitest"
import type { ArgumentProviderCommandContext } from "../core/types.js"
import { teamsCommand } from "../teams.js"

describe("Teams Command Autocomplete", () => {
	let mockCommandContext: Partial<ArgumentProviderCommandContext>

	beforeEach(() => {
		mockCommandContext = {
			config: {} as ArgumentProviderCommandContext["config"],
			routerModels: null,
			currentProvider: {
				id: "test-provider",
				provider: "kilocode",
				kilocodeToken: "test-token",
			},
			kilocodeDefaultModel: "",
			profileData: {
				user: {},
				organizations: [
					{
						id: "org-1",
						name: "Kilo Code",
						role: "admin",
					},
					{
						id: "org-2",
						name: "My Awesome Team!",
						role: "member",
					},
				],
			},
			profileLoading: false,
			taskHistoryData: null,
			chatMessages: [],
			customModes: [],
			updateProviderModel: async () => {},
			refreshRouterModels: async () => {},
		}
	})

	describe("command metadata", () => {
		it("should have arguments defined with conditionalProviders for team-name", () => {
			expect(teamsCommand.arguments).toBeDefined()
			expect(teamsCommand.arguments?.length).toBe(2)
			expect(teamsCommand.arguments?.[0].name).toBe("subcommand")
			expect(teamsCommand.arguments?.[1].name).toBe("team-name")
			expect(teamsCommand.arguments?.[1].conditionalProviders).toBeDefined()
			expect(teamsCommand.arguments?.[1].conditionalProviders?.length).toBe(1)
		})

		it("should have condition that checks for select subcommand", () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			expect(conditionalProvider?.condition).toBeDefined()

			// Test condition returns true for "select"
			const selectContext = {
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
			}
			expect(conditionalProvider?.condition(selectContext as never)).toBe(true)

			// Test condition returns false for "list"
			const listContext = {
				getArgument: (name: string) => (name === "subcommand" ? "list" : undefined),
			}
			expect(conditionalProvider?.condition(listContext as never)).toBe(false)

			// Test condition returns false for undefined
			const noSubcommandContext = {
				getArgument: () => undefined,
			}
			expect(conditionalProvider?.condition(noSubcommandContext as never)).toBe(false)
		})
	})

	describe("teamAutocompleteProvider", () => {
		it("should return team suggestions including personal and organizations", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			expect(conditionalProvider?.provider).toBeDefined()

			const provider = conditionalProvider!.provider

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: mockCommandContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(Array.isArray(suggestions)).toBe(true)
			expect(suggestions.length).toBe(3) // personal + 2 organizations

			// Should include personal option
			const personalSuggestion = suggestions.find((s) => s.value === "personal")
			expect(personalSuggestion).toBeDefined()
			expect(personalSuggestion?.title).toBe("Personal")
			expect(personalSuggestion?.description).toBe("Your personal account")

			// Should include organizations with normalized names
			const kiloCodeSuggestion = suggestions.find((s) => s.value === "kilo-code")
			expect(kiloCodeSuggestion).toBeDefined()
			expect(kiloCodeSuggestion?.title).toBe("Kilo Code")
			expect(kiloCodeSuggestion?.description).toBe("Kilo Code (admin)")

			const awesomeTeamSuggestion = suggestions.find((s) => s.value === "my-awesome-team")
			expect(awesomeTeamSuggestion).toBeDefined()
			expect(awesomeTeamSuggestion?.title).toBe("My Awesome Team!")
			expect(awesomeTeamSuggestion?.description).toBe("My Awesome Team! (member)")
		})

		it("should return loading state when profile is loading", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const loadingContext = {
				...mockCommandContext,
				profileLoading: true,
			}

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: loadingContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(1)
			expect(suggestions[0].value).toBe("loading")
			expect(suggestions[0].title).toBe("Loading teams...")
			expect(suggestions[0].loading).toBe(true)
		})

		it("should return empty array when not using Kilocode provider", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const nonKilocodeContext = {
				...mockCommandContext,
				currentProvider: {
					id: "test-provider",
					provider: "anthropic",
				},
			}

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: nonKilocodeContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(0)
		})

		it("should return empty array when not authenticated", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const unauthenticatedContext = {
				...mockCommandContext,
				currentProvider: {
					id: "test-provider",
					provider: "kilocode",
					// No kilocodeToken
				},
			}

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: unauthenticatedContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(0)
		})

		it("should return empty array when commandContext is undefined", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				// No commandContext
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(0)
		})

		it("should return only personal when no organizations exist", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const noOrgsContext = {
				...mockCommandContext,
				profileData: {
					user: {},
					organizations: [],
				},
			}

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: noOrgsContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(1)
			expect(suggestions[0].value).toBe("personal")
		})

		it("should return only personal when profileData is null", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const nullProfileContext = {
				...mockCommandContext,
				profileData: null,
			}

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: nullProfileContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			expect(suggestions).toBeDefined()
			expect(suggestions.length).toBe(1)
			expect(suggestions[0].value).toBe("personal")
		})

		it("should include matchScore and highlightedValue in suggestions", async () => {
			const conditionalProvider = teamsCommand.arguments?.[1].conditionalProviders?.[0]
			const provider = conditionalProvider!.provider

			const context = {
				commandName: "teams",
				argumentIndex: 1,
				argumentName: "team-name",
				currentArgs: ["select"],
				currentOptions: {},
				partialInput: "",
				getArgument: (name: string) => (name === "subcommand" ? "select" : undefined),
				parsedValues: { args: { subcommand: "select" }, options: {} },
				command: teamsCommand,
				commandContext: mockCommandContext as ArgumentProviderCommandContext,
			}

			const suggestions = await provider(context)

			for (const suggestion of suggestions) {
				expect(suggestion.matchScore).toBe(1.0)
				expect(suggestion.highlightedValue).toBe(suggestion.value)
			}
		})
	})
})
