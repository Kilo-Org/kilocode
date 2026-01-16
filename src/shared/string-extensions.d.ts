/**
 * Global string extensions declaration.
 * This file provides type declarations for String.prototype extensions
 * that are used across the codebase.
 *
 * The actual implementation is in src/utils/path.ts.
 *
 * This separate declaration file is necessary because the webview-ui package
 * includes ../src/shared in its tsconfig.json but not ../src/utils/path.ts.
 * Without this file, the webview-ui compilation would fail when processing
 * files that use the toPosix() method.
 */
declare global {
	interface String {
		/**
		 * Convert a path string to POSIX format (forward slashes).
		 * Extended-Length Paths in Windows (\\?\) are preserved.
		 * @returns The path with backslashes converted to forward slashes
		 */
		toPosix(): string
	}
}

// This export is needed to make this file a module
export {}
