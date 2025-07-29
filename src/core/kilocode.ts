import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

export function reportExcessiveRecursion(functionName: string, recursionDepth: number) {
	if (recursionDepth > 1 && Number.isInteger(Math.log10(recursionDepth))) {
		const memory = { ...process.memoryUsage() }
		const props = { functionName, recursionDepth, memory }
		TelemetryService.instance.captureEvent(TelemetryEventName.EXCESSIVE_RECURSION, props)
		console.warn("Excessive recursion", props)
	}
}

export function yieldPromise() {
	return new Promise<void>((resolve) => setTimeout(() => resolve(), 0))
}
