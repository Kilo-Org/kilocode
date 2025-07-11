// kilocode_change - new file
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Trans, useTranslation } from "react-i18next"
import { vscode } from "@/utils/vscode"

interface MaxRequestsInputProps {
	allowedMaxRequests?: number | undefined
	onValueChange: (value: number | undefined) => void
	variant?: "menu" | "settings"
	className?: string
	style?: React.CSSProperties
	testId?: string
}

export function MaxRequestsInput({
	allowedMaxRequests,
	onValueChange,
	variant = "settings",
	className,
	style,
	testId,
}: MaxRequestsInputProps) {
	const { t } = useTranslation()

	const handleInput = (e: any) => {
		const input = e.target as HTMLInputElement
		input.value = input.value.replace(/[^0-9]/g, "")
		const value = parseInt(input.value)
		const parsedValue = !isNaN(value) && value > 0 ? value : undefined
		onValueChange(parsedValue)
		vscode.postMessage({ type: "allowedMaxRequests", value: parsedValue })
	}

	const inputValue = (allowedMaxRequests ?? Infinity) === Infinity ? "" : allowedMaxRequests?.toString()

	if (variant === "menu") {
		return (
			<>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						marginTop: "10px",
						marginBottom: "8px",
						color: "var(--vscode-descriptionForeground)",
						...style,
					}}
					className={className}>
					<span style={{ flexShrink: 1, minWidth: 0 }}>
						<Trans i18nKey="settings:autoApprove.apiRequestLimit.title" />:
					</span>
					<VSCodeTextField
						placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
						value={inputValue}
						onInput={handleInput}
						style={{ flex: 1 }}
						data-testid={testId}
					/>
				</div>
				<div
					style={{
						color: "var(--vscode-descriptionForeground)",
						fontSize: "12px",
						marginBottom: "10px",
					}}>
					<Trans i18nKey="settings:autoApprove.apiRequestLimit.description" />
				</div>
			</>
		)
	}

	return (
		<div
			className={`flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background ${className || ""}`}
			style={style}>
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-pulse" />
				<div>{t("settings:autoApprove.apiRequestLimit.title")}</div>
			</div>
			<div className="flex items-center gap-2">
				<VSCodeTextField
					placeholder={t("settings:autoApprove.apiRequestLimit.unlimited")}
					value={inputValue}
					onInput={handleInput}
					style={{ flex: 1, maxWidth: "200px" }}
					data-testid={testId || "max-requests-input"}
				/>
			</div>
			<div className="text-vscode-descriptionForeground text-sm">
				{t("settings:autoApprove.apiRequestLimit.description")}
			</div>
		</div>
	)
}
