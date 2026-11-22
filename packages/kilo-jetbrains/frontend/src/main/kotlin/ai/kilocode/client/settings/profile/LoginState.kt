package ai.kilocode.client.settings.profile

import ai.kilocode.rpc.dto.DeviceAuthDto

internal sealed interface LoginState {
    data object Idle : LoginState
    data object Initiating : LoginState
    data class Pending(val auth: DeviceAuthDto, val started: Long) : LoginState

    /**
     * An account step did not finish. [retry] names the action that recovers from it.
     */
    data class Error(val message: String, val retry: Retry = Retry.SIGN_IN) : LoginState

    enum class Retry {
        /** The sign-in itself failed, so retrying starts it again. */
        SIGN_IN,

        /** The sign-in finished and the account read did not, so retrying re-reads the profile. */
        PROFILE,
    }
}
