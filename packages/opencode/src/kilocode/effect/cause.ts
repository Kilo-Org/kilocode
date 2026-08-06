import { Cause } from "effect"

export const isInterrupted = Cause.hasInterruptsOnly

export const shouldReportPromptFailure = (cause: Cause.Cause<unknown>) => !isInterrupted(cause)
