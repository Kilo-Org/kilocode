/**
 * Centralized VS Code Mock System
 * 
 * This is the main entry point for all VS Code API mocks used across Ghost tests.
 * It combines modular components to provide both functional implementations and
 * per-test mocking capabilities.
 * 
 * Usage Patterns:
 * 1. Functional: Tests get working Position/Range/Selection classes by default
 * 2. Per-test mocking: Tests can override specific behaviors with vi.mocked() or vi.spyOn()
 * 
 * Example:
 * import * as vscode from "vscode"
 * 
 * // Use functional implementation
 * const pos = new vscode.Position(5, 10)
 * 
 * // Override specific behavior 
 * vi.mocked(vscode.window).activeTextEditor = mockEditor
 */

// Core classes with full functional implementations
const Position = require('./core/Position')
const Range = require('./core/Range')
const Selection = require('./core/Selection')
const Uri = require('./core/Uri')
const WorkspaceEdit = require('./core/WorkspaceEdit')

// Enums used throughout Ghost tests
const TextEditorRevealType = require('./enums/TextEditorRevealType')
const DecorationRangeBehavior = require('./enums/DecorationRangeBehavior')

// Namespace APIs with vi.fn() mocks for per-test overrides
const window = require('./window/window')
const workspace = require('./workspace/workspace')

// Additional enums and constants
const EndOfLine = {
    LF: 1,
    CRLF: 2
}

const SymbolKind = {
    File: 0,
    Module: 1,
    Namespace: 2,
    Package: 3,
    Class: 4,
    Method: 5,
    Property: 6,
    Field: 7,
    Constructor: 8,
    Enum: 9,
    Interface: 10,
    Function: 11,
    Variable: 12,
    Constant: 13,
    String: 14,
    Number: 15,
    Boolean: 16,
    Array: 17,
    Object: 18,
    Key: 19,
    Null: 20,
    EnumMember: 21,
    Struct: 22,
    Event: 23,
    Operator: 24,
    TypeParameter: 25
}

const CompletionItemKind = {
    Text: 0,
    Method: 1,
    Function: 2,
    Constructor: 3,
    Field: 4,
    Variable: 5,
    Class: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Unit: 10,
    Value: 11,
    Enum: 12,
    Keyword: 13,
    Snippet: 14,
    Color: 15,
    Reference: 17,
    File: 16,
    Folder: 18,
    EnumMember: 19,
    Constant: 20,
    Struct: 21,
    Event: 22,
    Operator: 23,
    TypeParameter: 24
}

// Language and diagnostic support
const DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3
}

// Export unified VS Code mock API
module.exports = {
    // Core position and range classes - functional implementations
    Position,
    Range,
    Selection,
    Uri,
    WorkspaceEdit,

    // Namespace APIs - mockable with vi.fn() overrides
    window,
    workspace,

    // Enums and constants
    TextEditorRevealType,
    DecorationRangeBehavior,
    EndOfLine,
    SymbolKind,
    CompletionItemKind,
    DiagnosticSeverity,

    // Create mock functions compatible with vitest without requiring vitest directly
    _createMockFn: () => {
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
    },

    // Language features - basic implementations for Ghost tests
    languages: {
        registerCompletionItemProvider: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        registerCodeActionProvider: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        registerHoverProvider: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        registerDefinitionProvider: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        createDiagnosticCollection: (() => {
            const fn = function (...args) {
                return fn._mockReturnValue !== undefined ? fn._mockReturnValue : {
                    name: args[0],
                    set: (() => {
                        const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
                    })(),
                    delete: (() => {
                        const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
                    })(),
                    clear: (() => {
                        const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
                    })(),
                    dispose: (() => {
                        const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
                    })()
                }
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
        })()
    },

    // Commands API
    commands: {
        registerCommand: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        executeCommand: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : Promise.resolve(undefined) }
            fn._mockReturnValue = Promise.resolve(undefined)
            fn.mockReturnValue = (value) => { fn._mockReturnValue = value; return fn }
            fn.mockResolvedValue = (value) => { fn._mockReturnValue = Promise.resolve(value); return fn }
            fn.mockImplementation = (impl) => {
                const originalFn = fn
                const newFn = function (...args) { return impl(...args) }
                Object.setPrototypeOf(newFn, originalFn)
                Object.assign(newFn, originalFn)
                return newFn
            }
            fn.mockClear = () => { fn._mockReturnValue = Promise.resolve(undefined) }
            return fn
        })(),
        getCommands: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : Promise.resolve([]) }
            fn._mockReturnValue = Promise.resolve([])
            fn.mockReturnValue = (value) => { fn._mockReturnValue = value; return fn }
            fn.mockResolvedValue = (value) => { fn._mockReturnValue = Promise.resolve(value); return fn }
            fn.mockImplementation = (impl) => {
                const originalFn = fn
                const newFn = function (...args) { return impl(...args) }
                Object.setPrototypeOf(newFn, originalFn)
                Object.assign(newFn, originalFn)
                return newFn
            }
            fn.mockClear = () => { fn._mockReturnValue = Promise.resolve([]) }
            return fn
        })()
    },

    // Extensions API
    extensions: {
        getExtension: (() => {
            const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : undefined }
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
        })(),
        all: []
    },

    // Environment information
    env: {
        appName: 'Visual Studio Code - Test',
        appRoot: '/mock/vscode',
        language: 'en',
        clipboard: {
            readText: (() => {
                const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : Promise.resolve('') }
                fn._mockReturnValue = Promise.resolve('')
                fn.mockReturnValue = (value) => { fn._mockReturnValue = value; return fn }
                fn.mockResolvedValue = (value) => { fn._mockReturnValue = Promise.resolve(value); return fn }
                fn.mockImplementation = (impl) => {
                    const originalFn = fn
                    const newFn = function (...args) { return impl(...args) }
                    Object.setPrototypeOf(newFn, originalFn)
                    Object.assign(newFn, originalFn)
                    return newFn
                }
                fn.mockClear = () => { fn._mockReturnValue = Promise.resolve('') }
                return fn
            })(),
            writeText: (() => {
                const fn = function (...args) { return fn._mockReturnValue !== undefined ? fn._mockReturnValue : Promise.resolve(undefined) }
                fn._mockReturnValue = Promise.resolve(undefined)
                fn.mockReturnValue = (value) => { fn._mockReturnValue = value; return fn }
                fn.mockResolvedValue = (value) => { fn._mockReturnValue = Promise.resolve(value); return fn }
                fn.mockImplementation = (impl) => {
                    const originalFn = fn
                    const newFn = function (...args) { return impl(...args) }
                    Object.setPrototypeOf(newFn, originalFn)
                    Object.assign(newFn, originalFn)
                    return newFn
                }
                fn.mockClear = () => { fn._mockReturnValue = Promise.resolve(undefined) }
                return fn
            })()
        },
        shell: '/bin/bash'
    },

    // Version information
    version: '1.50.0'
}