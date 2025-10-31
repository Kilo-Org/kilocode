// SPDX-FileCopyrightText: 2025 Weibo, Inc.
//
// SPDX-License-Identifier: Apache-2.0

package ai.kilocode.jetbrains.ipc.proxy.interfaces

import ai.kilocode.jetbrains.ipc.proxy.LazyPromise

// export interface ExtHostCommandsShape {
//    $executeContributedCommand(id: string, ...args: any[]): Promise<unknown>;
//    $getContributedCommandMetadata(): Promise<{ [id: string]: string | ICommandMetadataDto }>;
// }

interface ExtHostCommandsProxy {
    fun executeContributedCommand(id: String, args: List<Any?>): LazyPromise
    fun getContributedCommandMetadata(): LazyPromise
}
