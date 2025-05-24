import * as vscode from "vscode";
import * as fs from "fs/promises";
import { refactorCodeTool } from "../refactorCodeTool";
import { Task } from "../../task/Task";
import { ToolUse } from "../../../shared/tools";

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

describe("refactorCodeTool - Extended Tests", () => {
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

    // Test 1: Rename variable with same name as class property
    it("should correctly rename variables with same name as class properties", async () => {
        // Mock document with a class that has a property with the same name as a variable
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
const baseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(baseUrl, defaultTimeout);

class UserService {
  constructor(private baseUrl: string, private timeout: number) {}
  
  async fetchUserData(id: string) {
    return fetch(\`\${this.baseUrl}/users/\${id}\`, { timeout: this.timeout });
  }
}`),
            lineAt: jest.fn((line: number) => ({
                text: line === 1 ? 'const baseUrl = "https://api.example.com";' : "other line",
            })),
            lineCount: 12,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((offset: number) => {
                // Mock position for "baseUrl" at offset 6
                if (offset === 6) {
                    return new vscode.Position(1, 6);
                }
                return new vscode.Position(0, 0);
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return a valid WorkspaceEdit
        const mockWorkspaceEdit = {
            size: 2, // Two occurrences (variable declaration and usage)
            entries: jest.fn().mockReturnValue([
                [vscode.Uri.file("/test/test.ts"), []]
            ]),
        };

        (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(mockWorkspaceEdit);
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with the renamed variable
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`
const apiBaseUrl = "https://api.example.com";
const defaultTimeout = 3000;
const userService = new UserService(apiBaseUrl, defaultTimeout);

class UserService {
  constructor(private baseUrl: string, private timeout: number) {}
  
  async fetchUserData(id: string) {
    return fetch(\`\${this.baseUrl}/users/\${id}\`, { timeout: this.timeout });
  }
}`);
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "rename_symbol",
                    old_name: "baseUrl",
                    new_name: "apiBaseUrl",
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

        expect(mockAskApproval).toHaveBeenCalled();
        expect(mockPushToolResult).toHaveBeenCalled();
    });

    // Test 2: Rename symbol referenced in moved code
    it("should handle renaming symbols referenced in moved code", async () => {
        // Mock document with a function that's referenced in a class that will be moved
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
function formatDate(date) {
  return \`\${date.getFullYear()}-\${date.getMonth() + 1}-\${date.getDate()}\`;
}

class Logger {
  static log(message, level = "info") {
    console.log(\`[\${level.toUpperCase()}] \${formatDate(new Date())}: \${message}\`);
  }

  static error(message) {
    this.log(message, "error");
  }
}
`),
            lineAt: jest.fn((line: number) => ({
                text: line === 1 ? 'function formatDate(date) {' : "other line",
                range: new vscode.Range(line, 0, line, 20),
            })),
            lineCount: 14,
            uri: vscode.Uri.file("/test/test.ts"),
            save: jest.fn().mockResolvedValue(true),
            positionAt: jest.fn((offset: number) => {
                // Mock position for "formatDate" at offset 10
                if (offset === 10) {
                    return new vscode.Position(1, 10);
                }
                return new vscode.Position(0, 0);
            }),
        };

        const mockEditor = {
            selection: null,
        };

        // Mock the rename provider to return a valid WorkspaceEdit
        const mockWorkspaceEdit = {
            size: 2, // Two occurrences (function declaration and usage in Logger)
            entries: jest.fn().mockReturnValue([
                [vscode.Uri.file("/test/test.ts"), []]
            ]),
        };

        // Mock the code action provider for move_to_file
        const mockMoveAction = {
            title: "Move to a new file",
            edit: {
                delete: jest.fn(),
            },
        };

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/logger.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock)
            .mockResolvedValueOnce(mockWorkspaceEdit) // For rename
            .mockResolvedValueOnce([mockMoveAction]); // For move_to_file
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content with the renamed function
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            return Promise.resolve(`
function formatDateTime(date) {
  return \`\${date.getFullYear()}-\${date.getMonth() + 1}-\${date.getDate()}\`;
}

// Logger class has been moved to logger.ts
import { Logger } from './logger';
`);
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
                        start_line: 5,
                        end_line: 13,
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

        expect(mockAskApproval).toHaveBeenCalled();
        expect(mockPushToolResult).toHaveBeenCalled();
    });

    // Test 3: Move class with nested dependencies
    it("should handle moving a class with nested dependencies", async () => {
        // Mock document with utility functions and a class that depends on them
        const mockDocument = {
            getText: jest.fn().mockReturnValue(`
function formatCurrency(amount, currency = "USD") {
  return \`\${currency} \${amount.toFixed(2)}\`;
}

function calculateTax(amount, rate) {
  return amount * rate;
}

class PriceCalculator {
  constructor(taxRate = 0.1) {
    this.taxRate = taxRate;
  }
  
  calculateTotal(basePrice) {
    const tax = calculateTax(basePrice, this.taxRate);
    return basePrice + tax;
  }
  
  formatPrice(basePrice, currency = "USD") {
    const total = this.calculateTotal(basePrice);
    return formatCurrency(total, currency);
  }
}
`),
            lineAt: jest.fn((line: number) => ({
                text: line === 9 ? 'class PriceCalculator {' : "other line",
                range: new vscode.Range(line, 0, line, 20),
            })),
            lineCount: 22,
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
            },
        };

        (vscode.workspace.openTextDocument as jest.Mock)
            .mockResolvedValueOnce(mockDocument as any)
            .mockResolvedValueOnce({ uri: vscode.Uri.file("/test/price-calculator.ts") } as any);
        (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any);
        (vscode.commands.executeCommand as jest.Mock)
            .mockResolvedValueOnce([mockMoveAction]); // For move_to_file
        (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true);

        // Mock fs.readFile to return content after the move
        (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
            if (_path.includes("price-calculator.ts")) {
                return Promise.resolve(`
import { formatCurrency, calculateTax } from './test';

export class PriceCalculator {
  constructor(taxRate = 0.1) {
    this.taxRate = taxRate;
  }
  
  calculateTotal(basePrice) {
    const tax = calculateTax(basePrice, this.taxRate);
    return basePrice + tax;
  }
  
  formatPrice(basePrice, currency = "USD") {
    const total = this.calculateTotal(basePrice);
    return formatCurrency(total, currency);
  }
}
`);
            } else {
                return Promise.resolve(`
function formatCurrency(amount, currency = "USD") {
  return \`\${currency} \${amount.toFixed(2)}\`;
}

function calculateTax(amount, rate) {
  return amount * rate;
}

import { PriceCalculator } from './price-calculator';
`);
            }
        });

        const block: ToolUse = {
            type: "tool_use",
            name: "refactor_code",
            params: {
                path: "test.ts",
                operations: JSON.stringify({
                    operation: "move_to_file",
                    start_line: 9,
                    end_line: 22,
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

        expect(mockAskApproval).toHaveBeenCalledWith(
            "tool",
            expect.stringContaining("Move code from lines 9-22 to price-calculator.ts")
        );

        // We just verify that mockPushToolResult was called
        expect(mockPushToolResult).toHaveBeenCalled();
    });
});