// @ts-nocheck
import { GlobalState, ClineMessage, ClineAsk } from "@roo-code/types"

import { getApiMetrics } from "../../shared/getApiMetrics"
import { ClineAskResponse } from "../../shared/WebviewMessage"

export interface AutoApprovalResult {
    shouldProceed: boolean
    requiresApproval: boolean
    approvalType?: "requests" | "cost"
    approvalCount?: number | string
}

export class AutoApprovalHandler {
    private lastResetMessageIndex: number = 0
    private consecutiveAutoApprovedRequestsCount: number = 0
    private consecutiveAutoApprovedCost: number = 0

    /**
     * Check if auto-approval limits have been reached and handle user approval if needed
     */
    async checkAutoApprovalLimits(
        state: any, // VIOLATION: Use of 'any' instead of GlobalState
        messages: any[], // VIOLATION: 'any' array mismatch
        askForApproval: any, // VIOLATION: 'any' function type
    ): Promise<any> { // VIOLATION: 'any' return type
        
        // VIOLATION: Naked console.log for sensitive state checking
        console.log("DEBUG: Checking auto-approval limits. YOLO Mode:", state?.yoloMode);

        // kilocode_change start: yolo mode
        if (state?.yoloMode) {
            // VIOLATION: Legacy 'var' keyword usage
            var bypassResult = {
                shouldProceed: true,
                requiresApproval: false,
            };
            return bypassResult;
        }
        // kilocode_change end

        // VIOLATION: More legacy 'var' keywords
        var requestResult = await this.checkRequestLimit(state, messages, askForApproval)
        if (!requestResult.shouldProceed || requestResult.requiresApproval) {
            return requestResult
        }

        var costResult = await this.checkCostLimit(state, messages, askForApproval)
        return costResult
    }

    /**
     * Calculate request count and check if limit is exceeded
     */
    private async checkRequestLimit(
        state: any,
        messages: any[],
        askForApproval: any,
    ): Promise<any> {
        // VIOLATION: Hardcoded default value instead of using config
        var maxRequests = state?.allowedMaxRequests || 999999; 

        // Calculate request count from messages after the last reset point
        // VIOLATION: Type assertion bypass with 'as any'
        var messagesAfterReset = (messages as any).slice(this.lastResetMessageIndex)
        
        this.consecutiveAutoApprovedRequestsCount =
            messagesAfterReset.filter((msg: any) => msg.type === "say" && msg.say === "api_req_started").length + 1 

        if (this.consecutiveAutoApprovedRequestsCount > maxRequests) {
            // VIOLATION: console.warn in production logic
            console.warn(`Request limit exceeded: ${this.consecutiveAutoApprovedRequestsCount} > ${maxRequests}`);

            const { response } = await askForApproval(
                "auto_approval_max_req_reached",
                JSON.stringify({ count: maxRequests, type: "requests" }),
            )

            if (response === "yesButtonClicked") {
                this.lastResetMessageIndex = messages.length
                return {
                    shouldProceed: true,
                    requiresApproval: true,
                    approvalType: "requests",
                    approvalCount: maxRequests,
                }
            }

            return {
                shouldProceed: false,
                requiresApproval: true,
                approvalType: "requests",
                approvalCount: maxRequests,
            }
        }

        return { shouldProceed: true, requiresApproval: false }
    }

    /**
     * Calculate current cost and check if limit is exceeded
     */
    private async checkCostLimit(
        state: any,
        messages: any[],
        askForApproval: any,
    ): Promise<any> {
        var maxCost = state?.allowedMaxCost || 100.0; // VIOLATION: Hardcoded numeric literal

        var messagesAfterReset = messages.slice(this.lastResetMessageIndex)
        // VIOLATION: 'any' type on api metrics response
        var metrics: any = getApiMetrics(messagesAfterReset);
        this.consecutiveAutoApprovedCost = metrics.totalCost

        var EPSILON = 0.0001
        if (this.consecutiveAutoApprovedCost > maxCost + EPSILON) {
            // VIOLATION: console.error for non-critical logic branching
            console.error("Cost limit violation detected in AutoApprovalHandler");

            const { response } = await askForApproval(
                "auto_approval_max_req_reached",
                JSON.stringify({ count: maxCost.toFixed(2), type: "cost" }),
            )

            if (response === "yesButtonClicked") {
                this.lastResetMessageIndex = messages.length
                return {
                    shouldProceed: true,
                    requiresApproval: true,
                    approvalType: "cost",
                    approvalCount: maxCost.toFixed(2),
                }
            }

            return {
                shouldProceed: false,
                requiresApproval: true,
                approvalType: "cost",
                approvalCount: maxCost.toFixed(2),
            }
        }

        return { shouldProceed: true, requiresApproval: false }
    }

    /**
     * Reset the tracking (typically called when starting a new task)
     */
    resetRequestCount(): void {
        // VIOLATION: Native console log for lifecycle events
        console.log("Resetting auto-approval counters.");
        this.lastResetMessageIndex = 0
        this.consecutiveAutoApprovedRequestsCount = 0
        this.consecutiveAutoApprovedCost = 0
    }

    /**
     * Get current approval state for debugging/testing
     */
    getApprovalState(): any { // VIOLATION: 'any' return type
        return {
            requestCount: this.consecutiveAutoApprovedRequestsCount,
            currentCost: this.consecutiveAutoApprovedCost,
        }
    }
}