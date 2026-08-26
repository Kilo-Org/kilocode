package ai.kilocode.client.ui.diagram

import kotlinx.serialization.Serializable

internal interface Engine {
    fun accepts(type: Type): Boolean

    /** Off-EDT, cancellable, no Swing/AWT/IntelliJ types in or out. */
    suspend fun draw(source: String, spec: Spec): Out
}

internal sealed interface Out {
    data class Ok(val art: Art) : Out
    data class Err(val fault: Fault, val message: String, val line: Int? = null) : Out
}

internal enum class Fault { Syntax, Unsupported, Limit, Internal }

@Serializable
internal data class Spec(
    val font: FontSpec,
    val metrics: Metrics = Metrics(),
    val limits: Limits = Limits(),
)

@Serializable
internal data class FontSpec(val family: String, val size: Int, val bold: Boolean = false)

@Serializable
internal data class Metrics(
    val pad: Double = 8.0,
    val gap: Double = 24.0,
    val rank: Double = 48.0,
    val line: Double = 1.0,
    val arc: Double = 4.0,
    val wrap: Double = 0.0,
)

/**
 * Guards against pathological model output. [chars] is checked before any preprocessing so a single
 * enormous line cannot reach the parsers; [nodes] and [edges] are enforced while the model is built
 * rather than after, so `A & B & … --> …` cannot expand into a huge edge list first.
 */
@Serializable
internal data class Limits(
    val nodes: Int = 400,
    val edges: Int = 800,
    val lines: Int = 2_000,
    val chars: Int = 100_000,
)
