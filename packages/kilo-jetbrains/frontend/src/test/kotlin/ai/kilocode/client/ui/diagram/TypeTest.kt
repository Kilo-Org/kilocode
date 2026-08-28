package ai.kilocode.client.ui.diagram

import kotlin.test.Test
import kotlin.test.assertEquals

class TypeTest {
    @Test
    fun `detects flowchart aliases and directions`() {
        assertEquals(Type.Flowchart, Type.of("graph TD\n A --> B"))
        assertEquals(Type.Flowchart, Type.of("flowchart LR\n A --> B"))
        assertEquals(Type.Flowchart, Type.of("flowchart\n A --> B"))
    }

    @Test
    fun `detects sequence diagrams regardless of case`() {
        assertEquals(Type.Sequence, Type.of("sequenceDiagram\n A->>B: hi"))
        assertEquals(Type.Sequence, Type.of("SEQUENCEDIAGRAM\n A->>B: hi"))
    }

    @Test
    fun `ignores blank lines, comments, frontmatter and directives`() {
        assertEquals(Type.Flowchart, Type.of("\n\n   \ngraph TD\n A --> B"))
        assertEquals(Type.Flowchart, Type.of("%% a comment\ngraph TD\n A --> B"))
        assertEquals(Type.Sequence, Type.of("---\ntitle: x\n---\nsequenceDiagram\n A->>B: hi"))
        assertEquals(Type.Sequence, Type.of("%%{init: {'theme':'dark'}}%%\nsequenceDiagram\n A->>B: hi"))
    }

    @Test
    fun `maps other known diagram keywords`() {
        assertEquals(Type.Class, Type.of("classDiagram\n class A"))
        assertEquals(Type.State, Type.of("stateDiagram-v2\n [*] --> A"))
        assertEquals(Type.Er, Type.of("erDiagram\n A ||--o{ B : has"))
        assertEquals(Type.Gantt, Type.of("gantt\n title x"))
        assertEquals(Type.Pie, Type.of("pie title Pets"))
    }

    @Test
    fun `unknown and empty sources fall through`() {
        assertEquals(Type.Unknown, Type.of("hello world"))
        assertEquals(Type.Unknown, Type.of(""))
        assertEquals(Type.Unknown, Type.of("%% only a comment"))
    }
}
