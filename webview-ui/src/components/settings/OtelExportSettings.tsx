// kilocode_change - new file
import { HTMLAttributes, useCallback } from "react"
import { Activity, Plus, Trash2 } from "lucide-react"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { OtlpExportSettings } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button } from "@/components/ui"

import { SearchableSetting } from "./SearchableSetting"
import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"

type OtelExportSettingsProps = HTMLAttributes<HTMLDivElement> & {
	otlpExportSettings?: OtlpExportSettings
	onOtlpExportSettingsChange: <K extends keyof NonNullable<OtlpExportSettings>>(
		field: K,
		value: NonNullable<OtlpExportSettings>[K],
	) => void
}

export const OtelExportSettings = ({
	otlpExportSettings,
	onOtlpExportSettingsChange,
	...props
}: OtelExportSettingsProps) => {
	const { t } = useAppTranslation()
	const { enabled, tracesEndpoint, logsEndpoint, serviceName, headers } = otlpExportSettings || {}

	const onEnabledChange = useCallback(
		(e: any) => {
			onOtlpExportSettingsChange("enabled", e.target.checked)
		},
		[onOtlpExportSettingsChange],
	)

	const addHeader = useCallback(() => {
		const current = headers || []
		onOtlpExportSettingsChange("headers", [...current, { key: "", value: "" }])
	}, [headers, onOtlpExportSettingsChange])

	const removeHeader = useCallback(
		(index: number) => {
			const current = headers || []
			onOtlpExportSettingsChange(
				"headers",
				current.filter((_, i) => i !== index),
			)
		},
		[headers, onOtlpExportSettingsChange],
	)

	const updateHeader = useCallback(
		(index: number, field: "key" | "value", val: string) => {
			const current = [...(headers || [])]
			current[index] = { ...current[index], [field]: val }
			onOtlpExportSettingsChange("headers", current)
		},
		[headers, onOtlpExportSettingsChange],
	)

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Activity className="w-4" />
					<div>{t("settings:otelExport.sectionTitle")}</div>
				</div>
			</SectionHeader>

			<Section className="flex flex-col gap-5">
				<div className="text-vscode-descriptionForeground text-sm">{t("settings:otelExport.description")}</div>

				<SearchableSetting
					settingId="otel-export-enabled"
					section="otelExport"
					label={t("settings:otelExport.enable.label")}
					className="flex flex-col gap-1">
					<VSCodeCheckbox checked={enabled || false} onChange={onEnabledChange}>
						<span className="font-medium">{t("settings:otelExport.enable.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:otelExport.enable.description")}
					</div>
				</SearchableSetting>

				{enabled && (
					<div className="flex flex-col gap-4 ml-4">
						<SearchableSetting
							settingId="otel-export-traces-endpoint"
							section="otelExport"
							label={t("settings:otelExport.tracesEndpoint.label")}
							className="flex flex-col gap-1">
							<label className="font-medium text-sm">
								{t("settings:otelExport.tracesEndpoint.label")}
							</label>
							<VSCodeTextField
								value={tracesEndpoint || ""}
								placeholder={t("settings:otelExport.tracesEndpoint.placeholder")}
								onInput={(e: any) => onOtlpExportSettingsChange("tracesEndpoint", e.target.value)}
								className="w-full"
							/>
							<div className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:otelExport.tracesEndpoint.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="otel-export-logs-endpoint"
							section="otelExport"
							label={t("settings:otelExport.logsEndpoint.label")}
							className="flex flex-col gap-1">
							<label className="font-medium text-sm">{t("settings:otelExport.logsEndpoint.label")}</label>
							<VSCodeTextField
								value={logsEndpoint || ""}
								placeholder={t("settings:otelExport.logsEndpoint.placeholder")}
								onInput={(e: any) => onOtlpExportSettingsChange("logsEndpoint", e.target.value)}
								className="w-full"
							/>
							<div className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:otelExport.logsEndpoint.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="otel-export-service-name"
							section="otelExport"
							label={t("settings:otelExport.serviceName.label")}
							className="flex flex-col gap-1">
							<label className="font-medium text-sm">{t("settings:otelExport.serviceName.label")}</label>
							<VSCodeTextField
								value={serviceName || ""}
								placeholder={t("settings:otelExport.serviceName.placeholder")}
								onInput={(e: any) => onOtlpExportSettingsChange("serviceName", e.target.value)}
								className="w-full"
							/>
							<div className="text-vscode-descriptionForeground text-xs mt-1">
								{t("settings:otelExport.serviceName.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="otel-export-headers"
							section="otelExport"
							label={t("settings:otelExport.headers.label")}
							className="flex flex-col gap-2">
							<label className="font-medium text-sm">{t("settings:otelExport.headers.label")}</label>
							<div className="text-vscode-descriptionForeground text-xs">
								{t("settings:otelExport.headers.description")}
							</div>

							{(headers || []).map((header, index) => (
								<div key={index} className="flex items-center gap-2">
									<VSCodeTextField
										value={header.key}
										placeholder={t("settings:otelExport.headers.keyPlaceholder")}
										onInput={(e: any) => updateHeader(index, "key", e.target.value)}
										className="flex-1"
									/>
									<VSCodeTextField
										value={header.value}
										placeholder={t("settings:otelExport.headers.valuePlaceholder")}
										type="password"
										onInput={(e: any) => updateHeader(index, "value", e.target.value)}
										className="flex-1"
									/>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => removeHeader(index)}
										className="shrink-0">
										<Trash2 className="w-4 h-4" />
									</Button>
								</div>
							))}

							<Button variant="secondary" size="sm" onClick={addHeader} className="self-start">
								<Plus className="w-3 h-3 mr-1" />
								{t("settings:otelExport.headers.addButton")}
							</Button>
						</SearchableSetting>
					</div>
				)}
			</Section>
		</div>
	)
}
