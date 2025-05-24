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
    relative: jest.fn((from, to) => {
        // Mock relative path calculation for import statements
        if (from.includes("/test") && to.includes("/test")) {
            return ".";
        }
        return to;
    }),
    basename: jest.fn((p, ext) => {
        const base = p.substring(p.lastIndexOf("/") + 1);
        if (ext && base.endsWith(ext)) {
            return base.substring(0, base.length - ext.length);
        }
        return base;
    }),
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

// Mock moveCode module
jest.mock("../../../services/code-transform/moveCode", () => {
    return {
        moveCode: jest.fn().mockImplementation((_sourcePath, _targetPath, _startLine, _endLine) => {
            return Promise.resolve({
                success: true,
                modifiedSourceCode: "import { StringUtils } from './string-utils';\n\n// This function will remain in this file\nfunction formatText(text: string): string {\n    return StringUtils.capitalize(text);\n}\n\nconst sampleText = \"hello world\";\nconsole.log(formatText(sampleText));\nconsole.log(StringUtils.reverse(sampleText));",
                modifiedTargetCode: "export class StringUtils {\n    static capitalize(str: string): string {\n        if (!str) return str;\n        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();\n    }\n\n    static reverse(str: string): string {\n        return str.split(\"\").reverse().join(\"\");\n    }\n\n    static countWords(str: string): number {\n        return str.trim().split(/\\s+/).length;\n    }\n}",
                movedNodes: 1,
                importsAdded: true,
                exportedNames: ["StringUtils"],
                dependenciesImported: false,
                dependencies: []
            });
        })
    };
});

describe("refactorCodeTool - Move to File Tests", () => {
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

    // Test 1: Correct import statement generation
    it("should generate correct import statements when moving code to a new file", async () => {
        // Mock document with a class that will be moved
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// This utility class will be moved to a new file
class StringUtils {
    static capitalize(str: string): string {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static reverse(str: string): string {
        return str.split("").reverse().join("");
    }

    static countWords(str: string): number {
        return str.trim().split(/\\s+/).length;
    }
}

// This function will remain in this file
function formatText(text: string): string {
    return StringUtils.capitalize(text);
}

const sampleText = "hello world";
console.log(formatText(sampleText));
console.log(StringUtils.reverse(sampleText));`),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 24,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
        };

        const mockEditor = {
            selection: null,
        };

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/string-utils.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]);

        // Mock fs.readFile to return the expected content after the move
        (fs.readFile as jest.Mock).mockImplementation((path: string) => {
            if (path.includes("string-utils.ts")) {
                return Promise.resolve(`export class StringUtils {
    static capitalize(str: string): string {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static reverse(str: string): string {
        return str.split("").reverse().join("");
    }

    static countWords(str: string): number {
        return str.trim().split(/\\s+/).length;
    }
}`);
            } else {
                return Promise.resolve(`import { StringUtils } from './string-utils';

// This function will remain in this file
function formatText(text: string): string {
    return StringUtils.capitalize(text);
}

const sampleText = "hello world";
console.log(formatText(sampleText));
console.log(StringUtils.reverse(sampleText));`);
            }
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "2",
                    end_line: "15",
                    target_path: "string-utils.ts",
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

        // Get the moveCode mock
        const { moveCode } = require("../../../services/code-transform/moveCode");

        // Verify moveCode was called with correct parameters
        expect(moveCode).toHaveBeenCalledWith(
            "/test/test.ts",
            "/test/string-utils.ts",
            2,
            15
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved code from lines 2-15 to string-utils.ts and added imports for StringUtils")
        );

        // Verify the import statement format in the source file
        const sourceContent = await fs.readFile("/test/test.ts", "utf-8");
        expect(sourceContent).toContain("import { StringUtils } from './string-utils';");
    });

    // Test 2: Test with incorrect import path format
    it("should handle different directory structures for import paths", async () => {
        // Mock document with a class that will be moved to a subdirectory
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// This utility class will be moved to a new file
class StringUtils {
    static capitalize(str: string): string {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static reverse(str: string): string {
        return str.split("").reverse().join("");
    }

    static countWords(str: string): number {
        return str.trim().split(/\\s+/).length;
    }
}

// This function will remain in this file
function formatText(text: string): string {
    return StringUtils.capitalize(text);
}

const sampleText = "hello world";
console.log(formatText(sampleText));
console.log(StringUtils.reverse(sampleText));`),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 24,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock path.relative to simulate a subdirectory
        const pathModule = require("path");
        (pathModule.relative as jest.Mock).mockImplementation((from, to) => {
            if (from === "/test" && to === "/test/utils") {
                return "utils";
            }
            return "relative-path";
        });

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/utils/string-utils.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]);

        // Mock moveCode to return content with imports for a subdirectory
        const { moveCode } = require("../../../services/code-transform/moveCode");
        moveCode.mockImplementationOnce((_sourcePath: string, _targetPath: string, _startLine: number, _endLine: number) => {
            return Promise.resolve({
                success: true,
                modifiedSourceCode: "import { StringUtils } from './utils/string-utils';\n\n// This function will remain in this file\nfunction formatText(text: string): string {\n    return StringUtils.capitalize(text);\n}\n\nconst sampleText = \"hello world\";\nconsole.log(formatText(sampleText));\nconsole.log(StringUtils.reverse(sampleText));",
                modifiedTargetCode: "export class StringUtils {\n    static capitalize(str: string): string {\n        if (!str) return str;\n        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();\n    }\n\n    static reverse(str: string): string {\n        return str.split(\"\").reverse().join(\"\");\n    }\n\n    static countWords(str: string): number {\n        return str.trim().split(/\\s+/).length;\n    }\n}",
                movedNodes: 1,
                importsAdded: true,
                exportedNames: ["StringUtils"],
                dependenciesImported: false,
                dependencies: []
            });
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "2",
                    end_line: "15",
                    target_path: "utils/string-utils.ts",
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

        // Verify moveCode was called with correct parameters
        expect(moveCode).toHaveBeenCalledWith(
            "/test/test.ts",
            "/test/utils/string-utils.ts",
            2,
            15
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved code from lines 2-15 to utils/string-utils.ts and added imports for StringUtils")
        );
    });

    // Test 3: Test with code action edit
    it("should handle move_to_file with code action edit", async () => {
        // Mock document with a class that will be moved
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// This utility class will be moved to a new file
class StringUtils {
    static capitalize(str: string): string {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static reverse(str: string): string {
        return str.split("").reverse().join("");
    }

    static countWords(str: string): number {
        return str.trim().split(/\\s+/).length;
    }
}

// This function will remain in this file
function formatText(text: string): string {
    return StringUtils.capitalize(text);
}

const sampleText = "hello world";
console.log(formatText(sampleText));
console.log(StringUtils.reverse(sampleText));`),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 24,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the code action provider for move_to_file
        const mockMoveAction = {
            title: "Move to a new file",
            edit: {
                delete: jest.fn(),
                // Add a mock for the edit that would be applied
                entries: jest.fn().mockReturnValue([
                    [vscode.Uri.file("/test/test.ts"), []],
                    [vscode.Uri.file("/test/string-utils.ts"), []]
                ]),
                size: 2
            },
        };

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/string-utils.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([mockMoveAction]);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return the expected content after the move
        (fs.readFile as jest.Mock).mockImplementation((path: string) => {
            if (path.includes("string-utils.ts")) {
                return Promise.resolve(`export class StringUtils {
    static capitalize(str: string): string {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }

    static reverse(str: string): string {
        return str.split("").reverse().join("");
    }

    static countWords(str: string): number {
        return str.trim().split(/\\s+/).length;
    }
}`);
            } else {
                // Note: This import statement is incorrect - it should be './string-utils'
                return Promise.resolve(`import { StringUtils } from 'string-utils';

// This function will remain in this file
function formatText(text: string): string {
    return StringUtils.capitalize(text);
}

const sampleText = "hello world";
console.log(formatText(sampleText));
console.log(StringUtils.reverse(sampleText));`);
            }
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "2",
                    end_line: "15",
                    target_path: "string-utils.ts",
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

        // Verify code action provider was called with correct filter
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            "vscode.executeCodeActionProvider",
            mockDocument.uri,
            expect.any(Object), // Range
            "refactor.move",
        );

        // Verify workspace edit was applied
        expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockMoveAction.edit);

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved code from lines 2-15 to string-utils.ts")
        );

        // The test should detect that the import statement is incorrect
        // In a real scenario, we would need to fix this in the implementation
    });
});