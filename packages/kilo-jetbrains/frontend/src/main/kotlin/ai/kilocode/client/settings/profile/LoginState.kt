package ai.kilocode.client.settings.profile

import ai.kilocode.rpc.dto.DeviceAuthDto

internal sealed interface LoginState {
    data object Idle : LoginState
    data object Initiating : LoginState
    data class Pending(val auth: DeviceAuthDto, val started: Long) : LoginState
    data class Error(val message: String) : LoginState
}
