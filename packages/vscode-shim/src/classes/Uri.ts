import * as path from "path"

/**
 * Uniform Resource Identifier (URI) implementation
 *
 * Represents a URI following the RFC 3986 standard.
 * This class is compatible with VSCode's Uri class and provides
 * file system path handling for cross-platform compatibility.
 *
 * @example
 * ```typescript
 * // Create a file URI
 * const fileUri = Uri.file('/path/to/file.txt')
 * console.log(fileUri.fsPath) // '/path/to/file.txt'
 *
 * // Parse a URI string
 * const uri = Uri.parse('https://example.com/path?query=1#fragment')
 * console.log(uri.scheme) // 'https'
 * console.log(uri.path) // '/path'
 * ```
 */
export class Uri {
	public readonly scheme: string
	public readonly authority: string
	public readonly path: string
	public readonly query: string
	public readonly fragment: string

	constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
		this.scheme = scheme
		this.authority = authority
		this.path = path
		this.query = query
		this.fragment = fragment
	}

	/**
	 * Create a URI from a file system path
	 *
	 * @param path - The file system path
	 * @returns A new Uri instance with 'file' scheme
	 */
	static file(fsPath: string): Uri {
		return new Uri("file", "", fsPath, "", "")
	}

	/**
	 * Parse a URI string
	 *
	 * @param value - The URI string to parse
	 * @returns A new Uri instance
	 */
	static parse(value: string): Uri {
		try {
			const url = new URL(value)
			return new Uri(
				url.protocol.slice(0, -1),
				url.hostname,
				url.pathname,
				url.search.slice(1),
				url.hash.slice(1),
			)
		} catch {
			// If URL parsing fails, treat as file path
			return Uri.file(value)
		}
	}

	/**
	 * Join a URI with path segments
	 *
	 * @param base - The base URI
	 * @param pathSegments - Path segments to join
	 * @returns A new Uri with the joined path
	 */
	static joinPath(base: Uri, ...pathSegments: string[]): Uri {
		const joinedPath = path.join(base.path, ...pathSegments)
		return new Uri(base.scheme, base.authority, joinedPath, base.query, base.fragment)
	}

	/**
	 * Create a new URI with modifications
	 *
	 * @param change - The changes to apply
	 * @returns A new Uri instance with the changes applied
	 */
	with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
		return new Uri(
			change.scheme !== undefined ? change.scheme : this.scheme,
			change.authority !== undefined ? change.authority : this.authority,
			change.path !== undefined ? change.path : this.path,
			change.query !== undefined ? change.query : this.query,
			change.fragment !== undefined ? change.fragment : this.fragment,
		)
	}

	/**
	 * Get the file system path representation
	 * Compatible with both Unix and Windows paths
	 */
	get fsPath(): string {
		return this.path
	}

	/**
	 * Convert the URI to a string representation
	 */
	toString(): string {
		return `${this.scheme}://${this.authority}${this.path}${this.query ? "?" + this.query : ""}${this.fragment ? "#" + this.fragment : ""}`
	}

	/**
	 * Convert to JSON representation
	 */
	toJSON(): object {
		return {
			scheme: this.scheme,
			authority: this.authority,
			path: this.path,
			query: this.query,
			fragment: this.fragment,
		}
	}
}
