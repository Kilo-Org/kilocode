import type { ComponentProps } from "solid-js"

export function Table(props: ComponentProps<"table">) {
  return <table {...props} data-slot="table" />
}
export function TableHeader(props: ComponentProps<"thead">) {
  return <thead {...props} data-slot="table-header" />
}
export function TableBody(props: ComponentProps<"tbody">) {
  return <tbody {...props} data-slot="table-body" />
}
export function TableFooter(props: ComponentProps<"tfoot">) {
  return <tfoot {...props} data-slot="table-footer" />
}
export function TableRow(props: ComponentProps<"tr">) {
  return <tr {...props} data-slot="table-row" />
}
export function TableHead(props: ComponentProps<"th">) {
  return <th {...props} data-slot="table-head" />
}
export function TableCell(props: ComponentProps<"td">) {
  return <td {...props} data-slot="table-cell" />
}
export function TableCaption(props: ComponentProps<"caption">) {
  return <caption {...props} data-slot="table-caption" />
}
