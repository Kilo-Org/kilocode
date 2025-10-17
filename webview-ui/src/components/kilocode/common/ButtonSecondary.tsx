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
	cursor: pointer;

	/* Theme-specific styles */
	body.vscode-dark & {
		border: 1px solid #9f9ea1;
		background: #8e9196;
		color: #fff;

		&:hover {
			background-color: #7a7e83;
		}

		&:active {
			background-color: #6a6e73;
			transform: scale(0.98);
		}
	}

	body.vscode-light & {
		border: 1px solid #9f9ea1;
		background: #fff;
		color: #8e9196;

		&:active {
			transform: scale(0.98);
		}
	}
`

export const ButtonSecondary = ({ onClick, children }: ButtonProps) => (
	<StyledButton onClick={onClick} className="flex flex-col gap-1 text-center">
		{children}
	</StyledButton>
)
