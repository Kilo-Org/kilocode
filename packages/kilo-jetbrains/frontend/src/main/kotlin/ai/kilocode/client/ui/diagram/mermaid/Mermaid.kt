package ai.kilocode.client.ui.diagram.mermaid

import ai.kilocode.client.ui.diagram.Engine
import ai.kilocode.client.ui.diagram.Fault
import ai.kilocode.client.ui.diagram.Measure
import ai.kilocode.client.ui.diagram.Out
import ai.kilocode.client.ui.diagram.Spec
import ai.kilocode.client.ui.diagram.Type
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.ensureActive

/**
 * In-process mermaid engine covering flowcharts and sequence diagrams.
 *
 * [Measure] is a construction-time capability rather than part of [Spec] so an out-of-process engine
 * can implement the same interface while doing its own text measurement.
 */
internal class Mermaid(private val measure: Measure) : Engine {
    override fun accepts(type: Type) = type == Type.Flowchart || type == Type.Sequence

    override suspend fun draw(source: String, spec: Spec): Out {
        if (source.length > spec.limits.chars) {
            return Out.Err(Fault.Limit, "source exceeds ${spec.limits.chars} characters")
        }
        coroutineContext.ensureActive()
        val clean = Source.clean(source)
        if (clean.lines.size > spec.limits.lines) {
            return Out.Err(Fault.Limit, "source exceeds ${spec.limits.lines} lines")
        }
        // Cancellation is only checked between lines, so one line is also the unit of uninterruptible
        // work and needs its own cap rather than relying on the whole-source character limit.
        if (clean.lines.any { it.text.length > spec.limits.span }) {
            return Out.Err(Fault.Limit, "a line exceeds ${spec.limits.span} characters")
        }
        val type = Type.of(clean)
        if (!accepts(type)) return Out.Err(Fault.Unsupported, "unsupported diagram type: $type")
        if (type == Type.Flowchart) return flow(clean, spec)
        return seq(clean, spec)
    }

    private suspend fun flow(clean: Clean, spec: Spec): Out {
        val parsed = Flow(spec.limits).parse(clean)
        if (parsed is FlowOut.Over) return Out.Err(Fault.Limit, parsed.message)
        if (parsed is FlowOut.Err) return Out.Err(Fault.Syntax, parsed.message, parsed.line)
        val graph = (parsed as FlowOut.Ok).graph
        if (graph.nodes.isEmpty()) return Out.Err(Fault.Syntax, "flowchart has no nodes")
        val placed = FlowLayout(measure, spec).run(graph)
        return Out.Ok(FlowMarks(measure, spec).run(placed))
    }

    private suspend fun seq(clean: Clean, spec: Spec): Out {
        val parsed = Seq(spec.limits).parse(clean)
        if (parsed is SeqOut.Over) return Out.Err(Fault.Limit, parsed.message)
        if (parsed is SeqOut.Err) return Out.Err(Fault.Syntax, parsed.message, parsed.line)
        val script = (parsed as SeqOut.Ok).script
        if (script.actors.isEmpty()) return Out.Err(Fault.Syntax, "sequence diagram has no participants")
        return Out.Ok(SeqLayout(measure, spec).run(script))
    }
}
