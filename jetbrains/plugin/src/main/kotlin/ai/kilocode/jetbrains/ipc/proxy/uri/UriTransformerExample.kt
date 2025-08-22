// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.uri

import com.intellij.openapi.diagnostic.Logger
import ai.kilocode.jetbrains.ipc.IMessagePassingProtocol
import ai.kilocode.jetbrains.ipc.ISocket
import ai.kilocode.jetbrains.ipc.PersistentProtocol
import ai.kilocode.jetbrains.ipc.proxy.RPCProtocol
import ai.kilocode.jetbrains.ipc.proxy.createProxyIdentifier
import java.net.URI

/**
 * Example usage of URI transformer
 */
object UriTransformerExample {
    private val LOG = Logger.getInstance(UriTransformerExample::class.java)
    
    /**
     * Example: Create and use URI transformer
     */
    fun uriTransformerExample() {
        // Create URI transformer
        val remoteAuthority = "your-remote-host.example.com"
        val uriTransformer = createURITransformer(remoteAuthority)
        
        // Test URI transformation
        val localUri = URI("file:///path/to/file.txt")
        val remoteUri = uriTransformer.transformOutgoing(localUri)
        LOG.info("Transformed URI: $remoteUri")
        
        // Transform back
        val convertedBackUri = uriTransformer.transformIncoming(remoteUri)
        LOG.info("Transformed back URI: $convertedBackUri")
        
        // Create UriReplacer for URI transformation in JSON objects
        val uriReplacer = UriReplacer(uriTransformer)
        val result = uriReplacer("documentUri", "file:///path/to/document.txt")
        LOG.info("Replaced URI: $result")
    }
    
    /**
     * Example: Use URI transformer in RPC protocol
     */
    fun rpcWithUriTransformerExample(socket: ISocket) {
        // Create URI transformer
        val remoteAuthority = "your-remote-host.example.com"
        val uriTransformer = createURITransformer(remoteAuthority)
        
        // Create protocol object
        val persistentProtocol = PersistentProtocol(PersistentProtocol.PersistentProtocolOptions(socket))
        
        // Create RPC protocol object, pass in URI transformer
        val rpcProtocol = RPCProtocol(persistentProtocol, null, uriTransformer)
        
        // Now the RPC protocol will automatically handle URI transformation
        // During serialization and deserialization, URIs will be transformed according to the configured rules
    }
} 