import * as path from "path"

/**
 * Checks if a file should be ignored for code indexing based on hardcoded rules.
 * This provides an additional layer of filtering beyond git and .rooignore rules.
 *
 * @param relativeFilePath - The relative path of the file to check
 * @returns true if the file should be ignored, false if it should be indexed
 */
export function shouldIgnoreFile(relativeFilePath: string): boolean {
	const fileName = path.basename(relativeFilePath)
	const ext = path.extname(relativeFilePath).toLowerCase()
	const pathSegments = relativeFilePath.split(path.sep)

	// Lock files
	if (
		fileName === "package-lock.json" ||
		fileName === "yarn.lock" ||
		fileName === "pnpm-lock.yaml" ||
		fileName === "bun.lockb" ||
		fileName === "npm-shrinkwrap.json" ||
		fileName === "Gemfile.lock" ||
		fileName === "Cargo.lock" ||
		fileName === "poetry.lock" ||
		fileName === "composer.lock" ||
		fileName === "Pipfile.lock"
	) {
		return true
	}

	// Build artifacts and compiled output
	if (
		ext === ".o" ||
		ext === ".pyc" ||
		ext === ".pyo" ||
		ext === ".class" ||
		ext === ".dll" ||
		ext === ".exe" ||
		ext === ".so" ||
		ext === ".dylib" ||
		ext === ".min.js" ||
		ext === ".min.css" ||
		ext === ".bundle.js" ||
		ext === ".map" ||
		fileName.match(/\.dist\..+$/)
	) {
		return true
	}

	// Build and output directories
	if (
		pathSegments.includes(".next") ||
		pathSegments.includes(".nuxt") ||
		pathSegments.includes(".svelte-kit") ||
		pathSegments.includes(".angular") ||
		pathSegments.includes("__pycache__")
	) {
		return true
	}

	// Temporary files
	if (
		ext === ".cache" ||
		ext === ".tmp" ||
		ext === ".swp" ||
		ext === ".swo" ||
		fileName === ".DS_Store" ||
		fileName === "Thumbs.db"
	) {
		return true
	}

	// Binary and media files
	if (
		ext === ".png" ||
		ext === ".jpg" ||
		ext === ".jpeg" ||
		ext === ".gif" ||
		ext === ".ico" ||
		ext === ".svg" ||
		ext === ".pdf" ||
		ext === ".zip" ||
		ext === ".tar" ||
		ext === ".gz" ||
		ext === ".rar" ||
		ext === ".7z" ||
		ext === ".woff" ||
		ext === ".woff2" ||
		ext === ".ttf" ||
		ext === ".eot" ||
		ext === ".otf" ||
		ext === ".mp4" ||
		ext === ".mov" ||
		ext === ".avi" ||
		ext === ".webm" ||
		ext === ".mp3" ||
		ext === ".wav"
	) {
		return true
	}

	// Database files
	if (ext === ".db" || ext === ".sqlite" || ext === ".sqlite3") {
		return true
	}

	// Dependency directories (usually gitignored but sometimes checked in)
	if (pathSegments.includes("node_modules") || pathSegments.includes(".venv")) {
		return true
	}

	// Package manager metadata
	if (
		pathSegments.includes(".yarn") ||
		pathSegments.includes(".npm") ||
		pathSegments.includes(".pnp") ||
		fileName.endsWith(".pnp.cjs") ||
		fileName.endsWith(".pnp.js")
	) {
		return true
	}

	// Framework-specific generated files
	if (
		ext === ".g.dart" ||
		ext === ".pb.go" ||
		fileName.endsWith(".generated.ts") ||
		fileName.endsWith(".generated.js")
	) {
		return true
	}

	// VSCode extension specific
	if (ext === ".vsix") {
		return true
	}

	return false
}
