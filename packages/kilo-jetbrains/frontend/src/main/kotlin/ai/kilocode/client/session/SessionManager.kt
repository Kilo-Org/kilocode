package ai.kilocode.client.session

import ai.kilocode.rpc.dto.SessionDto
import com.intellij.openapi.actionSystem.DataKey

interface SessionManager {
    companion object {
        val KEY = DataKey.create<SessionManager>("ai.kilocode.client.session.SessionManager")
    }

    fun newSession()

    fun openSession(session: SessionDto)
}
