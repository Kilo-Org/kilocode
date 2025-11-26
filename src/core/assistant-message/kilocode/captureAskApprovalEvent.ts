import { TelemetryEventName, ToolName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

export function captureAskApproval(tool: ToolName, isApproved: boolean) {
	TelemetryService.instance.captureEvent(TelemetryEventName.ASK_APPROVAL, { tool, isApproved })
}
