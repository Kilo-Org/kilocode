/**
 * Mock implementation of vscode.window namespace
 * Contains editor management, UI elements, and decoration APIs
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

const window = {
    /**
     * Currently active text editor, or undefined if none is active
     * Tests commonly override: vi.mocked(vscode.window).activeTextEditor = mockEditor
     */
    activeTextEditor: undefined,

    /**
     * All visible text editors
     * Tests can override: vi.mocked(vscode.window).visibleTextEditors = [mockEditor1, mockEditor2]
     */
    visibleTextEditors: [],

    /**
     * Create a text editor decoration type
     * Tests commonly spy on: vi.spyOn(vscode.window, 'createTextEditorDecorationType')
     */
    createTextEditorDecorationType: createMockFn().mockImplementation((options) => ({
        key: `decoration-${Math.random().toString(36).substring(2, 15)}`,
        dispose: createMockFn(),
        ...options
    })),

    /**
     * Show an information message
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showInformationMessage')
     */
    showInformationMessage: createMockFn().mockResolvedValue(undefined),

    /**
     * Show a warning message
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showWarningMessage')
     */
    showWarningMessage: createMockFn().mockResolvedValue(undefined),

    /**
     * Show an error message
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showErrorMessage')
     */
    showErrorMessage: createMockFn().mockResolvedValue(undefined),

    /**
     * Show a quick pick menu
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showQuickPick')
     */
    showQuickPick: createMockFn().mockResolvedValue(undefined),

    /**
     * Show an input box
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showInputBox')
     */
    showInputBox: createMockFn().mockResolvedValue(undefined),

    /**
     * Show a text document in an editor
     * Tests commonly spy on: vi.spyOn(vscode.window, 'showTextDocument')
     */
    showTextDocument: createMockFn().mockResolvedValue(undefined),

    /**
     * Create a status bar item
     * Tests commonly spy on: vi.spyOn(vscode.window, 'createStatusBarItem')
     */
    createStatusBarItem: createMockFn().mockImplementation(() => ({
        text: '',
        tooltip: '',
        show: createMockFn(),
        hide: createMockFn(),
        dispose: createMockFn()
    })),

    /**
     * Create an output channel
     * Tests commonly spy on: vi.spyOn(vscode.window, 'createOutputChannel')
     */
    createOutputChannel: createMockFn().mockImplementation((name) => ({
        name,
        append: createMockFn(),
        appendLine: createMockFn(),
        clear: createMockFn(),
        show: createMockFn(),
        hide: createMockFn(),
        dispose: createMockFn()
    })),

    /**
     * Create a webview panel
     * Tests commonly spy on: vi.spyOn(vscode.window, 'createWebviewPanel')
     */
    createWebviewPanel: createMockFn().mockImplementation((viewType, title, showOptions, options) => ({
        viewType,
        title,
        webview: {
            html: '',
            postMessage: createMockFn(),
            onDidReceiveMessage: createMockFn()
        },
        onDidDispose: createMockFn(),
        dispose: createMockFn()
    })),

    /**
     * Terminal-related APIs
     */
    createTerminal: createMockFn().mockImplementation((options = {}) => ({
        name: options.name || 'Terminal',
        sendText: createMockFn(),
        show: createMockFn(),
        hide: createMockFn(),
        dispose: createMockFn()
    })),

    activeTerminal: undefined,
    terminals: []
}

module.exports = window