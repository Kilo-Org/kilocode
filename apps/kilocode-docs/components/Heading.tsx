import * as React from "react"

export function Heading({ id = "", level = 1, children, className }) {
	return React.createElement(
		`h${level}`,
		{
			id,
			className: ["heading", className].filter(Boolean).join(" "),
		},
		children,
	)
}
