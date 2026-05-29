package ai.kilocode.client.migration

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Fake [MigrationUiController] for UI tests.
 *
 * Push state changes by setting [_state].
 * Track calls via [checks], [starts], [skips], [finishes].
 */
class FakeMigrationUiController : MigrationUiController {

    val _state = MutableStateFlow<MigrationUiState>(MigrationUiState.Hidden)
    override val state: StateFlow<MigrationUiState> = _state

    val checks = mutableListOf<Unit>()
    val starts = mutableListOf<MigrationUiSelections>()
    val skips = mutableListOf<Unit>()
    val finishes = mutableListOf<Unit>()

    override fun check() {
        checks.add(Unit)
    }

    override fun start(selections: MigrationUiSelections) {
        starts.add(selections)
    }

    override fun skip() {
        skips.add(Unit)
    }

    override fun finish() {
        finishes.add(Unit)
    }
}
