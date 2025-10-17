// kilocode_change file added
import styled from "styled-components"

export const MermaidFixButton = styled.button`
	padding: 3px;
	height: 24px;
	margin-right: 4px;
	color: var(--vscode-editor-foreground);
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	border: none;
	cursor: pointer;

	&:hover {
		opacity: 0.8;
		color: var(--vscode-button-foreground);
		background: var(--vscode-button-hoverBackground);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.codicon-loading {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
`
