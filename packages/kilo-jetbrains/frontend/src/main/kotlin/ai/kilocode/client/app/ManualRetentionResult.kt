package ai.kilocode.client.app

import ai.kilocode.rpc.dto.RetentionStatusDto

/** Outcome of a one-off cleanup that must leave the saved retention policy unchanged. */
internal sealed interface ManualRetentionResult {
    /** The cleanup ran and the saved policy is confirmed back in place. */
    data class Complete(val status: RetentionStatusDto) : ManualRetentionResult

    /** Nothing was switched on and no cleanup ran: the policy write was not accepted. */
    data object NotStarted : ManualRetentionResult

    /** The policy is back in place, but the cleanup call itself reported no result. */
    data object RunFailed : ManualRetentionResult

    /** The cleanup ran, but the saved policy could not be confirmed back in place. */
    data object PolicyNotRestored : ManualRetentionResult

    /** The cleanup never ran, and the saved policy could not be confirmed back in place. */
    data object NotStartedWithPolicyOn : ManualRetentionResult
}
