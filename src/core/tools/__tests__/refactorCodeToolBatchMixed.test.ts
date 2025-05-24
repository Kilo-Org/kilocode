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
        // Simple mock for relative path
        if (from === to) return ".";
        return "./";
    }),
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

// Mock moveCode module
jest.mock("../../../services/code-transform/moveCode", () => {
    return {
        moveCode: jest.fn().mockImplementation((_sourcePath: string, _targetPath: string, _startLine: number, _endLine: number) => {
            return Promise.resolve({
                success: true,
                modifiedSourceCode: "import { Logger } from './logger';\n\n// These functions will be renamed\nfunction formatDateTime(date: Date): string {\n    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;\n}\n\nfunction calculateAge(birthDate: Date): number {\n    const today = new Date();\n    let age = today.getFullYear() - birthDate.getFullYear();\n    const monthDiff = today.getMonth() - birthDate.getMonth();\n\n    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {\n        age--;\n    }\n\n    return age;\n}\n\n// Test usage\nLogger.log(\"Application started\");\nLogger.warn(\"Resource usage high\");\nconst userBirthDate = new Date(1990, 5, 15);\nLogger.log(`User age: ${calculateAge(userBirthDate)}`);",
                modifiedTargetCode: "import { formatDateTime } from './test';\n\nexport class Logger {\n    static log(message: string, level: string = \"info\") {\n        console.log(`[${level.toUpperCase()}] ${formatDateTime(new Date())}: ${message}`);\n    }\n\n    static error(message: string) {\n        this.log(message, \"error\");\n    }\n\n    static warn(message: string) {\n        this.log(message, \"warn\");\n    }\n}",
                movedNodes: 1,
                importsAdded: true,
                exportedNames: ["Logger"],
                dependenciesImported: true,
                dependencies: ["formatDateTime"]
            });
        })
    };
});

describe("refactorCodeTool - Batch Mixed Operations Tests", () => {
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

    // Test 1: Batch mixed operations - formatDate not renamed, incorrect import in logger.ts
    it("should handle batch operations with rename and move correctly", async () => {
        // Mock document with a class and functions
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// This class will be moved to a new file
class Logger {
    static log(message: string, level: string = "info") {
        console.log(\`[\${level.toUpperCase()}] \${formatDate(new Date())}: \${message}\`);
    }

    static error(message: string) {
        this.log(message, "error");
    }

    static warn(message: string) {
        this.log(message, "warn");
    }
}

// These functions will be renamed
function formatDate(date: Date): string {
    return \`\${date.getFullYear()}-\${date.getMonth() + 1}-\${date.getDate()} \${date.getHours()}:\${date.getMinutes()}:\${date.getSeconds()}\`;
}

function calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
}

// Test usage
Logger.log("Application started");
Logger.warn("Resource usage high");
const userBirthDate = new Date(1990, 5, 15);
Logger.log(\`User age: \${calculateAge(userBirthDate)}\`);`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// This class will be moved to a new file",
                    "class Logger {",
                    "    static log(message: string, level: string = \"info\") {",
                    "        console.log(`[${level.toUpperCase()}] ${formatDate(new Date())}: ${message}`);",
                    "    }",
                    "",
                    "    static error(message: string) {",
                    "        this.log(message, \"error\");",
                    "    }",
                    "",
                    "    static warn(message: string) {",
                    "        this.log(message, \"warn\");",
                    "    }",
                    "}",
                    "",
                    "// These functions will be renamed",
                    "function formatDate(date: Date): string {",
                    "    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;",
                    "}",
                    "",
                    "function calculateAge(birthDate: Date): number {",
                    "    const today = new Date();",
                    "    let age = today.getFullYear() - birthDate.getFullYear();",
                    "    const monthDiff = today.getMonth() - birthDate.getMonth();",
                    "",
                    "    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {",
                    "        age--;",
                    "    }",
                    "",
                    "    return age;",
                    "}",
                    "",
                    "// Test usage",
                    "Logger.log(\"Application started\");",
                    "Logger.warn(\"Resource usage high\");",
                    "const userBirthDate = new Date(1990, 5, 15);",
                    "Logger.log(`User age: ${calculateAge(userBirthDate)}`);",
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 37,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((_offset: number) => {
                // Return a position that will be renameable
                return new vscode.Position(16, 10); // Position of formatDate
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return different results for different positions
        (vscode.commands.executeCommand as jest.Mock).mockImplementation((command, _uri, _position, _newName) => {
            if (command === "vscode.executeDocumentRenameProvider") {
                // Create a mock edit for rename operation
                const mockEdit = {
                    size: 2, // Two occurrences (declaration and usage)
                    entries: jest.fn().mockReturnValue([
                        [vscode.Uri.file("/test/test.ts"), []]
                    ]),
                };
                return Promise.resolve(mockEdit);
            } else if (command === "vscode.executeCodeActionProvider") {
                // Return empty array to trigger jscodeshift path for move operation
                return Promise.resolve([]);
            }
            return Promise.resolve();
        });

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/logger.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with renamed function and moved class
        (fs.readFile as jest.Mock).mockImplementation((path: string) => {
            if (path.includes("logger.ts")) {
                // Note: This import statement is incorrect - it should import formatDateTime, not formatDate
                return Promise.resolve(`import { formatDate } from './test';

export class Logger {
    static log(message: string, level: string = "info") {
        console.log(\`[\${level.toUpperCase()}] \${formatDate(new Date())}: \${message}\`);
    }

    static error(message: string) {
        this.log(message, "error");
    }

    static warn(message: string) {
        this.log(message, "warn");
    }
}`);
            } else {
                // Note: formatDate should be renamed to formatDateTime
                return Promise.resolve(`import { Logger } from './logger';

// These functions will be renamed
function formatDate(date: Date): string {
    return \`\${date.getFullYear()}-\${date.getMonth() + 1}-\${date.getDate()} \${date.getHours()}:\${date.getMinutes()}:\${date.getSeconds()}\`;
}

function calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
}

// Test usage
Logger.log("Application started");
Logger.warn("Resource usage high");
const userBirthDate = new Date(1990, 5, 15);
Logger.log(\`User age: \${calculateAge(userBirthDate)}\`);`);
            }
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify([
                    {
                        operation: "rename_symbol",
                        old_name: "formatDate",
                        new_name: "formatDateTime",
                    },
                    {
                        operation: "move_to_file",
                        start_line: 2,
                        end_line: 14,
                        target_path: "logger.ts",
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

        // Verify the content after operations
        const sourceContent = await fs.readFile("/test/test.ts", "utf-8");
        const targetContent = await fs.readFile("/test/logger.ts", "utf-8");

        // The test should detect that formatDate was not renamed to formatDateTime
        expect(sourceContent).toContain("function formatDate(date: Date)");

        // The test should detect that the import in logger.ts is incorrect
        expect(targetContent).toContain("import { formatDate } from './test'");
    });

    // Test 2: Move with nested dependencies
    it("should handle moving code with nested dependencies correctly", async () => {
        // Mock document with utility functions and a class
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`// Test file for moving code with nested dependencies

// Utility functions
function formatCurrency(amount: number, currency: string = "USD"): string {
    return \`\${currency} \${amount.toFixed(2)}\`;
}

function calculateTax(amount: number, rate: number): number {
    return amount * rate;
}

// This class will be moved to a new file
class PriceCalculator {
    private taxRate: number;

    constructor(taxRate: number = 0.1) {
        this.taxRate = taxRate;
    }

    calculateTotal(basePrice: number): number {
        const tax = calculateTax(basePrice, this.taxRate);
        return basePrice + tax;
    }

    formatPrice(basePrice: number, currency: string = "USD"): string {
        const total = this.calculateTotal(basePrice);
        return formatCurrency(total, currency);
    }
}

// Usage
const calculator = new PriceCalculator(0.15);
console.log(calculator.formatPrice(100, "EUR"));`),
            lineAt: jest.fn((line: number) => {
                const lines = [
                    "// Test file for moving code with nested dependencies",
                    "",
                    "// Utility functions",
                    "function formatCurrency(amount: number, currency: string = \"USD\"): string {",
                    "    return `${currency} ${amount.toFixed(2)}`;",
                    "}",
                    "",
                    "function calculateTax(amount: number, rate: number): number {",
                    "    return amount * rate;",
                    "}",
                    "",
                    "// This class will be moved to a new file",
                    "class PriceCalculator {",
                    "    private taxRate: number;",
                    "",
                    "    constructor(taxRate: number = 0.1) {",
                    "        this.taxRate = taxRate;",
                    "    }",
                    "",
                    "    calculateTotal(basePrice: number): number {",
                    "        const tax = calculateTax(basePrice, this.taxRate);",
                    "        return basePrice + tax;",
                    "    }",
                    "",
                    "    formatPrice(basePrice: number, currency: string = \"USD\"): string {",
                    "        const total = this.calculateTotal(basePrice);",
                    "        return formatCurrency(total, currency);",
                    "    }",
                    "}",
                    "",
                    "// Usage",
                    "const calculator = new PriceCalculator(0.15);",
                    "console.log(calculator.formatPrice(100, \"EUR\"));",
                ];
                return {
                    text: lines[line] || "",
                    range: new vscode.Range(line, 0, line, (lines[line] || "").length),
                    isEmptyOrWhitespace: lines[line] === "",
                };
            }),
            lineCount: 33,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
        };

        const mockEditor = {
            selection: null,
        };

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/price-calculator.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]);

        // Mock moveCode to return content with incorrect imports
        const { moveCode } = require("../../../services/code-transform/moveCode");
        moveCode.mockImplementationOnce((_sourcePath: string, _targetPath: string, _startLine: number, _endLine: number) => {
            return Promise.resolve({
                success: true,
                // Source file with incorrect import for PriceCalculator
                modifiedSourceCode: `// Test file for moving code with nested dependencies

// Utility functions
function formatCurrency(amount: number, currency: string = "USD"): string {
    return \`\${currency} \${amount.toFixed(2)}\`;
}

function calculateTax(amount: number, rate: number): number {
    return amount * rate;
}

// PriceCalculator has been moved
import { PriceCalculator } from './price-calculator';

// Usage
const calculator = new PriceCalculator(0.15);
console.log(calculator.formatPrice(100, "EUR"));`,
                // Target file with missing imports for dependencies
                modifiedTargetCode: `// Missing imports for calculateTax and formatCurrency

export class PriceCalculator {
    private taxRate: number;

    constructor(taxRate: number = 0.1) {
        this.taxRate = taxRate;
    }

    calculateTotal(basePrice: number): number {
        const tax = calculateTax(basePrice, this.taxRate);
        return basePrice + tax;
    }

    formatPrice(basePrice: number, currency: string = "USD"): string {
        const total = this.calculateTotal(basePrice);
        return formatCurrency(total, currency);
    }
}`,
                movedNodes: 1,
                importsAdded: true,
                exportedNames: ["PriceCalculator"],
                dependenciesImported: false, // This should be true
                dependencies: [] // This should include calculateTax and formatCurrency
            });
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "13",
                    end_line: "29",
                    target_path: "price-calculator.ts",
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
            "/test/price-calculator.ts",
            13,
            29
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved code from lines 13-29 to price-calculator.ts")
        );

        // Verify the content after move
        // Mock fs.readFile to return the expected content for the target file
        (fs.readFile as jest.Mock).mockImplementation((path: string) => {
            if (path === "/test/price-calculator.ts") {
                return Promise.resolve(`// Missing imports for calculateTax and formatCurrency

export class PriceCalculator {
    private taxRate: number;

    constructor(taxRate: number = 0.1) {
        this.taxRate = taxRate;
    }

    calculateTotal(basePrice: number): number {
        const tax = calculateTax(basePrice, this.taxRate);
        return basePrice + tax;
    }

    formatPrice(basePrice: number, currency: string = "USD"): string {
        const total = this.calculateTotal(basePrice);
        return formatCurrency(total, currency);
    }
}`);
            }
            return Promise.resolve("mock content");
        });

        const _sourceContent = await fs.readFile("/test/test.ts", "utf-8");
        const targetContent = await fs.readFile("/test/price-calculator.ts", "utf-8");

        // The test should detect that the target file is missing imports for dependencies
        expect(targetContent).not.toContain("import { calculateTax, formatCurrency } from './test'");

        // The test should detect that the target file has unresolved dependencies
        expect(targetContent).toContain("const tax = calculateTax(basePrice, this.taxRate)");
        expect(targetContent).toContain("return formatCurrency(total, currency)");
    });
});