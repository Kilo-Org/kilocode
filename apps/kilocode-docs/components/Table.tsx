import React from "react"

interface TableProps {
	children: React.ReactNode
}

export function Table({ children }: TableProps) {
	return (
		<div className="overflow-x-auto my-6 border border-neutral-300 dark:border-neutral-700 rounded-lg">
			<table className="w-full border-collapse text-sm">{children}</table>
		</div>
	)
}

interface THeadProps {
	children: React.ReactNode
}

export function THead({ children }: THeadProps) {
	return <thead className="bg-neutral-100 dark:bg-neutral-800/50">{children}</thead>
}

interface TBodyProps {
	children: React.ReactNode
}

export function TBody({ children }: TBodyProps) {
	return <tbody className="bg-white dark:bg-neutral-900/50">{children}</tbody>
}

interface TrProps {
	children: React.ReactNode
}

export function Tr({ children }: TrProps) {
	return <tr className="border-b border-neutral-300 dark:border-neutral-700 last:border-b-0">{children}</tr>
}

interface ThProps {
	children: React.ReactNode
	width?: string
}

export function Th({ children, width }: ThProps) {
	return (
		<th
			className="px-4 py-2.5 text-left text-sm font-medium text-neutral-700 dark:text-neutral-300"
			style={{ width }}>
			{children}
		</th>
	)
}

interface TdProps {
	children: React.ReactNode
	colspan?: number
	rowspan?: number
}

export function Td({ children, colspan, rowspan }: TdProps) {
	return (
		<td className="px-4 py-3 text-neutral-600 dark:text-neutral-400" colSpan={colspan} rowSpan={rowspan}>
			{children}
		</td>
	)
}
