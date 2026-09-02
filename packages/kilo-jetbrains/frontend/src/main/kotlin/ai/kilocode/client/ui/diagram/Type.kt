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
    Journey,
    Quadrant,
    Requirement,
    Git,
    C4,
    Mindmap,
    Timeline,
    Sankey,
    XyChart,
    Block,
    Packet,
    Kanban,
    Architecture,
    Radar,
    Treemap,
    Unknown;

    companion object {
        /**
         * Detects the diagram type from preprocessed text, so frontmatter, `%%` comments and
         * `%%{init}%%` directives cannot shift the answer.
         */
        fun of(source: String): Type = of(Source.clean(source))

        fun of(clean: Clean): Type {
            val head = clean.lines.firstOrNull { it.text.isNotBlank() }?.text?.trim() ?: return Unknown
            // `gitGraph LR:` and `gitGraph:` keep a trailing colon on the keyword itself.
            val token = head.takeWhile { !it.isWhitespace() }.trimEnd(':').lowercase()
            return when (token) {
                "graph", "flowchart" -> Flowchart
                "sequencediagram" -> Sequence
                "classdiagram", "classdiagram-v2" -> Class
                "statediagram", "statediagram-v2" -> State
                "erdiagram" -> Er
                "gantt" -> Gantt
                "pie" -> Pie
                "journey" -> Journey
                "quadrantchart" -> Quadrant
                "requirementdiagram" -> Requirement
                "gitgraph" -> Git
                "c4context", "c4container", "c4component", "c4dynamic", "c4deployment" -> C4
                "mindmap" -> Mindmap
                "timeline" -> Timeline
                "sankey-beta", "sankey" -> Sankey
                "xychart-beta", "xychart" -> XyChart
                "block-beta", "block" -> Block
                "packet-beta", "packet" -> Packet
                "kanban" -> Kanban
                "architecture-beta", "architecture" -> Architecture
                "radar-beta", "radar" -> Radar
                "treemap-beta", "treemap" -> Treemap
                else -> Unknown
            }
        }
    }
}
