/**
 * Extracts a base command pattern from a full command string.
 * This removes specific file paths, arguments, and other variable parts
 * to create a more general pattern that can be auto-approved.
 *
 * Examples:
 * - "wc -l foo.txt" -> "wc -l"
 * - "git add src/file.js" -> "git add"
 * - "npm install --save lodash" -> "npm install"
 * - "ls -la /some/path" -> "ls -la"
 */
export function extractCommandPattern(command: string): string {
	if (!command || typeof command !== "string") {
		return command
	}

	const trimmed = command.trim()
	if (!trimmed) {
		return trimmed
	}

	// Split by pipes, semicolons, and && to handle chained commands
	const commandParts = trimmed.split(/\s*(?:\||\|\||;|&&)\s*/)

	const processedParts = commandParts.map((part) => {
		const tokens = part.trim().split(/\s+/)
		if (tokens.length === 0) return part

		const baseCommand = tokens[0]
		const args: string[] = []

		// Handle npm/yarn/pnpm special case: stop at "--" separator
		let stopIndex = tokens.length
		if (baseCommand === "npm" || baseCommand === "yarn" || baseCommand === "pnpm") {
			const separatorIndex = tokens.indexOf("--")
			if (separatorIndex !== -1) {
				stopIndex = separatorIndex
			}
		}

		// Process arguments, keeping flags but removing file paths and specific values
		for (let i = 1; i < stopIndex; i++) {
			const token = tokens[i]
			const nextToken = i + 1 < stopIndex ? tokens[i + 1] : null

			// Keep short flags (-l, -a, etc.)
			if (/^-[a-zA-Z]$/.test(token)) {
				args.push(token)
				continue
			}

			// Keep multi-character flags like -type, -name, etc.
			if (/^-[a-zA-Z]+$/.test(token)) {
				args.push(token)

				// For certain flags, keep their single-letter values (like -type f)
				if (
					nextToken &&
					/^[a-zA-Z]$/.test(nextToken) &&
					(token === "-type" || token === "-o" || token === "-e")
				) {
					args.push(nextToken)
					i++ // Skip the next token since we processed it
				}
				continue
			}

			// Keep long flags (--save, --verbose, etc.) but not their values
			if (/^--[a-zA-Z][a-zA-Z0-9-]*$/.test(token)) {
				args.push(token)
				continue
			}

			// Keep combined short flags (-la, -rf, etc.)
			if (/^-[a-zA-Z]{2,}$/.test(token)) {
				args.push(token)
				continue
			}

			// Skip file paths, URLs, and other specific arguments
			// This includes:
			// - Paths (./file, /path/to/file, ../file)
			// - Files with extensions (.txt, .js, etc.)
			// - URLs (http://, https://)
			// - Numbers and specific values
			// - Quoted strings (likely file patterns)
			if (
				/^\.{0,2}\//.test(token) || // relative paths
				/^\//.test(token) || // absolute paths
				/\.[a-zA-Z0-9]+$/.test(token) || // files with extensions
				/^https?:\/\//.test(token) || // URLs
				/^\d+$/.test(token) || // pure numbers
				/^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+/.test(token) || // files or domains
				/^["'].*["']$/.test(token) // quoted strings (likely patterns)
			) {
				// Skip this argument
				continue
			}

			// For common commands, keep certain patterns
			if (baseCommand === "git") {
				// Keep git subcommands but not file arguments
				if (i === 1 && /^[a-zA-Z]+$/.test(token)) {
					args.push(token)
				}
			} else if (baseCommand === "npm" || baseCommand === "yarn" || baseCommand === "pnpm") {
				// Keep npm/yarn/pnpm subcommands but not package names
				if (i === 1 && /^[a-zA-Z]+$/.test(token)) {
					args.push(token)
				}
			} else if (baseCommand === "docker") {
				// Keep docker subcommands
				if (i === 1 && /^[a-zA-Z]+$/.test(token)) {
					args.push(token)
				}
			}
			// Note: Multi-character flags like -type, -name are handled above in the general flag processing
		}

		return args.length > 0 ? `${baseCommand} ${args.join(" ")}` : baseCommand
	})

	return processedParts.join(" && ")
}

/**
 * Formats a command pattern for display to the user.
 * This makes it clear what pattern will be auto-approved.
 */
export function formatCommandPatternForDisplay(pattern: string): string {
	if (!pattern || pattern.trim() === "") {
		return pattern
	}

	// If the pattern is the same as a full command, show it as-is
	// Otherwise, indicate it's a pattern
	if (pattern.includes("&&") || pattern.includes("|")) {
		return `"${pattern}"`
	}

	return `"${pattern}"`
}
