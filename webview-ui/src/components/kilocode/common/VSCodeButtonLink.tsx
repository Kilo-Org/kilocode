import React from "react"
import styled from "styled-components"

interface VSCodeButtonLinkProps {
	href: string
	children: React.ReactNode
	[key: string]: any
}

const StyledButtonLink = styled.a`
	display: block;
	text-decoration: none;
	font-weight: 600;
	font-size: 12px;
	border-radius: 4px;

	/* Theme-specific styles */
	body.vscode-dark & {
		color: #1b1b1b;
		background: #d9d9d9;
	}
	body.vscode-light & {
		color: #d9d9d9;
		background: #1b1b1b;
	}
`

export const VSCodeButtonLink = ({ href, children, ...props }: VSCodeButtonLinkProps) => (
	<StyledButtonLink href={href} className="flex flex-col gap-1 p-2 text-center" {...props}>
		{children}
	</StyledButtonLink>
)
