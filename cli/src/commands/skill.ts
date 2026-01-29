/**
 * /skill command - Install, list, and manage skills from skills.sh ecosystem
 *
 * Skills are reusable capabilities for AI agents that provide procedural knowledge.
 * Learn more at https://skills.sh
 */

import type { Command, CommandContext, ArgumentProviderContext } from "./core/types.js"
import {
	listSkills,
	installFromSource,
	removeSkill,
	getSkillsDir,
	type SkillScope,
	type SkillMeta,
} from "../services/skills/skillService.js"

/**
 * Format skill info for display
 */
function formatSkillInfo(skill: SkillMeta): string {
	const scopeIcon = skill.scope === "global" ? "🌐" : "📁"
	const desc = skill.description ? ` - ${skill.description}` : ""
	return `${scopeIcon} ${skill.name}${desc}`
}

/**
 * Show help for the skill command
 */
function showHelp(context: CommandContext): void {
	const { addMessage } = context

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `**Skill Command** - Manage skills from the skills.sh ecosystem

**Subcommands:**
  \`/skill add <source>\` - Install skills from a GitHub repo
  \`/skill list\` - List installed skills
  \`/skill remove <name>\` - Remove an installed skill

**Options:**
  \`--global\` or \`-g\` - Use global scope (~/.kilocode/skills/)
  \`--force\` or \`-f\` - Overwrite existing skills

**Examples:**
  \`/skill add vercel-labs/agent-skills\`
  \`/skill add vercel-labs/agent-skills --global\`
  \`/skill list\`
  \`/skill remove vercel-react-best-practices\`

**Learn more:** https://skills.sh`,
		ts: Date.now(),
	})
}

/**
 * Handle /skill list
 */
async function handleList(context: CommandContext, args: string[]): Promise<void> {
	const { addMessage, config } = context

	// Parse scope from args
	let scope: SkillScope | "all" = "all"
	if (args.includes("--global") || args.includes("-g")) {
		scope = "global"
	} else if (args.includes("--project") || args.includes("-p")) {
		scope = "project"
	}

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: "Loading installed skills...",
		ts: Date.now(),
	})

	try {
		const skills = await listSkills({ scope, cwd: config.cwd })

		if (skills.length === 0) {
			const scopeText = scope === "all" ? "" : ` in ${scope} scope`
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `No skills installed${scopeText}.\n\nInstall skills with \`/skill add <owner/repo>\`\nBrowse available skills at https://skills.sh`,
				ts: Date.now(),
			})
			return
		}

		// Group by scope
		const projectSkills = skills.filter((s) => s.scope === "project")
		const globalSkills = skills.filter((s) => s.scope === "global")

		let output = `**Installed Skills** (${skills.length} total)\n\n`

		if (projectSkills.length > 0) {
			output += `**Project** (${getSkillsDir("project", config.cwd)})\n`
			for (const skill of projectSkills) {
				output += `  ${formatSkillInfo(skill)}\n`
			}
			output += "\n"
		}

		if (globalSkills.length > 0) {
			output += `**Global** (${getSkillsDir("global")})\n`
			for (const skill of globalSkills) {
				output += `  ${formatSkillInfo(skill)}\n`
			}
		}

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: output.trim(),
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to list skills: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Handle /skill add
 */
async function handleAdd(context: CommandContext, args: string[]): Promise<void> {
	const { addMessage, config } = context

	// Find the source (first non-flag argument)
	const source = args.find((arg) => !arg.startsWith("-"))

	if (!source) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Usage: \`/skill add <source>\`\n\nExample: \`/skill add vercel-labs/agent-skills\``,
			ts: Date.now(),
		})
		return
	}

	// Parse options
	const scope: SkillScope = args.includes("--global") || args.includes("-g") ? "global" : "project"
	const force = args.includes("--force") || args.includes("-f")

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content: `Installing skills from \`${source}\`...`,
		ts: Date.now(),
	})

	try {
		const result = await installFromSource(source, { scope, force, cwd: config.cwd })

		// Build output message
		let output = ""

		if (result.installed.length > 0) {
			output += `**✅ Installed ${result.installed.length} skill(s):**\n`
			for (const skill of result.installed) {
				output += `  • ${skill.name}`
				if (skill.description) {
					output += ` - ${skill.description.substring(0, 60)}${skill.description.length > 60 ? "..." : ""}`
				}
				output += "\n"
			}
			output += "\n"
		}

		if (result.skipped.length > 0) {
			output += `**⏭️ Skipped ${result.skipped.length} skill(s):**\n`
			for (const skip of result.skipped) {
				output += `  • ${skip.name} - ${skip.reason}\n`
			}
			output += "\n"
		}

		if (result.errors.length > 0) {
			output += `**❌ Errors:**\n`
			for (const err of result.errors) {
				output += `  • ${err.name}: ${err.error}\n`
			}
		}

		if (result.installed.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
			output = "No skills found in the repository."
		}

		addMessage({
			id: Date.now().toString(),
			type: result.errors.length > 0 && result.installed.length === 0 ? "error" : "system",
			content: output.trim(),
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to install skills: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Handle /skill remove
 */
async function handleRemove(context: CommandContext, args: string[]): Promise<void> {
	const { addMessage, config } = context

	// Find the skill name (first non-flag argument)
	const name = args.find((arg) => !arg.startsWith("-"))

	if (!name) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Usage: \`/skill remove <name>\`\n\nExample: \`/skill remove vercel-react-best-practices\``,
			ts: Date.now(),
		})
		return
	}

	// Parse options
	const scope: SkillScope | undefined =
		args.includes("--global") || args.includes("-g")
			? "global"
			: args.includes("--project") || args.includes("-p")
				? "project"
				: undefined

	try {
		const result = await removeSkill(name, { scope, cwd: config.cwd })

		if (result.removed && result.skill) {
			addMessage({
				id: Date.now().toString(),
				type: "system",
				content: `✅ Removed skill: **${result.skill.name}** from ${result.skill.scope} scope`,
				ts: Date.now(),
			})
		} else {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: result.error || `Skill "${name}" not found`,
				ts: Date.now(),
			})
		}
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to remove skill: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Subcommand autocomplete provider
 */
async function subcommandAutocompleteProvider(_context: ArgumentProviderContext) {
	return [
		{ value: "add", description: "Install skills from a GitHub repo", matchScore: 1.0, highlightedValue: "add" },
		{ value: "list", description: "List installed skills", matchScore: 1.0, highlightedValue: "list" },
		{ value: "remove", description: "Remove an installed skill", matchScore: 1.0, highlightedValue: "remove" },
	]
}

/**
 * Installed skills autocomplete provider for remove command
 */
async function installedSkillsAutocompleteProvider(context: ArgumentProviderContext) {
	const subcommand = context.getArgument("subcommand")
	if (subcommand !== "remove") {
		return []
	}

	try {
		const skills = await listSkills({ scope: "all" })
		return skills.map((skill) => ({
			value: skill.name.toLowerCase().replace(/\s+/g, "-"),
			title: skill.name,
			description: `${skill.scope}: ${skill.description || "No description"}`,
			matchScore: 1.0,
			highlightedValue: skill.name,
		}))
	} catch {
		return []
	}
}

export const skillCommand: Command = {
	name: "skill",
	aliases: ["skills"],
	description: "Install, list, and manage skills from skills.sh",
	usage: "/skill <subcommand> [args]",
	examples: [
		"/skill add vercel-labs/agent-skills",
		"/skill add vercel-labs/agent-skills --global",
		"/skill list",
		"/skill remove vercel-react-best-practices",
	],
	category: "settings",
	priority: 7,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: add, list, remove",
			required: false,
			provider: subcommandAutocompleteProvider,
		},
		{
			name: "source-or-name",
			description: "GitHub repo (for add) or skill name (for remove)",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => context.getArgument("subcommand") === "remove",
					provider: installedSkillsAutocompleteProvider,
				},
			],
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show help
		if (args.length === 0) {
			showHelp(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()

		switch (subcommand) {
			case "add":
			case "install":
				await handleAdd(context, args.slice(1))
				break

			case "list":
			case "ls":
				await handleList(context, args.slice(1))
				break

			case "remove":
			case "rm":
			case "uninstall":
				await handleRemove(context, args.slice(1))
				break

			case "help":
			case "-h":
			case "--help":
				showHelp(context)
				break

			default:
				context.addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: add, list, remove`,
					ts: Date.now(),
				})
		}
	},
}
