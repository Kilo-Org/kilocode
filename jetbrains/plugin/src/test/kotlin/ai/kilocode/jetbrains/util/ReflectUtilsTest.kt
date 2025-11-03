// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.reflect.full.functions

class ReflectUtilsTest {

    class TestActor {
        fun methodWithAnyParam(id: Int, value: Any?): String {
            return "id=$id, value=$value (${value?.javaClass?.simpleName})"
        }

        fun methodWithIntParam(id: Int, value: Int): String {
            return "id=$id, value=$value"
        }

        fun methodWithMultipleAnyParams(
            id: Int,
            name: String,
            priority: Any?,
            enabled: Boolean,
        ): String {
            return "id=$id, name=$name, priority=$priority (${priority?.javaClass?.simpleName}), enabled=$enabled"
        }
    }

    @Test
    fun `test doInvokeMethod with Double to Any conversion`() = runBlocking {
        val actor = TestActor()
        val method = actor::class.functions.first { it.name == "methodWithAnyParam" }

        // Simulate what happens when JSON deserializes a number as Double
        val args = listOf(1.0, 100.0) // Both are Doubles from JSON

        val result = doInvokeMethod(method, args, actor)

        // The Double 100.0 should be converted to Int 100 when passed to Any? parameter
        assertEquals("id=1, value=100 (Integer)", result)
    }

    @Test
    fun `test doInvokeMethod with Double to Int conversion`() = runBlocking {
        val actor = TestActor()
        val method = actor::class.functions.first { it.name == "methodWithIntParam" }

        // Simulate what happens when JSON deserializes a number as Double
        val args = listOf(1.0, 42.0) // Both are Doubles from JSON

        val result = doInvokeMethod(method, args, actor)

        assertEquals("id=1, value=42", result)
    }

    @Test
    fun `test doInvokeMethod with fractional Double to Any conversion`() = runBlocking {
        val actor = TestActor()
        val method = actor::class.functions.first { it.name == "methodWithAnyParam" }

        // Fractional double should remain as Double
        val args = listOf(1.0, 100.5)

        val result = doInvokeMethod(method, args, actor)

        assertEquals("id=1, value=100.5 (Double)", result)
    }

    @Test
    fun `test doInvokeMethod with multiple Any parameters like StatusBar setEntry`() = runBlocking {
        val actor = TestActor()
        val method = actor::class.functions.first { it.name == "methodWithMultipleAnyParams" }

        // Simulate the StatusBar setEntry call with priority as Double
        val args = listOf(1.0, "Test Entry", 100.0, false)

        val result = doInvokeMethod(method, args, actor)

        // Priority should be converted from Double 100.0 to Int 100
        assertEquals("id=1, name=Test Entry, priority=100 (Integer), enabled=false", result)
    }
}
