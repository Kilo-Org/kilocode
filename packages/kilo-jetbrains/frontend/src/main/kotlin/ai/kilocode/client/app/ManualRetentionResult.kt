package ai.kilocode.client.app

import ai.kilocode.rpc.dto.RetentionStatusDto

/** Outcome of a one-off cleanup that must leave the saved retention policy unchanged. */
internal sealed interface ManualRetentionResult {
    /** The cleanup ran and the saved policy is confirmed back in place. */
    data class Complete(val status: RetentionStatusDto) : ManualRetentionResult

    /** The policy could not be switched on, so no cleanup ran and nothing changed. */
    data object NotStarted : ManualRetentionResult

    /** The policy is back in place, but the cleanup call itself reported no result. */
    data object RunFailed : ManualRetentionResult

    /** The cleanup ran, but the saved policy could not be confirmed back in place. */
    data object PolicyNotRestored : ManualRetentionResult
}
