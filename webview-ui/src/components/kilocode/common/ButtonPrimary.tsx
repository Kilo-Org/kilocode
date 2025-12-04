import { PropsWithChildren } from "react"
import styled from "styled-components"

type ButtonProps = PropsWithChildren<{
	onClick: () => void
}>

const StyledButton = styled.button`
	display: block;
	text-decoration: none;
	font-weight: 600;
	font-size: 12px;
	border-radius: 4px;
	padding: 14px;
	transition: all 0.2s;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	cursor: pointer;

	/* Theme-specific styles */
	body.vscode-dark & {
		background: #f6f6f7;
		color: #1b1b1b;

		&:hover,
		&:focus {
			background-color: #e0e0e0;
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

export const ButtonPrimary = ({ onClick, children }: ButtonProps) => (
	<StyledButton onClick={onClick} className="flex flex-col gap-1 text-center">
		{children}
	</StyledButton>
)
