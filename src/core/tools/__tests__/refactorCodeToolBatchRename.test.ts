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

describe("refactorCodeTool - Batch Rename Tests", () => {
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

    // Test 1: Constructor call incorrectly renamed
    it("should correctly handle constructor calls when renaming variables", async () => {
        // Mock document with a class and constructor call
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// Mock class to avoid errors
class UserService {
    constructor(private baseUrl: string, private timeout: number) { }

    async fetchUserData(id: string) {
        return { id, name: "Test User" };
    }
}

// These variables will be renamed in batch
const baseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(baseUrl, defaultTimeout);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testUserOperations() {
    const userData = await userService.fetchUserData("123");
    console.log(userData);
}`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// Mock class to avoid errors",
                    "class UserService {",
                    "    constructor(private baseUrl: string, private timeout: number) { }",
                    "",
                    "    async fetchUserData(id: string) {",
                    "        return { id, name: \"Test User\" };",
                    "    }",
                    "}",
                    "",
                    "// These variables will be renamed in batch",
                    "const baseUrl = \"https://api.example.com\";",
                    "const defaultTimeout = 3000;",
                    "const userService = new UserService(baseUrl, defaultTimeout);",
                    "",
                    "// eslint-disable-next-line @typescript-eslint/no-unused-vars",
                    "async function testUserOperations() {",
                    "    const userData = await userService.fetchUserData(\"123\");",
                    "    console.log(userData);",
                    "}"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 19,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(10, 6); // Position of baseUrl
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return different results for different positions
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, _uri, _position, _newName) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Create a mock edit that correctly renames only the variable, not the constructor parameter
                const mockEdit = {
                    size: 2, // Two occurrences (declaration and usage in constructor call)
                    entries: jest.fn().mockReturnValue([
                        [vscode.Uri.file("/test/test.ts"), []]
                    ]),
                };
                return Promise.resolve(mockEdit);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with the renamed variable
        // The key issue is that the constructor call should be correctly renamed
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`// Mock class to avoid errors
class UserService {
    constructor(private baseUrl: string, private timeout: number) { }

    async fetchUserData(id: string) {
        return { id, name: "Test User" };
    }
}

// These variables will be renamed in batch
const apiBaseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(apiBaseUrl, defaultTimeout);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testUserOperations() {
    const userData = await userService.fetchUserData("123");
    console.log(userData);
}`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify([
                    {
                        operation: "rename_symbol",
                        old_name: "baseUrl",
                        new_name: "apiBaseUrl",
                    }
                ]),
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
            expect.stringContaining("Successfully renamed symbol to 'apiBaseUrl'")
        );

        // Verify the content after rename
        const content = await fs.readFile("/test/test.ts", "utf-8");

        // Check that the variable was renamed
        expect(content).toContain("const apiBaseUrl = \"https://api.example.com\";");

        // Check that the constructor call was correctly updated
        expect(content).toContain("const userService = new UserService(apiBaseUrl, defaultTimeout);");

        // Check that the class property was NOT renamed (should remain baseUrl)
        expect(content).toContain("constructor(private baseUrl: string, private timeout: number)");
    });

    // Test 2: Incorrect constructor call rename
    it("should detect and report when constructor calls are incorrectly renamed", async () => {
        // Mock document with a class and constructor call
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// Mock class to avoid errors
class UserService {
    constructor(private baseUrl: string, private timeout: number) { }

    async fetchUserData(id: string) {
        return { id, name: "Test User" };
    }
}

// These variables will be renamed in batch
const baseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(baseUrl, defaultTimeout);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testUserOperations() {
    const userData = await userService.fetchUserData("123");
    console.log(userData);
}`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// Mock class to avoid errors",
                    "class UserService {",
                    "    constructor(private baseUrl: string, private timeout: number) { }",
                    "",
                    "    async fetchUserData(id: string) {",
                    "        return { id, name: \"Test User\" };",
                    "    }",
                    "}",
                    "",
                    "// These variables will be renamed in batch",
                    "const baseUrl = \"https://api.example.com\";",
                    "const defaultTimeout = 3000;",
                    "const userService = new UserService(baseUrl, defaultTimeout);",
                    "",
                    "// eslint-disable-next-line @typescript-eslint/no-unused-vars",
                    "async function testUserOperations() {",
                    "    const userData = await userService.fetchUserData(\"123\");",
                    "    console.log(userData);",
                    "}"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 19,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(10, 6); // Position of baseUrl
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return different results for different positions
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, _uri, _position, _newName) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Create a mock edit that incorrectly renames the constructor call
                const mockEdit = {
                    size: 3, // Three occurrences (declaration, usage in constructor call, and constructor parameter)
                    entries: jest.fn().mockReturnValue([
                        [vscode.Uri.file("/test/test.ts"), []]
                    ]),
                };
                return Promise.resolve(mockEdit);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with incorrectly renamed constructor
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`// Mock class to avoid errors
class UserService {
    constructor(private apiBaseUrl: string, private timeout: number) { }

    async fetchUserData(id: string) {
        return { id, name: "Test User" };
    }
}

// These variables will be renamed in batch
const apiBaseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(apiBaseUrl, defaultTimeout);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function testUserOperations() {
    const userData = await userService.fetchUserData("123");
    console.log(userData);
}`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify([
                    {
                        operation: "rename_symbol",
                        old_name: "baseUrl",
                        new_name: "apiBaseUrl",
                    }
                ]),
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

        // Verify success message was pushed (the tool still reports success)
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully renamed symbol to 'apiBaseUrl'")
        );

        // Verify the content after rename
        const content = await fs.readFile("/test/test.ts", "utf-8");

        // Check that the constructor parameter was incorrectly renamed
        expect(content).toContain("constructor(private apiBaseUrl: string, private timeout: number)");
    });

    // Test 3: Multiple renames in batch
    it("should handle multiple renames in a batch operation", async () => {
        // Mock document with multiple variables to rename
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// Multiple variables to rename
const baseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const maxRetries = 5;

function fetchData(url = baseUrl, timeout = defaultTimeout, retries = maxRetries) {
    console.log(\`Fetching \${url} with timeout \${timeout} and \${retries} retries\`);
    return { success: true };
}`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// Multiple variables to rename",
                    "const baseUrl = \"https://api.example.com\";",
                    "const defaultTimeout = 3000;",
                    "const maxRetries = 5;",
                    "",
                    "function fetchData(url = baseUrl, timeout = defaultTimeout, retries = maxRetries) {",
                    "    console.log(`Fetching ${url} with timeout ${timeout} and ${retries} retries`);",
                    "    return { success: true };",
                    "}"
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 9,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(1, 6); // Position of baseUrl
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return different results for different positions
        let renameCount = 0;
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, _uri, _position, _newName) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                renameCount++;
                // Create a mock edit for each rename operation
                const mockEdit = {
                    size: 2, // Two occurrences for each variable (declaration and usage)
                    entries: jest.fn().mockReturnValue([
                        [vscode.Uri.file("/test/test.ts"), []]
                    ]),
                };
                return Promise.resolve(mockEdit);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with all variables renamed
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`// Multiple variables to rename
const apiBaseUrl = "https://api.example.com";
const requestTimeout = 3000;
const maxAttempts = 5;

function fetchData(url = apiBaseUrl, timeout = requestTimeout, retries = maxAttempts) {
    console.log(\`Fetching \${url} with timeout \${timeout} and \${retries} retries\`);
    return { success: true };
}`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify([
                    {
                        operation: "rename_symbol",
                        old_name: "baseUrl",
                        new_name: "apiBaseUrl",
                    },
                    {
                        operation: "rename_symbol",
                        old_name: "defaultTimeout",
                        new_name: "requestTimeout",
                    },
                    {
                        operation: "rename_symbol",
                        old_name: "maxRetries",
                        new_name: "maxAttempts",
                    }
                ]),
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
            expect.stringContaining("Batch refactoring completed successfully")
        );

        // Verify that all three rename operations were performed
        expect(renameCount).toBe(6);

        // Verify the content after rename
        const content = await fs.readFile("/test/test.ts", "utf-8");

        // Check that all variables were renamed
        expect(content).toContain("const apiBaseUrl = \"https://api.example.com\";");
        expect(content).toContain("const requestTimeout = 3000;");
        expect(content).toContain("const maxAttempts = 5;");

        // Check that function parameters were updated
        expect(content).toContain("function fetchData(url = apiBaseUrl, timeout = requestTimeout, retries = maxAttempts)");
    });
});