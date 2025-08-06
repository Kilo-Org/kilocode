import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Webhook } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"

import { SetCachedStateField } from "./types"

type TerminalCommandGeneratorSettingsProps = HTMLAttributes<HTMLDivElement> & {
	terminalCommandApiConfigId?: string
	setCachedStateField: SetCachedStateField<"terminalCommandApiConfigId">
}

export const TerminalCommandGeneratorSettings = ({
	terminalCommandApiConfigId,
	setCachedStateField,
	className,
	...props
}: TerminalCommandGeneratorSettingsProps) => {
	const { t } = useAppTranslation()
	const { listApiConfigMeta } = useExtensionState()

	return (
		<div className={cn("flex flex-col gap-3", className)} {...props}>
			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2 font-bold">
					<Webhook className="w-4" />
					<div>{t("kilocode:settings.terminal.commandGenerator.provider")}</div>
				</div>
			</div>
			<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
				<div>
					<label className="block font-medium mb-1">
						{t("kilocode:settings.terminal.commandGenerator.apiConfigId.label")}
					</label>
					<div className="flex items-center gap-2">
						<div>
							<Select
								value={terminalCommandApiConfigId || "-"}
								onValueChange={(value) =>
									setCachedStateField("terminalCommandApiConfigId", value === "-" ? "" : value)
								}>
								<SelectTrigger data-testid="terminal-command-api-config-select" className="w-full">
									<SelectValue
										placeholder={t(
											"kilocode:settings.terminal.commandGenerator.apiConfigId.current",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="-">
										{t("kilocode:settings.terminal.commandGenerator.apiConfigId.current")}
									</SelectItem>
									{(listApiConfigMeta || []).map((config) => (
										<SelectItem
											key={config.id}
											value={config.id}
											data-testid={`terminal-command-${config.id}-option`}>
											{config.name} ({config.apiProvider})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="text-sm text-vscode-descriptionForeground mt-1">
								{t("kilocode:settings.terminal.commandGenerator.apiConfigId.description")}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
