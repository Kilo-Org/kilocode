import { ChatCompletionChunk } from "openai/resources/index.mjs"
import { t } from "../../../i18n"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName } from "@roo-code/types"

export function throwMaxCompletionTokensReachedError() {
	TelemetryService.instance.captureEvent(TelemetryEventName.MAX_COMPLETION_TOKENS_REACHED_ERROR)
	throw Error(t("kilocode:task.maxCompletionTokens"))
}

export function throwRequestBlockedByContentFilterError() {
	TelemetryService.instance.captureEvent(TelemetryEventName.BLOCKED_BY_CONTENT_FILTER_ERROR)
	throw Error(t("kilocode:task.contentFilter"))
}

export function verifyFinishReason(choice: ChatCompletionChunk.Choice | undefined) {
	if (choice?.finish_reason === "length") {
		throwMaxCompletionTokensReachedError()
	}
	if (choice?.finish_reason === "content_filter") {
		throwRequestBlockedByContentFilterError()
	}
}
