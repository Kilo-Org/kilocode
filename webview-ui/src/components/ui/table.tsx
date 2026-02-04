import * as React from "react"

import { cn } from "@/lib/utils"

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
	({ className, ...props }, ref) => <table ref={ref} className={cn("w-full text-sm", className)} {...props} />,
)
Table.displayName = "Table"

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
	({ className, ...props }, ref) => <tbody ref={ref} className={cn("", className)} {...props} />,
)
TableBody.displayName = "TableBody"

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
	({ className, ...props }, ref) => <tr ref={ref} className={cn("", className)} {...props} />,
)
TableRow.displayName = "TableRow"

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
	({ className, ...props }, ref) => <td ref={ref} className={cn("py-0.5 pr-3 align-top", className)} {...props} />,
)
TableCell.displayName = "TableCell"

export { Table, TableBody, TableRow, TableCell }
