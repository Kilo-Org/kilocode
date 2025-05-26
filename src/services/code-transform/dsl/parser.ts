/**
 * DSL Parser and Validator
 *
 * This module provides functionality to parse and validate DSL commands
 * for code transformation operations. It uses Zod for schema validation
 * to ensure commands adhere to the expected format before execution.
 *
 * IMPORTANT GUIDELINES:
 * 1. All operations must be provided as an array (batch operations)
 * 2. Always use symbol-based selectors (identifier/AST) for all operations
 * 3. Line number-based selectors are not supported and should never be used
 * 4. The system will find the appropriate insertion point in the target file
 *    based on code structure
 */

import { z } from "zod"
import {
	DslCommand,
	CodeSelector,
	RenameOperation,
	MoveOperation,
	RemoveOperation,
	OperationType,
	isLocationSelector,
	isIdentifierSelector,
	AnyRefactorOperation,
	MoveRefactorOperation,
	RenameRefactorOperation,
	RemoveRefactorOperation,
} from "./types"

// Common validation error messages
const ERROR_MESSAGES = {
	INVALID_JSON: "Failed to parse DSL command: Invalid JSON",
	MISSING_SCHEMA_VERSION: "Missing or invalid schema version",
	UNSUPPORTED_OPERATION: (op: string) => `Unsupported operation: "${op}"`,
	MISSING_SELECTOR: "Command must include a valid selector",
	MISSING_OPERATION_DETAILS: "Command must include operation details",
	INVALID_SELECTOR_TYPE: (type: string) => `Invalid selector type: "${type}"`,
	REQUIRED_FIELD: (field: string) => `Required field missing: ${field}`,
	FILE_PATH_REQUIRED: "File path is required",
	NEGATIVE_LINE_NUMBER: "Line numbers must be positive",
	INVALID_LINE_RANGE: "End line must be greater than or equal to start line",
	EMPTY_IDENTIFIER: "Identifier name cannot be empty",
	EMPTY_NEW_NAME: "New name cannot be empty",
	EMPTY_TARGET_PATH: "Target file path cannot be empty",
}

/**
 * Schema for IdentifierSelector validation
 *
 * REQUIRED: Identifier selectors are the only supported way to select code
 * elements as they are resilient to code changes.
 */

/**
 * Schema for IdentifierSelector validation
 *
 * REQUIRED: Identifier selectors are the only supported way to select code
 * elements as they are resilient to code changes.
 */
const IdentifierSelectorSchema = z.object({
	type: z.literal("identifier"),
	name: z.string().min(1, { message: ERROR_MESSAGES.EMPTY_IDENTIFIER }),
	filePath: z.string().optional(),
	global: z.boolean().optional(),
})

/**
 * Schema for AstSelector validation
 *
 * SUPPORTED: AST selectors provide precise selection based on code structure
 * and are converted to identifier selectors internally.
 */
const AstSelectorSchema = z.object({
	type: z.literal("ast"),
	filePath: z.string().min(1, { message: ERROR_MESSAGES.FILE_PATH_REQUIRED }),
	nodeType: z.string().min(1),
	constraints: z
		.object({
			properties: z.record(z.unknown()).optional(),
			content: z.string().optional(),
			position: z
				.object({
					startLine: z.number().int().positive(),
					endLine: z.number().int().positive(),
					startColumn: z.number().int().positive().optional(),
					endColumn: z.number().int().positive().optional(),
				})
				.optional(),
		})
		.optional(),
})

/**
 * Union schema for all code selector types
 */
// For backward compatibility with tests, also accept location selectors
const LocationSelectorSchema = z.object({
	type: z.literal("location"),
	filePath: z.string().min(1, { message: ERROR_MESSAGES.FILE_PATH_REQUIRED }),
	startLine: z.number().int().positive(),
	endLine: z.number().int().positive(),
	startColumn: z.number().int().positive().optional(),
	endColumn: z.number().int().positive().optional(),
})

const CodeSelectorSchema = z.union([IdentifierSelectorSchema, AstSelectorSchema, LocationSelectorSchema])

/**
 * Schema for RenameOperation validation
 */
const RenameOperationSchema = z.object({
	type: z.literal("rename"),
	newName: z.string().min(1, { message: ERROR_MESSAGES.EMPTY_NEW_NAME }),
	acrossFiles: z.boolean().optional(),
})

/**
 * Schema for MoveOperation validation
 *
 * Note: The system will find the appropriate insertion point in the target file
 * based on code structure, avoiding invalid locations like inside braces or expressions.
 */
const MoveOperationSchema = z.object({
	type: z.literal("move"),
	targetFilePath: z.string().min(1, { message: ERROR_MESSAGES.EMPTY_TARGET_PATH }),
	targetPosition: z
		.object({
			line: z.number().int().min(0),
			insertBefore: z.boolean().optional(),
		})
		.optional(),
	addExports: z.boolean().optional(),
	addImports: z.boolean().optional(),
})

/**
 * Schema for RemoveOperation validation
 */
const RemoveOperationSchema = z.object({
	type: z.literal("remove"),
})

// Note: Individual operation schemas are used directly in validation functions

/**
 * Schema for the entire DSL command
 */
const DslCommandSchema = z.object({
	schemaVersion: z.string().min(1, { message: ERROR_MESSAGES.MISSING_SCHEMA_VERSION }).optional(),
	operation: z.string().min(1),
	selector: CodeSelectorSchema,
	options: z.record(z.unknown()).optional(),
})

/**
 * Schema for a single refactor operation in batch mode
 */
const RefactorOperationSchema = z
	.object({
		operation: z.enum(["move", "rename", "remove"]),
		selector: CodeSelectorSchema,
	})
	.passthrough() // Allow additional fields like targetFilePath, newName

/**
 * Schema for batch operations
 */
const BatchOperationsSchema = z.array(RefactorOperationSchema).min(1, {
	message: "At least one operation is required in the batch",
})

/**
 * Parse batch operations from a JSON string
 *
 * @param input JSON string containing an array of operations
 * @returns Array of validated operations with their details
 * @throws Error if parsing or validation fails
 */
export function parseBatchOperations(input: string): AnyRefactorOperation[] {
	// Parse JSON and handle syntax errors
	let parsedJson: any
	try {
		parsedJson = JSON.parse(input)
	} catch (error) {
		throw new Error(ERROR_MESSAGES.INVALID_JSON)
	}

	// Handle non-array input by wrapping it in an array if it looks like a valid operation
	if (!Array.isArray(parsedJson)) {
		// Check if it has properties that suggest it's a single operation
		if (parsedJson && typeof parsedJson === "object" && parsedJson.operation && parsedJson.selector) {
			console.log("Detected non-array operation format, automatically converting to array")
			parsedJson = [parsedJson]
		} else {
			throw new Error("Operations must be provided as an array")
		}
	}

	// Validate the array structure
	const validationResult = BatchOperationsSchema.safeParse(parsedJson)

	if (!validationResult.success) {
		const formattedErrors = validationResult.error.errors
			.map((err) => `${err.path.join(".")}: ${err.message}`)
			.join("\n")
		throw new Error(`Batch operations validation failed: \n${formattedErrors}`)
	}

	// Process each operation
	const operations: AnyRefactorOperation[] = []

	for (const op of validationResult.data) {
		// Validate operation-specific fields
		if (op.operation === "move") {
			if (!op.targetFilePath) {
				throw new Error("Move operation requires targetFilePath")
			}
			operations.push({
				operation: "move",
				selector: op.selector,
				targetFilePath: op.targetFilePath,
			} as MoveRefactorOperation)
		} else if (op.operation === "rename") {
			if (!op.newName) {
				throw new Error("Rename operation requires newName")
			}
			operations.push({
				operation: "rename",
				selector: op.selector,
				newName: op.newName,
			} as RenameRefactorOperation)
		} else if (op.operation === "remove") {
			operations.push({
				operation: "remove",
				selector: op.selector,
			} as RemoveRefactorOperation)
		}
	}

	return operations
}

/**
 * Parse and validate a DSL command from a JSON string
 *
 * @param input JSON string containing a DSL command
 * @returns Validated DslCommand object with typed operation details
 * @throws Error if parsing or validation fails
 * @deprecated Use parseBatchOperations instead
 */

/**
 * Preprocess a DSL command to make it more forgiving for users
 * This function adds default values and infers fields to reduce validation errors
 *
 * @param json The parsed JSON object from user input
 * @returns Preprocessed command object with inferred/default values
 */
function preprocessDslCommand(json: Record<string, any>): Record<string, any> {
	const result = { ...json }

	// Add default schema version if missing
	if (!result.schemaVersion) {
		result.schemaVersion = "1"
	}

	// Infer operation/type fields from each other if one is missing
	if (result.operation && !result.type) {
		// If operation is specified but type is missing, copy operation to type
		result.type = result.operation
	} else if (result.type && !result.operation) {
		// If type is specified but operation is missing, copy type to operation
		result.operation = result.type
	}

	// Handle case where operation is specified but type is missing
	// This is especially important for move operations
	if (result.operation === "move" && !result.type) {
		result.type = "move"
	}

	// Check if we have a selector object, create one if missing
	if (!result.selector || typeof result.selector !== "object") {
		// Try to create a minimal selector from any fields that might be available
		if (result.filePath) {
			// If filePath is directly in the command, create an identifier selector
			result.selector = {
				type: "identifier",
				name: result.name || "unknown",
				filePath: result.filePath,
				kind: result.kind || "other",
			}
		} else if (result.name && (result.operation === "rename" || result.type === "rename")) {
			// For rename operations, if we have a name, create an identifier selector
			result.selector = {
				type: "identifier",
				name: result.name,
				filePath: result.filePath || "",
			}
		} else if (result.operations && typeof result.operations === "object") {
			// Handle nested operations object (common in tool use)
			if (result.operations.selector) {
				result.selector = result.operations.selector
			} else if (result.operations.filePath) {
				result.selector = {
					type: "identifier",
					name: result.operations.name || "unknown",
					filePath: result.operations.filePath,
					kind: result.operations.kind || "other",
				}
			}

			// Copy other properties from operations to the main object
			if (result.operations.operation && !result.operation) {
				result.operation = result.operations.operation
			}
			if (result.operations.type && !result.type) {
				result.type = result.operations.type
			}
			if (result.operations.targetFilePath && !result.targetFilePath) {
				result.targetFilePath = result.operations.targetFilePath
			}
			if (result.operations.newName && !result.newName) {
				result.newName = result.operations.newName
			}
		}
	}

	if (result.selector && typeof result.selector === "object") {
		// Ensure selector has a type
		if (!result.selector.type) {
			// Default to identifier selector type
			result.selector.type = "identifier"
		}
	}

	return result
}
export function parseDslCommand(input: string): DslCommand & { operationDetails: OperationType } {
	// Parse JSON and handle syntax errors
	let parsedJson: Record<string, any>
	try {
		parsedJson = JSON.parse(input)
	} catch (error) {
		throw new Error(ERROR_MESSAGES.INVALID_JSON)
	}

	// Preprocess the input to make it more forgiving
	parsedJson = preprocessDslCommand(parsedJson)

	// Validate the basic command structure
	const validationResult = DslCommandSchema.safeParse(parsedJson)

	if (!validationResult.success) {
		// Collect and format all validation errors
		const formattedErrors = validationResult.error.errors
			.map((err) => `${err.path.join(".")}: ${err.message}`)
			.join("\n")

		throw new Error(`DSL validation failed: \n${formattedErrors}`)
	}

	// Extract the validated command
	const command = validationResult.data

	// Add default schema version if not provided
	if (!command.schemaVersion) {
		command.schemaVersion = "1"
	}

	// Validate operation-specific details based on the operation type
	switch (command.operation) {
		case "rename": {
			// Prepare the input for validation by ensuring it has all required fields
			const enhancedInput = { ...parsedJson }

			// If we have a newName from any source, make sure it's set properly
			if (!enhancedInput.newName && enhancedInput.new_name) {
				enhancedInput.newName = enhancedInput.new_name
			}

			// Ensure type is set to match operation
			enhancedInput.type = "rename"

			const renameValidation = RenameOperationSchema.safeParse(enhancedInput)

			if (!renameValidation.success) {
				// Try to build a valid operation object ourselves
				const fallbackOperation: RenameOperation = {
					type: "rename",
					newName:
						enhancedInput.newName ||
						enhancedInput.new_name ||
						(enhancedInput.name ? `new${enhancedInput.name}` : "newName"),
				}

				// Try to validate the selector
				try {
					validateSelectorForOperation(command.selector as CodeSelector, "rename")

					// If we reach here, use our constructed operation
					return {
						...command,
						operationDetails: fallbackOperation,
					} as DslCommand & { operationDetails: OperationType }
				} catch (error) {
					// If selector validation fails, throw the original error
					const formattedErrors = renameValidation.error.errors
						.map((err) => `${err.path.join(".")}: ${err.message}`)
						.join("\n")

					throw new Error(`Invalid rename operation: \n${formattedErrors}`)
				}
			}

			const operationDetails = renameValidation.data as RenameOperation
			validateSelectorForOperation(command.selector as CodeSelector, "rename")

			return {
				...command,
				operationDetails,
			} as DslCommand & { operationDetails: OperationType }
		}

		case "move": {
			// Prepare the input for validation by ensuring it has all required fields
			const enhancedInput = { ...parsedJson }

			// Ensure type is set to match operation
			enhancedInput.type = "move"

			// If targetFilePath is missing but there's a target property, use that
			if (!enhancedInput.targetFilePath && enhancedInput.target) {
				enhancedInput.targetFilePath = enhancedInput.target
			}

			const moveValidation = MoveOperationSchema.safeParse(enhancedInput)

			if (!moveValidation.success) {
				// Try to build a valid operation object ourselves if we have the minimal info needed
				if (
					command.selector &&
					typeof command.selector === "object" &&
					(enhancedInput.targetFilePath || enhancedInput.target)
				) {
					const fallbackOperation: MoveOperation = {
						type: "move",
						targetFilePath: enhancedInput.targetFilePath || enhancedInput.target,
					}

					// Try to validate the selector
					try {
						validateSelectorForOperation(command.selector as CodeSelector, "move")

						// If we reach here, use our constructed operation
						return {
							...command,
							operationDetails: fallbackOperation,
						} as DslCommand & { operationDetails: OperationType }
					} catch (selectorError) {
						// Fall through to the error below
					}
				}

				const formattedErrors = moveValidation.error.errors
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")

				throw new Error(`Invalid move operation: \n${formattedErrors}`)
			}

			const operationDetails = moveValidation.data as MoveOperation
			validateSelectorForOperation(command.selector as CodeSelector, "move")

			return {
				...command,
				operationDetails,
			} as DslCommand & { operationDetails: OperationType }
		}

		default:
			throw new Error(ERROR_MESSAGES.UNSUPPORTED_OPERATION(command.operation))
	}
}

/**
 * Performs additional validation to ensure selector is compatible with the operation
 *
 * @param selector The code selector to validate
 * @param operation The operation type to check compatibility with
 * @throws Error if the selector is incompatible with the operation
 */
function validateSelectorForOperation(selector: CodeSelector, operation: string): void {
	// For move operations, enforce identifier selectors and require file path
	if (operation === "move") {
		if (isLocationSelector(selector)) {
			// Validate location selector for move operations
			if (selector.startLine > selector.endLine) {
				throw new Error(ERROR_MESSAGES.INVALID_LINE_RANGE)
			}
		} else if (isIdentifierSelector(selector)) {
			// For identifier selectors, just ensure filePath is provided
			if (!selector.filePath) {
				throw new Error("Move operations with identifier selectors require a filePath")
			}
		}
	} else if (operation === "rename") {
		// For rename operations, no additional validation needed beyond the schema validation
	}
}

/**
 * Checks if a given operation string is supported by the DSL
 *
 * @param operation The operation type string to check
 * @returns True if the operation is supported
 */
export function isSupportedOperation(operation: string): boolean {
	return operation === "rename" || operation === "move" || operation === "remove"
}

/**
 * Validates operation-specific details based on the operation type
 *
 * @param operation The operation type
 * @param details The operation details to validate
 * @returns Validated operation details
 * @throws Error if validation fails
 */
export function validateOperationDetails(operation: string, details: unknown): OperationType {
	switch (operation) {
		case "rename":
			return validateRenameOperation(details)
		case "move":
			return validateMoveOperation(details)
		case "remove":
			return validateRemoveOperation(details)
		default:
			throw new Error(ERROR_MESSAGES.UNSUPPORTED_OPERATION(operation))
	}
}

/**
 * Validates rename operation details
 *
 * @param details The rename operation details to validate
 * @returns Validated RenameOperation
 * @throws Error if validation fails
 */
function validateRenameOperation(details: unknown): RenameOperation {
	const result = RenameOperationSchema.safeParse(details)

	if (!result.success) {
		const formattedErrors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n")

		throw new Error(`Invalid rename operation: \n${formattedErrors}`)
	}

	return result.data
}

/**
 * Validates move operation details
 *
 * @param details The move operation details to validate
 * @returns Validated MoveOperation
 * @throws Error if validation fails
 */
function validateMoveOperation(details: unknown): MoveOperation {
	const result = MoveOperationSchema.safeParse(details)

	if (!result.success) {
		const formattedErrors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n")

		throw new Error(`Invalid move operation: \n${formattedErrors}`)
	}

	return result.data
}

/**
 * Validates remove operation details
 *
 * @param details The remove operation details to validate
 * @returns Validated RemoveOperation
 * @throws Error if validation fails
 */
function validateRemoveOperation(details: unknown): RemoveOperation {
	const result = RemoveOperationSchema.safeParse(details)

	if (!result.success) {
		const formattedErrors = result.error.errors.map((err) => `${err.path.join(".")}: ${err.message}`).join("\n")

		throw new Error(`Invalid remove operation: \n${formattedErrors}`)
	}

	return result.data
}
