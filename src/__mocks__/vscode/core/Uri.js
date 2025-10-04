/**
 * Mock implementation of vscode.Uri
 * Provides URI parsing and manipulation functionality
 */
class Uri {
    constructor(scheme, authority, path, query, fragment) {
        this.scheme = scheme || 'file'
        this.authority = authority || ''
        this.path = path || ''
        this.query = query || ''
        this.fragment = fragment || ''
    }

    /**
     * Get the file system path for file URIs
     */
    get fsPath() {
        if (this.scheme !== 'file') {
            return this.path
        }

        // Handle different platforms
        let path = this.path

        // Convert file:///c:/path to C:\path on Windows-like paths
        if (path.match(/^\/[a-zA-Z]:/)) {
            // Windows path: /c:/path -> c:/path -> C:\path
            path = path.substring(1)
            if (process.platform === 'win32') {
                path = path.replace(/\//g, '\\')
            }
        }

        return path
    }

    /**
     * Create Uri from file system path
     */
    static file(path) {
        // Convert backslashes to forward slashes
        const normalizedPath = path.replace(/\\/g, '/')

        // Ensure path starts with /
        const uriPath = normalizedPath.startsWith('/') ? normalizedPath : '/' + normalizedPath

        return new Uri('file', '', uriPath)
    }

    /**
     * Parse URI string into Uri object
     */
    static parse(uriString) {
        // Simple URI parsing - in real VS Code this would be more robust
        const match = uriString.match(/^([^:]+):(?:\/\/([^\/]*))?(\/[^?#]*)?(?:\?([^#]*))?(?:#(.*))?$/)

        if (!match) {
            throw new Error(`Invalid URI: ${uriString}`)
        }

        const [, scheme, authority = '', path = '', query = '', fragment = ''] = match
        return new Uri(scheme, authority, path, query, fragment)
    }

    /**
     * Join path segments to this URI
     */
    with(change = {}) {
        return new Uri(
            change.scheme !== undefined ? change.scheme : this.scheme,
            change.authority !== undefined ? change.authority : this.authority,
            change.path !== undefined ? change.path : this.path,
            change.query !== undefined ? change.query : this.query,
            change.fragment !== undefined ? change.fragment : this.fragment
        )
    }

    /**
     * Convert to string representation
     */
    toString() {
        let result = this.scheme + ':'

        if (this.authority || this.scheme === 'file') {
            result += '//' + this.authority
        }

        result += this.path

        if (this.query) {
            result += '?' + this.query
        }

        if (this.fragment) {
            result += '#' + this.fragment
        }

        return result
    }

    /**
     * Convert to JSON representation
     */
    toJSON() {
        return {
            scheme: this.scheme,
            authority: this.authority,
            path: this.path,
            query: this.query,
            fragment: this.fragment
        }
    }
}

module.exports = Uri