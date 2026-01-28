import { nodes } from "@markdoc/markdoc"
import { Table, THead, TBody, Tr, Th, Td } from "../../components/Table"

export const table = {
	...nodes.table,
	render: Table,
}

export const thead = {
	...nodes.thead,
	render: THead,
}

export const tbody = {
	...nodes.tbody,
	render: TBody,
}

export const tr = {
	...nodes.tr,
	render: Tr,
}

export const th = {
	...nodes.th,
	render: Th,
	attributes: {
		...nodes.th.attributes,
		width: { type: String },
	},
}

export const td = {
	...nodes.td,
	render: Td,
	attributes: {
		...nodes.td.attributes,
		colspan: { type: Number },
		rowspan: { type: Number },
	},
}
