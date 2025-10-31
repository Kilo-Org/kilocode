// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.terminal

import com.pty4j.PtyProcess
import com.pty4j.WinSize

/**
 * ProxyPtyProcess callback interface
 * Simplified version, only provides raw data callback
 */
interface ProxyPtyProcessCallback {
    /**
     * Raw data callback
     * @param data Raw string data
     * @param streamType Stream type (STDOUT/STDERR)
     */
    fun onRawData(data: String, streamType: String)
}

/**
 * ProxyPtyProcess implementation
 * Intercepts input/output stream operations and provides raw data callback
 */
class ProxyPtyProcess(
    private val originalProcess: PtyProcess,
    private val callback: ProxyPtyProcessCallback? = null,
) : PtyProcess() {

    // Create proxy input stream (process standard output)
    private val proxyInputStream: ProxyInputStream = ProxyInputStream(
        originalProcess.inputStream,
        "STDOUT",
        callback,
    )

    // Create proxy error stream (process error output)
    private val proxyErrorStream: ProxyInputStream = ProxyInputStream(
        originalProcess.errorStream,
        "STDERR",
        callback,
    )

    // Override methods that require special handling
    override fun getInputStream(): java.io.InputStream = proxyInputStream
    override fun getErrorStream(): java.io.InputStream = proxyErrorStream
    override fun getOutputStream(): java.io.OutputStream = originalProcess.outputStream

    // Delegate all other methods to the original process
    override fun isAlive(): Boolean = originalProcess.isAlive()
    override fun pid(): Long = originalProcess.pid()
    override fun exitValue(): Int = originalProcess.exitValue()
    override fun waitFor(): Int = originalProcess.waitFor()
    override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean =
        originalProcess.waitFor(timeout, unit)
    override fun destroy() = originalProcess.destroy()
    override fun destroyForcibly(): Process = originalProcess.destroyForcibly()
    override fun info(): ProcessHandle.Info = originalProcess.info()
    override fun children(): java.util.stream.Stream<ProcessHandle> = originalProcess.children()
    override fun descendants(): java.util.stream.Stream<ProcessHandle> = originalProcess.descendants()
    override fun setWinSize(winSize: WinSize) = originalProcess.setWinSize(winSize)
    override fun toHandle(): ProcessHandle = originalProcess.toHandle()
    override fun onExit(): java.util.concurrent.CompletableFuture<Process> = originalProcess.onExit()

    // PtyProcess specific methods
    override fun getWinSize(): WinSize = originalProcess.winSize
    override fun isConsoleMode(): Boolean = originalProcess.isConsoleMode
}

/**
 * Proxy InputStream implementation
 * Intercepts read operations and provides raw data callback
 */
class ProxyInputStream(
    private val originalStream: java.io.InputStream,
    private val streamType: String,
    private val callback: ProxyPtyProcessCallback?,
) : java.io.InputStream() {

    override fun read(): Int {
        val result = originalStream.read()
        if (result != -1 && callback != null) {
            // Convert single byte to string and callback
            val dataString = String(byteArrayOf(result.toByte()), Charsets.UTF_8)
            callback.onRawData(dataString, streamType)
        }
        return result
    }

    override fun read(b: ByteArray): Int {
        val result = originalStream.read(b)
        if (result > 0 && callback != null) {
            // Convert to string and callback
            val dataString = String(b, 0, result, Charsets.UTF_8)
            callback.onRawData(dataString, streamType)
        }
        return result
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
        val result = originalStream.read(b, off, len)
        if (result > 0 && callback != null) {
            // Convert to string and callback
            val dataString = String(b, off, result, Charsets.UTF_8)
            callback.onRawData(dataString, streamType)
        }
        return result
    }

    // Delegate other methods to the original stream
    override fun available(): Int = originalStream.available()
    override fun close() = originalStream.close()
    override fun mark(readlimit: Int) = originalStream.mark(readlimit)
    override fun reset() = originalStream.reset()
    override fun markSupported(): Boolean = originalStream.markSupported()
}
