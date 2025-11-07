import { PropsWithChildren } from "react"
import styled from "styled-components"

type ButtonLinkProps = PropsWithChildren<{
	href: string
	onClick?: () => void
}>

const StyledButtonLink = styled.a`
	display: block;
	text-decoration: none;
	font-weight: 600;
	font-size: 12px;
	border-radius: 12px;
	border: 1px solid var(--vscode-input-border);
	padding: 14px;
	transition: all 0.2s;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

	/* Theme-specific styles */
	body.vscode-dark & {
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);

		&:hover,
		&:focus {
			background-color: color-mix(in srgb, var(--vscode-input-background) 95%, white);
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		}

		&:active {
			background-color: #d3d3d3;
			transform: scale(0.98);
		}
	}

	body.vscode-light & {
		background: #1b1b1b;
		color: #f6f6f7;

		&:hover,
		&:focus {
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		}

		&:active {
			transform: scale(0.98);
		}
	}
`

export const ButtonLink = ({ href, onClick, children }: ButtonLinkProps) => (
	<StyledButtonLink href={href} onClick={onClick} className="flex flex-col gap-1 text-center">
		{children}
	</StyledButtonLink>
)
