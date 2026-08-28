package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Clean
import ai.kilocode.client.ui.diagram.mermaid.Source
import kotlinx.serialization.Serializable

@Serializable
internal enum class Type {
    Flowchart,
    Sequence,
    Class,
    State,
    Er,
    Gantt,
    Pie,
    Unknown;

    companion object {
        /**
         * Detects the diagram type from preprocessed text, so frontmatter, `%%` comments and
         * `%%{init}%%` directives cannot shift the answer.
         */
        fun of(source: String): Type = of(Source.clean(source))

        fun of(clean: Clean): Type {
            val head = clean.lines.firstOrNull { it.text.isNotBlank() }?.text?.trim() ?: return Unknown
            val token = head.takeWhile { !it.isWhitespace() }.lowercase()
            return when (token) {
                "graph", "flowchart" -> Flowchart
                "sequencediagram" -> Sequence
                "classdiagram", "classdiagram-v2" -> Class
                "statediagram", "statediagram-v2" -> State
                "erdiagram" -> Er
                "gantt" -> Gantt
                "pie" -> Pie
                else -> Unknown
            }
        }
    }
}
