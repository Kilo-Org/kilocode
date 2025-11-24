import React from "react"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReportBugPreviewProps {
	data: string
}

const ReportBugPreview: React.FC<ReportBugPreviewProps> = ({ data }) => {
	// Parse the JSON data from the context string
	const bugData = React.useMemo(() => {
		try {
			return JSON.parse(data || "{}")
		} catch (e) {
			console.error("Failed to parse bug report data", e)
			return {}
		}
	}, [data])

	return (
		<div className="bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] rounded-[3px] p-[14px]">
			<h3 className="font-bold text-base mb-3 mt-0">{bugData.title || "Bug Report"}</h3>

			<div className="space-y-3 text-sm">
				{bugData.description && (
					<div>
						<div className="font-semibold">What Happened?</div>
						<MarkdownBlock markdown={bugData.description} />
					</div>
				)}
				{bugData.provider_and_model && (
					<div>
						<div className="font-semibold">Provider/Model</div>
						<MarkdownBlock markdown={bugData.provider_and_model} />
					</div>
				)}

				{bugData.operating_system && (
					<div>
						<div className="font-semibold">Operating System</div>
						<MarkdownBlock markdown={bugData.operating_system} />
					</div>
				)}

				{bugData.system_info && (
					<div>
						<div className="font-semibold">System Info</div>
						<MarkdownBlock markdown={bugData.system_info} />
					</div>
				)}

				{bugData.kilocode_version && (
					<div>
						<div className="font-semibold">Kilo Code Version</div>
						<MarkdownBlock markdown={bugData.kilocode_version} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ReportBugPreview
