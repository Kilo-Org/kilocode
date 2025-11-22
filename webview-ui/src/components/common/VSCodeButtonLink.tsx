import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface VSCodeButtonLinkProps {
	href: string;
	children: React.ReactNode;
	[key: string]: any;
}

export const VSCodeButtonLink = ({ href, children, ...props }: VSCodeButtonLinkProps) => (
	<a
		href={href}
		style={{
			textDecoration: "none",
			color: "inherit",
		}}
	>
		<div
			style={{
				borderRadius: 6,
				overflow: "hidden",     // clip corners
				display: "inline-block", // shrink wrapper correctly
				lineHeight: 0,           // CRUCIAL → makes clipping work
			}}
		>
			<VSCodeButton {...props}>{children}</VSCodeButton>
		</div>
	</a>
);
