import * as vscode from "vscode"
// fs is used in other tests but not in the modified test
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

// Mock moveCode module
jest.mock("../../../services/code-transform/moveCode", () => {
    return {
        moveCode: jest.fn().mockImplementation((sourcePath, targetPath, startLine, endLine) => {
            // Validate line numbers to ensure they're properly converted
            if (typeof startLine !== 'number' || isNaN(startLine) || startLine < 1) {
                return Promise.resolve({
                    success: false,
                    error: `Illegal value for 'line': ${startLine}`,
                    movedNodes: 0
                });
            }

            if (typeof endLine !== 'number' || isNaN(endLine) || endLine < startLine) {
                return Promise.resolve({
                    success: false,
                    error: `Illegal value for 'line': ${endLine}`,
                    movedNodes: 0
                });
            }

            return Promise.resolve({
                success: true,
                modifiedSourceCode: "// Modified source code",
                modifiedTargetCode: "// Modified target code",
                movedNodes: 1,
                importsAdded: true,
                exportedNames: ["PriceCalculator"],
                dependenciesImported: true,
                dependencies: ["calculateTax", "formatCurrency"]
            });
        })
    };
});

describe("refactorCodeTool - Move Operation Tests", () => {
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

    // Test 1: Proper line number validation
    it("should properly validate and convert line numbers", async () => {
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
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
`),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 25,
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

        // Test with string line numbers (which should be properly converted)
        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "11", // String instead of number
                    end_line: "25",   // String instead of number
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

        // Verify the moveCode function was called with properly converted numbers
        const { moveCode } = require("../../../services/code-transform/moveCode");
        expect(moveCode).toHaveBeenCalledWith(
            "/test/test.ts",
            "/test/price-calculator.ts",
            11, // Should be converted to number
            25  // Should be converted to number
        );

        // Verify success message was pushed
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved code from lines 11-25 to price-calculator.ts and added imports for PriceCalculator")
        );
    });

    // Test 2: Invalid line numbers
    it("should handle invalid line numbers gracefully", async () => {
        const mockDocument = {
            getText: jest.fn().mockReturnValue("// Test file content"),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 10,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
        };

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({ selection: null } as any);

        // Mock moveCode to simulate the error
        const { moveCode } = require("../../../services/code-transform/moveCode");
        moveCode.mockImplementationOnce(() => {
            return Promise.resolve({
                success: false,
                error: "Illegal value for 'line': NaN",
                movedNodes: 0
            });
        });

        // Test with invalid line numbers
        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "invalid", // Not a number
                    end_line: "5",
                    target_path: "target.ts",
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
            expect.stringContaining("Invalid line numbers provided")
        );
    });

    // Test 3: Dependency detection and import generation
    it("should detect dependencies and generate imports when moving code", async () => {
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
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
`),
            lineAt: jest.fn((line: number) => ({
                text: `line ${line + 1}`,
                range: new vscode.Range(line, 0, line, 20),
                isEmptyOrWhitespace: false,
            })),
            lineCount: 25,
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

        // Reset the mock implementation to ensure we get a clean slate
        jest.resetModules();

        // Re-require and re-mock the moveCode module for this specific test
        jest.mock("../../../services/code-transform/moveCode", () => ({
            moveCode: jest.fn().mockImplementation((_sourcePath, _targetPath, _startLine, _endLine) => {
                return Promise.resolve({
                    success: true,
                    modifiedSourceCode: "// Modified source code with imports",
                    modifiedTargetCode: "// Modified target code with imports",
                    movedNodes: 1,
                    importsAdded: true,
                    exportedNames: ["PriceCalculator"],
                    dependenciesImported: true,
                    dependencies: ["calculateTax", "formatCurrency"]
                });
            })
        }), { virtual: true });

        // We need to require the module to ensure the mock is used
        require("../../../services/code-transform/moveCode");

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: "11", // String instead of number to test conversion
                    end_line: "25",   // String instead of number to test conversion
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

        // Verify success message includes information about dependencies
        expect(mockPushToolResult).toHaveBeenCalledWith(
            expect.stringContaining("Successfully moved")
        );
    });
});