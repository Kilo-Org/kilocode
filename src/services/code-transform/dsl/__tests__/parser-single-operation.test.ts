import { parseBatchOperations } from "../parser"
import { AnyRefactorOperation } from "../types"

describe("parseBatchOperations with single operation format", () => {
	it("should handle non-array input (single operation object)", () => {
		const singleOperationJson = `{
      "operation": "rename",
      "selector": {
        "type": "identifier",
        "name": "originalFunctionName",
        "kind": "function",
        "filePath": "refactor_test_source.ts"
      },
      "newName": "batchRenamedFunction"
    }`

		const result = parseBatchOperations(singleOperationJson)

		// Verify that it was converted to an array with one operation
		expect(Array.isArray(result)).toBe(true)
		expect(result.length).toBe(1)

		const op = result[0] as AnyRefactorOperation
		expect(op.operation).toBe("rename")
		expect(op.selector.type).toBe("identifier")
		// Check if selector is an IdentifierSelector before accessing name
		if (op.selector.type === "identifier") {
			expect(op.selector.name).toBe("originalFunctionName")
		}
	})

	it("should still handle array input as before", () => {
		// Multiple operations in array format
		const arrayOperationsJson = `[
      {
        "operation": "rename",
        "selector": {
          "type": "identifier",
          "name": "originalFunctionName",
          "filePath": "refactor_test_source.ts"
        },
        "newName": "batchRenamedFunction"
      },
      {
        "operation": "move",
        "selector": {
          "type": "identifier",
          "name": "OriginalClassName",
          "filePath": "refactor_test_source.ts"
        },
        "targetFilePath": "target_file_one.ts"
      }
    ]`

		const result = parseBatchOperations(arrayOperationsJson)

		expect(Array.isArray(result)).toBe(true)
		expect(result.length).toBe(2)

		expect(result[0].operation).toBe("rename")
		expect(result[1].operation).toBe("move")
	})

	it("should still reject invalid JSON", () => {
		const invalidJson = `{
      "operation": "rename",
      "selector": {
        "type": "identifier",
        "name": "originalFunctionName",
        "filePath": "refactor_test_source.ts"
      },
      "newName": "batchRenamedFunction",
    }` // Invalid due to trailing comma

		expect(() => {
			parseBatchOperations(invalidJson)
		}).toThrow("Failed to parse DSL command: Invalid JSON")
	})

	it("should still reject objects that don't look like operations", () => {
		const notAnOperation = `{
      "foo": "bar",
      "baz": 123
    }`

		expect(() => {
			parseBatchOperations(notAnOperation)
		}).toThrow("Operations must be provided as an array")
	})
})
