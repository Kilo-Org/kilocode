package ai.kilocode.client.ui.diagram

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlin.math.roundToInt

@Serializable
internal data class Pt(val x: Double, val y: Double) {
    override fun toString() = "${fmt(x)},${fmt(y)}"
}

@Serializable
internal data class Rect(val x: Double, val y: Double, val w: Double, val h: Double) {
    override fun toString() = "${fmt(x)},${fmt(y)} ${fmt(w)}x${fmt(h)}"
}

@Serializable
internal data class Size(val w: Double, val h: Double) {
    override fun toString() = "${fmt(w)}x${fmt(h)}"
}

internal enum class Role { Surface, Border, Text, Muted, Accent, Note, Cluster, Line }

internal enum class Head { None, Arrow, Open, Cross, Dot, Triangle, Diamond, DiamondFilled, Crow, Bar, CircleOpen }

internal enum class Anchor { TopLeft, Top, TopRight, Left, Center, Right, BottomLeft, Bottom, BottomRight }

@Serializable
internal sealed interface Mark {
    @Serializable
    data class Box(
        val rect: Rect,
        val arc: Double,
        val fill: Role?,
        val line: Role?,
        val dash: Boolean = false,
        val tone: Int? = null,
        val soft: Boolean = false,
    ) : Mark {
        override fun toString() = "box $rect arc=${fmt(arc)} fill=${fill.name()} line=${line.name()} dash=$dash${paint(tone, soft)}"
    }

    @Serializable
    data class Oval(
        val rect: Rect,
        val fill: Role?,
        val line: Role?,
        val tone: Int? = null,
        val soft: Boolean = false,
    ) : Mark {
        override fun toString() = "oval $rect fill=${fill.name()} line=${line.name()}${paint(tone, soft)}"
    }

    @Serializable
    data class Poly(
        val points: List<Pt>,
        val fill: Role?,
        val line: Role?,
        val tone: Int? = null,
        val soft: Boolean = false,
    ) : Mark {
        override fun toString() = "poly ${points.joinToString(" ")} fill=${fill.name()} line=${line.name()}${paint(tone, soft)}"
    }

    /** A filled circle wedge. [start] and [sweep] are degrees in AWT arc space: 0° at 3 o'clock, counterclockwise positive. */
    @Serializable
    data class Sector(
        val at: Pt,
        val r: Double,
        val start: Double,
        val sweep: Double,
        val fill: Role?,
        val line: Role?,
        val tone: Int? = null,
        val soft: Boolean = false,
    ) : Mark {
        override fun toString() =
            "sector at=$at r=${fmt(r)} start=${fmt(start)} sweep=${fmt(sweep)} fill=${fill.name()} line=${line.name()}${paint(tone, soft)}"
    }

    @Serializable
    data class Edge(
        val points: List<Pt>,
        val role: Role,
        val dash: Boolean = false,
        val thick: Boolean = false,
        val head: Head = Head.None,
        val tail: Head = Head.None,
        val tone: Int? = null,
        val soft: Boolean = false,
    ) : Mark {
        override fun toString() =
            "edge ${points.joinToString(" ")} role=$role dash=$dash thick=$thick head=$head tail=$tail${paint(tone, soft)}"
    }

    @Serializable
    data class Text(val text: String, val at: Pt, val anchor: Anchor, val role: Role, val bold: Boolean = false) : Mark {
        override fun toString() = "text ${quote(text)} at=$at anchor=$anchor role=$role bold=$bold"
    }

    @Serializable
    data class Group(val id: String?, val marks: List<Mark>) : Mark {
        override fun toString() = buildString {
            append("group ${id ?: "-"}")
            for (mark in marks) append('\n').append(mark.toString().prependIndent("  "))
        }
    }
}

@Serializable
internal sealed interface Art

@Serializable
internal data class Scene(@SerialName("diagram") val type: Type, val marks: List<Mark>, val size: Size) : Art {
    override fun toString() = buildString {
        append("scene $type $size")
        for (mark in marks) append('\n').append(mark)
    }
}

private fun Role?.name() = this?.name ?: "-"

/** Tone/soft only appear when set so existing snapshots stay byte-stable. */
private fun paint(tone: Int?, soft: Boolean) = buildString {
    if (tone != null) append(" tone=$tone")
    if (soft) append(" soft")
}

internal fun fmt(value: Double): String = value.roundToInt().toString()

private fun quote(value: String) = buildString {
    append('"')
    for (char in value) {
        when (char) {
            '\\' -> append("\\\\")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            else -> append(char)
        }
    }
    append('"')
}
