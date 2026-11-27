package ai.kilocode.client.session.history

import ai.kilocode.client.session.SessionActivityKind

internal data class HistoryActivitySnapshot(
    val activity: Map<String, SessionActivityKind> = emptyMap(),
    val titles: Map<String, String> = emptyMap(),
) {
    fun changed(next: HistoryActivitySnapshot): Set<String> =
        (activity.keys + next.activity.keys + titles.keys + next.titles.keys).filterTo(mutableSetOf()) {
            activity[it] != next.activity[it] || titles[it] != next.titles[it]
        }
}
