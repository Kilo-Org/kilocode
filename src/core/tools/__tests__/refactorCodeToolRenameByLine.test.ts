import * as vscode from "vscode"
import * as fs from "fs/promises"
import { refactorCodeTool } from "../refactorCodeTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"

// Mock fs/promises
jest.mock("fs/promises", () => ({
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue("mock content"),
    writeFile: jest.fn().mockResolvedValue(undefined),
    access: jest.fn().mockImplementation((path) => {
        // Simulate file not found for target paths
        if (path.includes("target")) {
            return Promise.reject(new Error("File not found"));
        }
        return Promise.resolve();
    }),
}));

// Mock path module
jest.mock("path", () => ({
    resolve: jest.fn((cwd, relPath) => `${cwd}/${relPath}`),
    join: jest.fn((...args) => args.join("/")),
    normalize: jest.fn((p) => p),
    relative: jest.fn((from, to) => to),
    basename: jest.fn((p) => p.substring(p.lastIndexOf("/") + 1)),
    dirname: jest.fn((p) => p.substring(0, p.lastIndexOf("/"))),
    extname: jest.fn((p) => {
        const lastDotIndex = p.lastIndexOf(".");
        return lastDotIndex !== -1 ? p.substring(lastDotIndex) : "";
    }),
}));

// Mock vscode
jest.mock("vscode", () => ({
    Uri: {
        file: jest.fn((path) => ({
            fsPath: path,
            toString: () => `file://${path}`,
        })),
    },
    workspace: {
        openTextDocument: jest.fn(),
        applyEdit: jest.fn(),
        fs: {
            writeFile: jest.fn(),
        },
    },
    window: {
        showTextDocument: jest.fn(),
    },
    commands: {
        executeCommand: jest.fn(),
    },
    Position: jest.fn((line, char) => ({ line, character: char })),
    Selection: jest.fn((start, end) => ({ start, end })),
    Range: jest.fn((start, end) => ({ start, end })),
    CodeActionKind: {
        RefactorExtract: { value: "refactor.extract" },
        RefactorMove: { value: "refactor.move" },
    },
    WorkspaceEdit: jest.fn(() => ({
        replace: jest.fn(),
        insert: jest.fn(),
        delete: jest.fn(),
    })),
}));

// Mock file system
jest.mock("../../../utils/fs", () => ({
    fileExistsAtPath: jest.fn().mockResolvedValue(true),
}));

describe("refactorCodeTool - Rename by Line Tests", () => {
    let mockCline: Task;
    let mockAskApproval: any;
    let mockHandleError: any;
    let mockPushToolResult: any;
    let mockRemoveClosingTag: any;

    beforeEach(() => {
        jest.clearAllMocks();

        mockCline = {
            cwd: "/test",
            consecutiveMistakeCount: 0,
            recordToolError: jest.fn(),
            sayAndCreateMissingParamError: jest.fn().mockResolvedValue("Missing parameter error"),
            say: jest.fn(),
            ask: jest.fn(),
            rooIgnoreController: {
                validateAccess: jest.fn().mockReturnValue(true),
            },
            fileContextTracker: {
                trackFileContext: jest.fn(),
            },
            didEditFile: false,
        } as any;

        mockAskApproval = jest.fn().mockResolvedValue(true);
        mockHandleError = jest.fn();
        mockPushToolResult = jest.fn();
        mockRemoveClosingTag = jest.fn((tag, content) => content || "");
    });

    // Test 1: Failure to find a renameable symbol at line 7
    it("should handle failure to find a renameable symbol at specified line", async () => {
        // Mock document with a line that doesn't contain a renameable symbol
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
// This function will be used to test renaming by line number
function multiplyNumbers(x: number, y: number): number {
    return x * y;
}

const testValueRename = 42;
console.log(multiplyNumbers(testValueRename, 2));`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// This function will be used to test renaming by line number",
                    "function multiplyNumbers(x: number, y: number): number {",
                    "    return x * y;",
                    "}",
                    "",
                    "const testValueRename = 42;",
                    "console.log(multiplyNumbers(testValueRename, 2));"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 7,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that won't be renameable
                return new vscode.Position(6, 0);
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return null (no rename possible)
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, ..._args) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Return null to simulate no rename possible
                return Promise.resolve(null);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "rename_symbol",
                    start_line: "7", // Line with console.log that should not be renameable
                    new_name: "newValue",
                }),
            },
            partial: false,
        };

        await refactorCodeTool(
            mockCline,
            block,
            mockAskApproval,
            mockHandleError,
            mockPushToolResult,
            mockRemoveClosingTag
        );

        // Verify error message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Cannot find renameable symbol at line 7")
        );
    });

    // Test 2: Successfully find a renameable symbol at a different line
    it("should successfully rename a symbol when found at a different line", async () => {
        // Mock document with a line that contains a renameable symbol
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
// This function will be used to test renaming by line number
function multiplyNumbers(x: number, y: number): number {
    return x * y;
}

const testValueRename = 42;
console.log(multiplyNumbers(testValueRename, 2));`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// This function will be used to test renaming by line number",
                    "function multiplyNumbers(x: number, y: number): number {",
                    "    return x * y;",
                    "}",
                    "",
                    "const testValueRename = 42;",
                    "console.log(multiplyNumbers(testValueRename, 2));"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 7,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(5, 6); // Position of testValueRename
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return a valid WorkspaceEdit
        const mockRenameEdit = {
            size: 2, // Two occurrences (declaration and usage)
            entries: jest.fn().mockReturnValue([
                [vscode.Uri.file("/test/test.ts"), []]
            ]),
        };

        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, ...args) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Return a valid edit for line 6 (testValueRename)
                if (args[1].line === 5) {
                    return Promise.resolve(mockRenameEdit);
                }
                // Return null for other positions
                return Promise.resolve(null);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with the renamed variable
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`
// This function will be used to test renaming by line number
function multiplyNumbers(x: number, y: number): number {
    return x * y;
}

const newValue = 42;
console.log(multiplyNumbers(newValue, 2));`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "rename_symbol",
                    start_line: "6", // Line with testValueRename
                    new_name: "newValue",
                }),
            },
            partial: false,
        };

        await refactorCodeTool(
            mockCline,
            block,
            mockAskApproval,
            mockHandleError,
            mockPushToolResult,
            mockRemoveClosingTag
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully renamed symbol to 'newValue'")
        );
    });

    // Test 3: Test with a line that has multiple identifiers
    it("should find the correct identifier to rename when line has multiple options", async () => {
        // Mock document with a line that contains multiple identifiers
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
function processData(data, options) {
    const result = transformData(data, options.format);
    return result;
}`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "function processData(data, options) {",
                    "    const result = transformData(data, options.format);",
                    "    return result;",
                    "}"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 4,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(1, 16); // Position of transformData
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return different results for different positions
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, _uri, position, _newName) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Only return a valid edit for transformData
                if (position.character >= 16 && position.character <= 27) {
                    return Promise.resolve({
                        size: 1,
                        entries: jest.fn().mockReturnValue([
                            [vscode.Uri.file("/test/test.ts"), []]
                        ]),
                    });
                }
                // Return null for other positions
                return Promise.resolve(null);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with the renamed function
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`
function processData(data, options) {
    const result = processInput(data, options.format);
    return result;
}`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "rename_symbol",
                    start_line: "2", // Line with multiple identifiers
                    new_name: "processInput",
                }),
            },
            partial: false,
        };

        await refactorCodeTool(
            mockCline,
            block,
            mockAskApproval,
            mockHandleError,
            mockPushToolResult,
            mockRemoveClosingTag
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully renamed symbol to 'processInput'")
        );
    });
});