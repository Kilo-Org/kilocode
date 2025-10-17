import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export interface StoryTableCellProps<Props> {
	label?: string
	props: Props
}

export interface StoryTableProps<RowProps, ColumnProps> {
	rows?: StoryTableCellProps<RowProps>[]
	columns?: StoryTableCellProps<ColumnProps>[]
	renderCellFn?: (props: ColumnProps & RowProps) => ReactNode
	cellClassName?: string
}

/**
 * StoryTable - A utility component for rendering component variations in a table format
 *
 * Enables comprehensive visual testing by displaying all combinations of component.
 *
 * Example usage:
 * ```tsx
 * const variantRows = buildSimpleTableProps({ variant: ["default", "destructive", "outline"] })
 * const sizeColumns = buildSimpleTableProps({ size: ["sm", "default", "lg"] })
 *
 * <StoryTable
 *   rows={variantRows}
 *   columns={sizeColumns}
 *   renderCellFn={(props) => <Button {...props}>Button</Button>}
 *   cellClassName="p-4"
 * />
 * ```
 */
export function StoryTable<RowProps, ColumnProps>(props: StoryTableProps<RowProps, ColumnProps>) {
	const {
		rows = [{ label: "", props: {} as RowProps }],
		columns = [{ label: "", props: {} as ColumnProps }],
		renderCellFn,
		cellClassName,
	} = props

	const rowsWithDefault = rows.length > 0 ? rows : [{ label: "", props: {} as RowProps }]
	const columnsWithDefault = columns.length > 0 ? columns : [{ label: "", props: {} as ColumnProps }]

	const rowLabelStyle = cn("flex justify-end items-center p-2 min-w-16")
	const colLabelStyle = cn(rowLabelStyle, "justify-start")
	const cellStyle = cn(rowLabelStyle, "justify-center", cellClassName)

	return (
		<table className="mr-auto w-auto border-collapse">
			<thead>
				<tr>
					<th />
					{columnsWithDefault.map((col) => (
						<th key={col.label}>
							<div className={colLabelStyle}>{col.label}</div>
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rowsWithDefault.map((row) => (
					<tr key={row.label}>
						<td>
							<div className={rowLabelStyle}>{row.label}</div>
						</td>

						{columnsWithDefault.map((col) => (
							<td className="align-top" key={col.label}>
								<div className={cellStyle}>{renderCellFn?.({ ...col.props, ...row.props })}</div>
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	)
}
