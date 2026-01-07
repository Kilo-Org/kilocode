import React, { useState, useCallback, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Button } from "./button"
import { Badge } from "./badge"
import { Code, Database, FileText, ExternalLink, X } from "lucide-react"

export interface OdooFieldInfo {
	name: string
	type: string
	string?: string
	help?: string
	required?: boolean
	readonly?: boolean
	translate?: boolean
	compute?: string
	related?: string
	domain?: string
	selection?: Array<[string, string]>
	pythonDefinition?: {
		className: string
		fieldName: string
		fieldType: string
		args?: Record<string, any>
		lineNumber: number
		filePath: string
	}
}

export interface OdooModelInfo {
	name: string
	description?: string
	inherits?: string[]
	fields: Record<string, OdooFieldInfo>
	methods?: Array<{
		name: string
		args?: string[]
		returnType?: string
		decorators?: string[]
		pythonDefinition?: {
			className: string
			methodName: string
			lineNumber: number
			filePath: string
		}
	}>
	constraints?: Array<{
		name: string
		definition: string
		pythonDefinition?: {
			className: string
			constraintName: string
			lineNumber: number
			filePath: string
		}
	}>
}

export interface PeekDefinitionProps {
	position: { x: number; y: number }
	target: OdooFieldInfo | OdooModelInfo | any
	type: "field" | "model" | "method" | "constraint"
	onClose: () => void
	onGoToDefinition?: (filePath: string, lineNumber: number) => void
}

export const PeekDefinition: React.FC<PeekDefinitionProps> = ({
	position,
	target,
	type,
	onClose,
	onGoToDefinition,
}) => {
	const peekRef = useRef<HTMLDivElement>(null)

	// Close on click outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (peekRef.current && !peekRef.current.contains(event.target as Node)) {
				onClose()
			}
		}

		document.addEventListener("mousedown", handleClickOutside)
		return () => document.removeEventListener("mousedown", handleClickOutside)
	}, [onClose])

	const renderFieldPeek = (field: OdooFieldInfo) => (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Database className="w-4 h-4 text-blue-500" />
					<h3 className="font-semibold text-vscode-foreground">{field.name}</h3>
					<Badge variant="secondary" className="text-xs">
						{field.type}
					</Badge>
				</div>
				<Button size="sm" variant="ghost" onClick={onClose} className="h-6 w-6 p-0">
					<X className="w-3 h-3" />
				</Button>
			</div>

			{/* Field Properties */}
			<div className="space-y-2 text-sm">
				{field.string && (
					<div>
						<span className="text-vscode-descriptionForeground">Label: </span>
						<span className="text-vscode-foreground">{field.string}</span>
					</div>
				)}

				{field.help && (
					<div>
						<span className="text-vscode-descriptionForeground">Help: </span>
						<span className="text-vscode-foreground">{field.help}</span>
					</div>
				)}

				<div className="flex flex-wrap gap-2">
					{field.required && (
						<Badge variant="destructive" className="text-xs">
							Required
						</Badge>
					)}
					{field.readonly && (
						<Badge variant="secondary" className="text-xs">
							Readonly
						</Badge>
					)}
					{field.translate && (
						<Badge variant="outline" className="text-xs">
							Translatable
						</Badge>
					)}
					{field.compute && (
						<Badge variant="outline" className="text-xs">
							Computed
						</Badge>
					)}
				</div>

				{field.related && (
					<div>
						<span className="text-vscode-descriptionForeground">Related: </span>
						<span className="text-vscode-foreground">{field.related}</span>
					</div>
				)}

				{field.domain && (
					<div>
						<span className="text-vscode-descriptionForeground">Domain: </span>
						<code className="bg-vscode-toolbar-background px-1 py-0.5 rounded text-xs">{field.domain}</code>
					</div>
				)}

				{field.selection && field.selection.length > 0 && (
					<div>
						<span className="text-vscode-descriptionForeground">Selection: </span>
						<div className="mt-1 space-y-1">
							{field.selection.map(([key, value]) => (
								<div key={key} className="flex justify-between gap-4 text-xs">
									<span className="text-vscode-descriptionForeground">{key}:</span>
									<span className="text-vscode-foreground">{value}</span>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Python Definition */}
			{field.pythonDefinition && (
				<div className="border-t border-vscode-border pt-3">
					<div className="flex items-center justify-between mb-2">
						<span className="text-sm font-medium text-vscode-foreground">Python Definition</span>
						{onGoToDefinition && (
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									onGoToDefinition(
										field.pythonDefinition!.filePath,
										field.pythonDefinition!.lineNumber,
									)
								}
								className="text-xs">
								<ExternalLink className="w-3 h-3 mr-1" />
								Go to Source
							</Button>
						)}
					</div>

					<div className="bg-vscode-editor-background border border-vscode-border rounded p-2">
						<code className="text-xs text-vscode-foreground font-mono">
							{field.pythonDefinition.fieldName} = fields.{field.pythonDefinition.fieldType}(
							{field.pythonDefinition.args &&
								Object.entries(field.pythonDefinition.args).map(([key, value]) => (
									<div key={key} className="ml-4">
										{key}={JSON.stringify(value)}
									</div>
								))}
							)
						</code>
					</div>

					<div className="mt-2 text-xs text-vscode-descriptionForeground">
						{field.pythonDefinition.filePath}:{field.pythonDefinition.lineNumber}
					</div>
				</div>
			)}
		</div>
	)

	const renderModelPeek = (model: OdooModelInfo) => (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<FileText className="w-4 h-4 text-green-500" />
					<h3 className="font-semibold text-vscode-foreground">{model.name}</h3>
				</div>
				<Button size="sm" variant="ghost" onClick={onClose} className="h-6 w-6 p-0">
					<X className="w-3 h-3" />
				</Button>
			</div>

			{/* Model Description */}
			{model.description && (
				<div className="text-sm">
					<span className="text-vscode-descriptionForeground">Description: </span>
					<span className="text-vscode-foreground">{model.description}</span>
				</div>
			)}

			{/* Inheritance */}
			{model.inherits && model.inherits.length > 0 && (
				<div>
					<span className="text-sm font-medium text-vscode-foreground">Inherits: </span>
					<div className="flex flex-wrap gap-1 mt-1">
						{model.inherits.map((parent) => (
							<Badge key={parent} variant="outline" className="text-xs">
								{parent}
							</Badge>
						))}
					</div>
				</div>
			)}

			{/* Fields Preview */}
			<div>
				<span className="text-sm font-medium text-vscode-foreground">
					Fields ({Object.keys(model.fields).length}):
				</span>
				<div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
					{Object.entries(model.fields)
						.slice(0, 5)
						.map(([name, field]) => (
							<div key={name} className="flex justify-between items-center gap-2 text-xs">
								<span className="text-vscode-foreground">{name}</span>
								<Badge variant="secondary" className="text-xs">
									{field.type}
								</Badge>
							</div>
						))}
					{Object.keys(model.fields).length > 5 && (
						<div className="text-xs text-vscode-descriptionForeground text-center">
							... and {Object.keys(model.fields).length - 5} more
						</div>
					)}
				</div>
			</div>
		</div>
	)

	const renderMethodPeek = (method: any) => (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Code className="w-4 h-4 text-purple-500" />
					<h3 className="font-semibold text-vscode-foreground">{method.name}</h3>
				</div>
				<Button size="sm" variant="ghost" onClick={onClose} className="h-6 w-6 p-0">
					<X className="w-3 h-3" />
				</Button>
			</div>

			{/* Method Signature */}
			<div className="bg-vscode-editor-background border border-vscode-border rounded p-2">
				<code className="text-xs text-vscode-foreground font-mono">
					def {method.name}({method.args?.join(", ") || "self"})
					{method.returnType && ` -> ${method.returnType}`}
				</code>
			</div>

			{/* Decorators */}
			{method.decorators && method.decorators.length > 0 && (
				<div>
					<span className="text-sm font-medium text-vscode-foreground">Decorators:</span>
					<div className="flex flex-wrap gap-1 mt-1">
						{method.decorators.map((decorator: string) => (
							<Badge key={decorator} variant="outline" className="text-xs">
								@{decorator}
							</Badge>
						))}
					</div>
				</div>
			)}

			{/* Python Definition */}
			{method.pythonDefinition && onGoToDefinition && (
				<div className="border-t border-vscode-border pt-3">
					<Button
						size="sm"
						variant="outline"
						onClick={() =>
							onGoToDefinition(method.pythonDefinition.filePath, method.pythonDefinition.lineNumber)
						}
						className="text-xs">
						<ExternalLink className="w-3 h-3 mr-1" />
						Go to Source
					</Button>
				</div>
			)}
		</div>
	)

	return (
		<motion.div
			ref={peekRef}
			initial={{ opacity: 0, scale: 0.9, y: -10 }}
			animate={{ opacity: 1, scale: 1, y: 0 }}
			exit={{ opacity: 0, scale: 0.9, y: -10 }}
			transition={{ duration: 0.2 }}
			className="fixed z-50 w-96 bg-vscode-toolbar-background border border-vscode-border rounded-lg shadow-lg p-4"
			style={{
				left: `${position.x}px`,
				top: `${position.y}px`,
				maxHeight: "80vh",
				overflowY: "auto",
			}}>
			{type === "field" && renderFieldPeek(target as OdooFieldInfo)}
			{type === "model" && renderModelPeek(target as OdooModelInfo)}
			{type === "method" && renderMethodPeek(target)}
		</motion.div>
	)
}

// Hook for managing peek definitions
export const useOdooPeekDefinitions = () => {
	const [peekState, setPeekState] = useState<{
		visible: boolean
		position: { x: number; y: number }
		target: any
		type: "field" | "model" | "method" | "constraint"
	}>({
		visible: false,
		position: { x: 0, y: 0 },
		target: null,
		type: "field",
	})

	const showPeek = useCallback(
		(position: { x: number; y: number }, target: any, type: "field" | "model" | "method" | "constraint") => {
			setPeekState({
				visible: true,
				position,
				target,
				type,
			})
		},
		[],
	)

	const hidePeek = useCallback(() => {
		setPeekState((prev) => ({ ...prev, visible: false }))
	}, [])

	const PeekComponent = useCallback(() => {
		if (!peekState.visible || !peekState.target) return null

		return (
			<PeekDefinition
				position={peekState.position}
				target={peekState.target}
				type={peekState.type}
				onClose={hidePeek}
			/>
		)
	}, [peekState, hidePeek])

	return {
		showPeek,
		hidePeek,
		PeekComponent,
		isVisible: peekState.visible,
	}
}

// Odoo XML tag hover provider
export const useOdooXMLHover = () => {
	const { showPeek, hidePeek, PeekComponent } = useOdooPeekDefinitions()

	const handleXMLHover = useCallback(
		(event: React.MouseEvent, _xmlTag: string, fieldInfo?: OdooFieldInfo) => {
			if (!fieldInfo) return

			const rect = (event.target as HTMLElement).getBoundingClientRect()
			showPeek({ x: rect.right + 10, y: rect.top }, fieldInfo, "field")
		},
		[showPeek],
	)

	const handleXMLLeave = useCallback(() => {
		hidePeek()
	}, [hidePeek])

	return {
		handleXMLHover,
		handleXMLLeave,
		PeekComponent,
	}
}
