import { HTMLAttributes } from "react"

import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

type SettingsFooterProps = HTMLAttributes<HTMLDivElement> & {
	version: string
}

export const SettingsFooter = ({ version, className, ...props }: SettingsFooterProps) => (
	<div className={cn("text-vscode-descriptionForeground p-5", className)} {...props}>
		<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
			If you have any questions or feedback, feel free to open an issue at{" "}
			<VSCodeLink href="https://github.com/Kilo-Org/kilocode" style={{ display: "inline" }}>
				github.com/Kilo-Org/kilocode
			</VSCodeLink>{" "}
			or join{" "}
			<VSCodeLink href="https://www.reddit.com/r/KiloCode/" style={{ display: "inline" }}>
				reddit.com/r/KiloCode
			</VSCodeLink>
			.
		</p>
		<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
			Regarding financial questions, please contact Customer Service at{" "}
			<VSCodeLink href="mail:hi@kilo.ai" style={{ display: "inline" }}>
				hi@kilo.ai
			</VSCodeLink>{" "}
		</p>
		<p className="italic">Kilo Code v{version}</p>
		<div className="flex justify-between items-center gap-3">
			<p>Reset all global state and secret storage in the extension.</p>
			<VSCodeButton
				onClick={() => vscode.postMessage({ type: "resetState" })}
				appearance="secondary"
				className="shrink-0">
				<span className="codicon codicon-warning text-vscode-errorForeground mr-1" />
				Reset
			</VSCodeButton>
		</div>
	</div>
)
