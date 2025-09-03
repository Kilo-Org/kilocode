import { ChatCompletionChunk } from "openai/resources/index.mjs"
import { t } from "../../../i18n"

export function throwMaxCompletionTokensReachedError() {
	throw Error(t("kilocode:task.maxCompletionTokens"))
}

export function verifyFinishReason(choice: ChatCompletionChunk.Choice | undefined) {
	if (choice?.finish_reason === "length") {
		throwMaxCompletionTokensReachedError()
	}
}
