import styled from "styled-components"

type RetryIconButtonProps = {
	onClick: () => void
}

const StyledButton = styled.button`
	border: 1px solid red;
	cursor: pointer;
	padding: 0;
	border: 0;
	padding: 4px 4px 0;
	border-radius: 4px;

	&:hover {
		background: var(--vscode-button-secondaryBackground);
	}
`

export const RetryIconButton = ({ onClick }: RetryIconButtonProps) => (
	<StyledButton onClick={onClick}>
		<span className="codicon codicon-refresh" />
	</StyledButton>
)
