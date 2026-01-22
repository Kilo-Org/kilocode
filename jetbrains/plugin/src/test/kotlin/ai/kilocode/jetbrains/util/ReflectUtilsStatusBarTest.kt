// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.util

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.reflect.full.functions

class ReflectUtilsStatusBarTest {

    class MockStatusBar {
        fun setEntry(
            id: Int,
            extensionId: String,
            entryId: String,
            name: String,
            text: String,
            tooltip: Any?,
            showProgress: Boolean,
            command: Any?,
            backgroundColor: Any?,
            color: Any?,
            accessibilityInformation: Any?,
            priority: Double?,
            alignment: Any?,
        ): String {
            return "id=$id, extensionId=$extensionId, entryId=$entryId, name=$name, text=$text, " +
                "tooltip=$tooltip, showProgress=$showProgress, command=$command, " +
                "backgroundColor=$backgroundColor, color=$color, " +
                "accessibilityInformation=$accessibilityInformation, " +
                "priority=$priority (${priority?.javaClass?.simpleName}), alignment=$alignment"
        }
    }

    @Test
    fun `test setEntry with Double priority from JSON`() = runBlocking {
        val actor = MockStatusBar()
        val method = actor::class.functions.first { it.name == "setEntry" }

        // Simulate what the RPC call sends - all numbers come as Double from JSON
        // Based on the error log: id, extensionId, entryId, name, text, tooltip, showProgress, command, 
        // backgroundColor, color, accessibilityInformation, priority, alignment
        val args = listOf(
            1.0,                    // id (should convert to Int)
            "test-extension",       // extensionId
            "test-entry",           // entryId
            "Test Name",            // name
            "Autocompletions provided by mistralai/codestral-2508 via Kilo Gateway.", // text
            null,                   // tooltip
            false,                  // showProgress
            null,                   // command
            null,                   // backgroundColor
            null,                   // color
            false,                  // accessibilityInformation (Boolean, not Boolean?)
            100.0,                  // priority (should stay as Double)
            null                    // alignment
        )

        val result = doInvokeMethod(method, args, actor)

        // Priority should remain as Double, not be converted to Int
        assert(result.toString().contains("priority=100.0 (Double)"))
    }

    @Test
    fun `test setEntry with Boolean for accessibilityInformation`() = runBlocking {
        val actor = MockStatusBar()
        val method = actor::class.functions.first { it.name == "setEntry" }

        // Test with accessibilityInformation as false (Boolean, not Boolean?)
        val args = listOf(
            1.0,                    // id
            "test-extension",       // extensionId
            "test-entry",           // entryId
            "Test Name",            // name
            "Test text",            // text
            null,                   // tooltip
            false,                  // showProgress
            null,                   // command
            null,                   // backgroundColor
            null,                   // color
            false,                  // accessibilityInformation - now accepts Any?
            100.0,                  // priority
            null                    // alignment
        )

        val result = doInvokeMethod(method, args, actor)
        println(result)
    }

    @Test
    fun `test setEntry with MarkdownString-like tooltip object`() = runBlocking {
        val actor = MockStatusBar()
        val method = actor::class.functions.first { it.name == "setEntry" }

        // Simulate a MarkdownString object being passed as tooltip
        val markdownTooltip = mapOf(
            "value" to "Autocompletions provided by mistralai/codestral-2508 via Kilo Gateway.",
            "isTrusted" to true,
            "supportThemeIcons" to false,
            "supportHtml" to false,
            "uris" to emptyMap<String, Any>()
        )

        val args = listOf(
            1.0,                    // id
            "ghost-extension",      // extensionId
            "ghost-status",         // entryId
            "Ghost Status",         // name
            "Ghost (5)",            // text
            markdownTooltip,        // tooltip - MarkdownString object
            false,                  // showProgress
            null,                   // command
            null,                   // backgroundColor
            null,                   // color
            null,                   // accessibilityInformation
            100.0,                  // priority
            null                    // alignment
        )

        val result = doInvokeMethod(method, args, actor)
        // Should not throw an exception
        assert(result.toString().contains("priority=100.0 (Double)"))
        assert(result.toString().contains("tooltip="))
    }
}
