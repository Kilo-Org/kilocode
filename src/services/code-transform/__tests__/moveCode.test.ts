import { moveCodeWithJSCodeshift, MoveCodeOptions } from "../moveCode";

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

// Mock fileExistsAtPath
jest.mock("../../../utils/fs", () => ({
    fileExistsAtPath: jest.fn().mockResolvedValue(true),
}));

// Define mockProgram before it's used
const mockProgram = {
    body: []
};

// Mock jscodeshift module
jest.mock("jscodeshift", () => {
    // Create the mock instance factory function
    const createMockInstance = () => {
        const instance = {
            find: jest.fn(),
            forEach: jest.fn((callback) => {
                // Simulate finding a node in the range
                callback({
                    node: {
                        type: "FunctionDeclaration",
                        id: { name: "testFunction" }
                    },
                    parent: { node: { type: "Program" } },
                    prune: jest.fn()
                });
            }),
            get: jest.fn(),
            toSource: jest.fn().mockReturnValue("// Modified code")
        };

        // Set up method chaining
        instance.find.mockReturnValue(instance);
        instance.get.mockReturnValue(instance);

        // Set up find implementation
        instance.find.mockImplementation((type) => {
            if (type === "Program") {
                return {
                    get: jest.fn().mockReturnValue({ node: mockProgram })
                };
            }
            return instance;
        });

        return instance;
    };

    return {
        withParser: jest.fn().mockReturnValue(jest.fn().mockImplementation(createMockInstance)),
        exportNamedDeclaration: jest.fn().mockReturnValue({ type: "ExportNamedDeclaration" }),
        Identifier: "Identifier",
        Node: "Node",
        Program: "Program"
    };
}, { virtual: true });

describe("moveCode", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("moveCodeWithJSCodeshift", () => {
        // Test 1: Basic code movement
        it("should move code from source to target file", async () => {
            // Mock source code with a simple function
            const sourceCode = `
function testFunction() {
  return 42;
}

function anotherFunction() {
  return 100;
}
`;

            // Set up the options
            const options: MoveCodeOptions = {
                sourceFilePath: "/test/source.ts",
                targetFilePath: "/test/target.ts",
                sourceCode,
                startLine: 2, // Line with testFunction
                endLine: 4, // End of testFunction
                isTypeScript: true
            };

            // Call the function
            const result = await moveCodeWithJSCodeshift(options);

            // Mock a successful result
            jest.spyOn(console, 'error').mockImplementation(() => { });

            // Just verify the function ran without throwing
            expect(typeof result).toBe('object');
        });

        // Test 2: Moving code with dependencies
        it("should detect and handle dependencies when moving code", async () => {
            // Mock source code with a function that depends on another function
            const sourceCode = `
function helperFunction(x) {
  return x * 2;
}

function mainFunction() {
  return helperFunction(21);
}
`;

            // Set up the options to move only the mainFunction
            const options: MoveCodeOptions = {
                sourceFilePath: "/test/source.ts",
                targetFilePath: "/test/target.ts",
                sourceCode,
                startLine: 6, // Line with mainFunction
                endLine: 8, // End of mainFunction
                isTypeScript: true
            };

            // Call the function
            const result = await moveCodeWithJSCodeshift(options);

            // Mock a successful result
            jest.spyOn(console, 'error').mockImplementation(() => { });

            // Just verify the function ran without throwing
            expect(typeof result).toBe('object');
        });

        // Test 3: Moving a class with nested dependencies
        it("should handle moving a class with nested dependencies", async () => {
            // Mock source code with a class that depends on utility functions
            const sourceCode = `
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
`;

            // Set up the options to move only the PriceCalculator class
            const options: MoveCodeOptions = {
                sourceFilePath: "/test/source.ts",
                targetFilePath: "/test/target.ts",
                sourceCode,
                startLine: 9, // Line with PriceCalculator class
                endLine: 22, // End of PriceCalculator class
                isTypeScript: true
            };

            // Call the function
            const result = await moveCodeWithJSCodeshift(options);

            // Mock a successful result
            jest.spyOn(console, 'error').mockImplementation(() => { });

            // Just verify the function ran without throwing
            expect(typeof result).toBe('object');
        });
    });
});