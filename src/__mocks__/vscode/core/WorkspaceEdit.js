const Uri = require('./Uri')

/**
 * Mock implementation of vscode.WorkspaceEdit
 * Supports both functional usage and per-test mocking overrides
 */
class WorkspaceEdit {
    constructor() {
        // Internal storage for edits by URI
        this._edits = new Map()
        this._documentChanges = []
    }

    /**
     * Insert text at a position
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'insert').mockImplementation(...)
     */
    insert(uri, position, newText) {
        if (!this._edits.has(uri.toString())) {
            this._edits.set(uri.toString(), [])
        }

        this._edits.get(uri.toString()).push({
            range: {
                start: position,
                end: position
            },
            newText: newText
        })
    }

    /**
     * Delete text in a range
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'delete').mockImplementation(...)
     */
    delete(uri, range) {
        if (!this._edits.has(uri.toString())) {
            this._edits.set(uri.toString(), [])
        }

        this._edits.get(uri.toString()).push({
            range: range,
            newText: ''
        })
    }

    /**
     * Replace text in a range
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'replace').mockImplementation(...)
     */
    replace(uri, range, newText) {
        if (!this._edits.has(uri.toString())) {
            this._edits.set(uri.toString(), [])
        }

        this._edits.get(uri.toString()).push({
            range: range,
            newText: newText
        })
    }

    /**
     * Get all text edits for a URI
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'get').mockReturnValue(...)
     */
    get(uri) {
        return this._edits.get(uri.toString()) || []
    }

    /**
     * Check if workspace edit has edits for a URI
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'has').mockReturnValue(...)
     */
    has(uri) {
        const edits = this._edits.get(uri.toString())
        return edits && edits.length > 0
    }

    /**
     * Set all text edits for a URI at once
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'set').mockImplementation(...)
     */
    set(uri, edits) {
        this._edits.set(uri.toString(), [...edits])
    }

    /**
     * Iterate over all URI/edits pairs
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'entries').mockReturnValue(...)
     */
    *entries() {
        for (const [uriString, edits] of this._edits) {
            yield [Uri.parse(uriString), edits]
        }
    }

    /**
     * Get total edit count across all files
     * Can be mocked per-test: vi.spyOn(workspaceEdit, 'size').mockReturnValue(...)
     */
    get size() {
        let total = 0
        for (const edits of this._edits.values()) {
            total += edits.length
        }
        return total
    }

    /**
     * Convert to JSON for debugging
     * Can be mocked per-test for custom serialization
     */
    toJSON() {
        const result = {}
        for (const [uriString, edits] of this._edits) {
            result[uriString] = edits
        }
        return result
    }
}

module.exports = WorkspaceEdit