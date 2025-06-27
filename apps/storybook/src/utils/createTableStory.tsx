import React from "react"
import { StoryTable } from "./StoryTable"

/**
 * Creates a story object that makes rendering a matrix of properties quick and easy
 *
 * The rows and columns are properly typed based on the component's props, ensuring type safety.
 *
 * Example usage:
 * ```tsx
 * export const Variants = createTableStory({
 *   component: Button,
 *   rows: { variant: ["default", "destructive", "outline"] },
 *   columns: { size: ["sm", "default", "lg"] },
 *   defaultProps: { children: "Button", onClick: fn() }
 * })
 * ```
 */
export function createTableStory<T extends Record<string, any>>(props: {
	component: React.ComponentType<T>
	rows?: {
		[K in keyof T]?: readonly T[K][]
	}
	columns?: {
		[K in keyof T]?: readonly T[K][]
	}
	defaultProps?: Partial<T>
	cellClassName?: string
	storyParameters?: Record<string, any>
}) {
	const {
		component: Component,
		rows = {},
		columns = {},
		defaultProps = {} as Partial<T>,
		cellClassName,
		storyParameters,
	} = props

	const rowProps = buildLabledProps(rows as Record<string, readonly any[]>)
	const columnProps = buildLabledProps(columns as Record<string, readonly any[]>)

	// If no rows or columns specified, create a simple single-cell table
	const finalRows = rowProps.length > 0 ? rowProps : [{ label: "", props: {} }]
	const finalColumns = columnProps.length > 0 ? columnProps : [{ label: "", props: {} }]

	return {
		render: () => (
			<StoryTable
				rows={finalRows}
				columns={finalColumns}
				renderCellFn={(props) => <Component {...({ ...defaultProps, ...props } as T)} />}
				cellClassName={cellClassName}
			/>
		),
		parameters: storyParameters,
	}
}

function buildLabledProps<T = string>(props: Record<string, readonly T[]>) {
	return Object.keys(props)
		.map((propName) => {
			const propValues = props[propName]
			return propValues.map((option) => ({
				label: `${propName} = ${String(option)}`,
				props: { [propName]: option },
			}))
		})
		.flat()
}
