package ai.kilocode.client.session

import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.actionSystem.DataKey

interface SessionManager {
    companion object {
        val KEY = DataKey.create<SessionManager>("ai.kilocode.client.session.SessionManager")
    }

    fun newSession()

    fun showHistory()

    fun openSession(ref: SessionRef)

    fun activity(): Map<String, SessionActivityKind> = emptyMap()

    fun titles(): Map<String, String> = emptyMap()

    fun costs(): Map<String, Double> = emptyMap()

    fun activityChanged() {}

    fun openSession(session: SessionDto) {
        openSession(SessionRef.Local(session))
    }
}
