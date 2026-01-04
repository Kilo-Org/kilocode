// kilocode_change - new file

import type { ErrorContext, RecoveryPlan } from "./self-healing-strategy"

export interface OdooErrorPattern {
	type: OdooErrorType
	pattern: RegExp
	priority: number
	checkFiles: string[]
	recommendedAction: OdooAction
}

export type OdooErrorType =
	| "integrity_error"
	| "access_error"
	| "validation_error"
	| "rpc_error"
	| "database_error"
	| "model_error"
	| "view_error"
	| "workflow_error"

export type OdooAction =
	| "check_access_csv"
	| "check_model_inheritance"
	| "check_view_xml"
	| "check_security_groups"
	| "check_database_schema"
	| "verify_record_exists"
	| "rollback_and_retry"

export interface OdooErrorResult {
	errorType: OdooErrorType
	confidence: number
	filesToCheck: string[]
	suggestedFix: string
	priority: number
}

export interface OdooContext {
	odooRoot?: string
	modelsPath?: string
	viewsPath?: string
	securityPath?: string
	dataPath?: string
}

const ODOO_ERROR_PATTERNS: OdooErrorPattern[] = [
	{
		type: "integrity_error",
		pattern: /IntegrityError|violates foreign key constraint|duplicate key value/i,
		priority: 10,
		checkFiles: ["security/ir.model.access.csv", "models/*"],
		recommendedAction: "check_access_csv",
	},
	{
		type: "access_error",
		pattern: /AccessError|AccessDenied|permission denied|not allowed to operation/i,
		priority: 10,
		checkFiles: ["security/ir.model.access.csv", "security/res_groups.xml"],
		recommendedAction: "check_access_csv",
	},
	{
		type: "validation_error",
		pattern: /ValidationError|Field .* not found|Invalid field/i,
		priority: 9,
		checkFiles: ["models/*", "views/*"],
		recommendedAction: "check_model_inheritance",
	},
	{
		type: "rpc_error",
		pattern: /RPCError|odoo\.exceptions.*UserError|odoo\.exceptions.*Warning/i,
		priority: 8,
		checkFiles: ["models/*", "controllers/*"],
		recommendedAction: "check_model_inheritance",
	},
	{
		type: "database_error",
		pattern: /DatabaseError|psycopg2|relation.*does not exist/i,
		priority: 7,
		checkFiles: [],
		recommendedAction: "check_database_schema",
	},
	{
		type: "model_error",
		pattern: /Model.*does not exist|AttributeError.*has no attribute/i,
		priority: 9,
		checkFiles: ["models/*", "__manifest__.py"],
		recommendedAction: "verify_record_exists",
	},
	{
		type: "view_error",
		pattern: /ViewError|External ID not found|qweb error/i,
		priority: 8,
		checkFiles: ["views/*", "views/*.xml"],
		recommendedAction: "check_view_xml",
	},
	{
		type: "workflow_error",
		pattern: /WorkflowError|WorkFlow exception|activity does not exist/i,
		priority: 6,
		checkFiles: ["models/*", "data/*"],
		recommendedAction: "check_model_inheritance",
	},
]

export class OdooErrorHandler {
	private patterns: OdooErrorPattern[]
	private context: OdooContext

	constructor(context: OdooContext = {}, patterns?: OdooErrorPattern[]) {
		this.patterns = patterns ?? ODOO_ERROR_PATTERNS
		this.context = context
	}

	analyzeError(errorMessage: string): OdooErrorResult | null {
		const matchedPattern = this.patterns
			.filter((p) => p.pattern.test(errorMessage))
			.sort((a, b) => b.priority - a.priority)[0]

		if (!matchedPattern) {
			return null
		}

		return {
			errorType: matchedPattern.type,
			confidence: this.calculateConfidence(errorMessage, matchedPattern),
			filesToCheck: matchedPattern.checkFiles,
			suggestedFix: this.getSuggestedFix(matchedPattern),
			priority: matchedPattern.priority,
		}
	}

	private calculateConfidence(errorMessage: string, pattern: OdooErrorPattern): number {
		// Base confidence on how many pattern keywords match
		const keywords = pattern.pattern.source
			.replace(/[\(\)\[\]\.\*\\]/g, " ")
			.split(/\s+/)
			.filter((k) => k.length > 3)

		const matches = keywords.filter((k) => errorMessage.toLowerCase().includes(k.toLowerCase())).length

		return Math.min(0.5 + (matches / keywords.length) * 0.5, 1)
	}

	private getSuggestedFix(pattern: OdooErrorPattern): string {
		const fixMessages: Record<OdooAction, string> = {
			check_access_csv: "Check ir.model.access.csv for proper record rules and access rights",
			check_model_inheritance: "Verify model inheritance and field definitions in Python files",
			check_view_xml: "Check XML view definitions for proper architeture and field references",
			check_security_groups: "Verify security group assignments in res_groups.xml",
			check_database_schema: "Ensure database tables are created via migrations",
			verify_record_exists: "Verify the record exists before performing operations",
			rollback_and_retry: "Rollback transaction and retry with corrected data",
		}

		return fixMessages[pattern.recommendedAction] ?? "Review Odoo documentation for this error type"
	}

	async createRecoveryPlan(errorContext: ErrorContext): Promise<RecoveryPlan> {
		const errorResult = this.analyzeError(errorContext.errorMessage)

		if (!errorResult) {
			return {
				steps: [],
				escalate: true,
				escalationReason: "Unknown Odoo error pattern",
			}
		}

		const recoveryActions = this.getRecoveryActions(errorResult)

		return {
			steps: recoveryActions,
			escalate: recoveryActions.length === 0,
			escalationReason: `Odoo ${errorResult.errorType} requires manual intervention`,
		}
	}

	private getRecoveryActions(
		errorResult: OdooErrorResult,
	): Array<{ action: string; description: string; searchQuery?: string }> {
		const actions: Array<{ action: string; description: string; searchQuery?: string }> = []

		// Priority-based recovery actions based on error type
		switch (errorResult.errorType) {
			case "integrity_error":
			case "access_error":
				actions.push(
					{
						action: "search_codebase",
						description: "Search for ir.model.access.csv",
						searchQuery: "ir.model.access.csv access rights",
					},
					{
						action: "search_codebase",
						description: "Check security groups XML",
						searchQuery: "res_groups xml security",
					},
				)
				break

			case "validation_error":
			case "model_error":
				actions.push(
					{
						action: "search_codebase",
						description: "Search for model class definition",
						searchQuery: "class Model inheritance Odoo",
					},
					{
						action: "search_codebase",
						description: "Check field definitions",
						searchQuery: "_columns fields Odoo model",
					},
				)
				break

			case "view_error":
				actions.push({
					action: "search_codebase",
					description: "Search for view XML definitions",
					searchQuery: "view.xml arch view Odoo",
				})
				break

			case "rpc_error":
				actions.push({
					action: "search_codebase",
					description: "Search for controller methods",
					searchQuery: "odoo.controllers http route",
				})
				break

			case "database_error":
				actions.push({
					action: "execute_command",
					description: "Check database migrations",
				})
				break
		}

		return actions
	}

	isOdooError(errorMessage: string): boolean {
		return this.patterns.some((p) => p.pattern.test(errorMessage))
	}

	getOdooErrorType(errorMessage: string): OdooErrorType | null {
		const result = this.analyzeError(errorMessage)
		return result?.errorType ?? null
	}

	updateContext(context: Partial<OdooContext>): void {
		this.context = { ...this.context, ...context }
	}

	getFilesToCheck(errorMessage: string): string[] {
		const result = this.analyzeError(errorMessage)
		return result?.filesToCheck ?? []
	}

	// Check if error relates to access control
	isAccessControlError(errorMessage: string): boolean {
		return /access|permission|denied|allowed/i.test(errorMessage)
	}

	// Check if error relates to data integrity
	isIntegrityError(errorMessage: string): boolean {
		return /integrity|foreign key|duplicate|constraint/i.test(errorMessage)
	}

	// Check if error relates to model/view definitions
	isDefinitionError(errorMessage: string): boolean {
		return /field|model|view|attribute|not found/i.test(errorMessage)
	}

	// Get priority for sorting errors
	getErrorPriority(errorMessage: string): number {
		const result = this.analyzeError(errorMessage)
		return result?.priority ?? 0
	}
}
