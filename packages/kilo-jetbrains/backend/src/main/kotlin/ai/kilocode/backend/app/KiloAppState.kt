package ai.kilocode.backend.app

import ai.kilocode.jetbrains.api.model.Config
import ai.kilocode.jetbrains.api.model.KiloNotifications200ResponseInner
import ai.kilocode.jetbrains.api.model.KiloProfile200Response

/**
 * Full application lifecycle state, combining CLI transport connection
 * status with data-loading progress.
 *
 * [ConnectionState] stays internal to [KiloConnectionService] for the
 * transport layer. This sealed class is what the frontend observes.
 */
sealed class KiloAppState {
    data object Disconnected : KiloAppState()
    data object Connecting : KiloAppState()
    data class Loading(val progress: LoadProgress) : KiloAppState()
    data class Ready(val data: AppData) : KiloAppState()
    data class Error(val message: String, val errors: List<LoadError> = emptyList()) : KiloAppState()
}

/**
 * Tracks which global data fetches have completed during the [KiloAppState.Loading] phase.
 */
data class LoadProgress(
    val config: Boolean = false,
    val notifications: Boolean = false,
    val profile: ProfileResult = ProfileResult.PENDING,
)

/** Outcome of the profile fetch. */
enum class ProfileResult { PENDING, LOADED, NOT_LOGGED_IN }

/**
 * Error detail for a single resource that failed to load.
 */
data class LoadError(
    val resource: String,
    val status: Int? = null,
    val detail: String? = null,
)

data class ConfigWarning(
    val path: String,
    val message: String,
    val detail: String? = null,
)

/**
 * All global data that has been successfully loaded.
 * Present only in [KiloAppState.Ready].
 */
data class AppData(
    val profile: KiloProfile200Response?,
    val config: Config,
    val notifications: List<KiloNotifications200ResponseInner>,
    val warnings: List<ConfigWarning> = emptyList(),
)
