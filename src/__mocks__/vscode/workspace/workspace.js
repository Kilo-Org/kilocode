/**
 * Mock implementation of vscode.workspace namespace
 * Handles configuration, documents, and workspace management
 */

// Create mock functions compatible with vitest without requiring vitest directly
const createMockFn = () => {
    const fn = function (...args) {
        return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined
    }
    fn._mockReturnValue = undefined
    fn.mockReturnValue = (value) => { fn._mockReturnValue = value; return fn }
    fn.mockResolvedValue = (value) => { fn._mockReturnValue = Promise.resolve(value); return fn }
    fn.mockImplementation = (impl) => {
        const originalFn = fn
        const newFn = function (...args) { return impl(...args) }
        Object.setPrototypeOf(newFn, originalFn)
        Object.assign(newFn, originalFn)
        return newFn
    }
    fn.mockClear = () => { fn._mockReturnValue = undefined }
    return fn
}

const workspace = {
    /**
     * Get workspace configuration
     * Tests commonly override: vi.spyOn(vscode.workspace, 'getConfiguration')
     */
    getConfiguration: createMockFn().mockImplementation((section = '', scope = null) => ({
        /**
         * Get configuration value
         * Tests commonly chain: .getConfiguration().get.mockReturnValue(value)
         */
        get: createMockFn().mockReturnValue(undefined),

        /**
         * Check if configuration has a value
         */
        has: createMockFn().mockReturnValue(false),

        /**
         * Inspect configuration details
         */
        inspect: createMockFn().mockReturnValue({
            key: section,
            defaultValue: undefined,
            globalValue: undefined,
            workspaceValue: undefined,
            workspaceFolderValue: undefined
        }),

        /**
         * Update configuration
         * Tests commonly spy on: vi.spyOn(config, 'update')
         */
        update: createMockFn().mockResolvedValue(undefined)
    })),

    /**
     * Open a text document
     * Tests commonly override: vi.spyOn(vscode.workspace, 'openTextDocument')
     */
    openTextDocument: createMockFn().mockImplementation(async (uriOrOptions) => {
        // Mock document that tests can customize
        return {
            uri: typeof uriOrOptions === 'string' ? { toString: () => uriOrOptions } : uriOrOptions,
            fileName: 'mock-document.ts',
            isUntitled: false,
            languageId: 'typescript',
            version: 1,
            isDirty: false,
            isClosed: false,
            lineCount: 10,
            getText: createMockFn().mockReturnValue('mock document content'),
            lineAt: createMockFn().mockReturnValue({
                text: 'mock line content',
                lineNumber: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } },
                rangeIncludingLineBreak: { start: { line: 0, character: 0 }, end: { line: 0, character: 18 } },
                firstNonWhitespaceCharacterIndex: 0,
                isEmptyOrWhitespace: false
            }),
            positionAt: createMockFn().mockReturnValue({ line: 0, character: 0 }),
            offsetAt: createMockFn().mockReturnValue(0),
            save: createMockFn().mockResolvedValue(true),
            getWordRangeAtPosition: createMockFn().mockReturnValue(undefined),
            validateRange: createMockFn().mockImplementation(range => range),
            validatePosition: createMockFn().mockImplementation(position => position)
        }
    }),

    /**
     * Apply workspace edit
     * Tests commonly spy on: vi.spyOn(vscode.workspace, 'applyEdit')
     */
    applyEdit: createMockFn().mockResolvedValue(true),

    /**
     * Save all dirty documents
     * Tests commonly spy on: vi.spyOn(vscode.workspace, 'saveAll')
     */
    saveAll: createMockFn().mockResolvedValue(true),

    /**
     * Find files in workspace
     * Tests commonly override: vi.spyOn(vscode.workspace, 'findFiles')
     */
    findFiles: createMockFn().mockResolvedValue([]),

    /**
     * Create file system watcher
     * Tests commonly spy on: vi.spyOn(vscode.workspace, 'createFileSystemWatcher')
     */
    createFileSystemWatcher: createMockFn().mockImplementation((pattern) => ({
        onDidCreate: createMockFn(),
        onDidChange: createMockFn(),
        onDidDelete: createMockFn(),
        dispose: createMockFn()
    })),

    /**
     * Get workspace folder for a URI
     * Tests commonly override: vi.spyOn(vscode.workspace, 'getWorkspaceFolder')
     */
    getWorkspaceFolder: createMockFn().mockReturnValue(undefined),

    /**
     * Get relative path for a URI
     * Tests commonly override: vi.spyOn(vscode.workspace, 'asRelativePath')
     */
    asRelativePath: createMockFn().mockImplementation((pathOrUri) => {
        const path = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath || pathOrUri.path
        // Return just the filename by default
        return path.split('/').pop() || path.split('\\').pop() || path
    }),

    /**
     * Workspace folders
     * Tests commonly override: vi.mocked(vscode.workspace).workspaceFolders = [...]
     */
    workspaceFolders: [],

    /**
     * Root path (deprecated, use workspaceFolders)
     * Tests commonly override: vi.mocked(vscode.workspace).rootPath = '/mock/path'
     */
    rootPath: undefined,

    /**
     * Workspace name
     * Tests commonly override: vi.mocked(vscode.workspace).name = 'Mock Workspace'
     */
    name: undefined,

    /**
     * Event handlers for tests to mock
     */
    onDidChangeConfiguration: createMockFn(),
    onDidChangeWorkspaceFolders: createMockFn(),
    onDidChangeTextDocument: createMockFn(),
    onDidOpenTextDocument: createMockFn(),
    onDidCloseTextDocument: createMockFn(),
    onDidSaveTextDocument: createMockFn(),
    onWillSaveTextDocument: createMockFn()
}

module.exports = workspace