/**
 * zeroclaw-webview.ts
 *
 * Bridges webview messages from ZeroClawTab.tsx → ZeroClawService.
 *
 * Message types handled:
 *   zeroClawGetHistory    → getAllTasks(), push zeroClawHistoryLoaded
 *   zeroClawSubmitTask    → service.submit(), push zeroClawTaskSubmitted
 *   zeroClawCancelTask    → service.cancel(), push zeroClawTaskUpdated
 *   zeroClawRetryTask     → service.retry(), push zeroClawTaskRetried
 *   zeroClawApproveTask   → service.approve(), push zeroClawTaskUpdated
 *   zeroClawRejectTask    → service.reject(), push zeroClawTaskUpdated
 */
function pushTask(ctx, task) {
    ctx.postMessage({ type: "zeroClawTaskUpdated", task: task });
}
// eslint-disable-next-line complexity
export function handleZeroClawWebviewMessage(msg, ctx) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    switch (msg.type) {
        case "zeroClawGetHistory": {
            var tasks = ctx.service.getHistory(50);
            ctx.postMessage({ type: "zeroClawHistoryLoaded", tasks: tasks });
            return true;
        }
        case "zeroClawSubmitTask": {
            try {
                var submission = {
                    description: (_a = msg.description) !== null && _a !== void 0 ? _a : "",
                    projectPath: (_b = msg.projectPath) !== null && _b !== void 0 ? _b : "",
                    riskLevel: (_c = msg.riskLevel) !== null && _c !== void 0 ? _c : "low",
                    workspaceScope: (_d = msg.workspaceScope) !== null && _d !== void 0 ? _d : "",
                    networkPolicy: (_e = msg.networkPolicy) !== null && _e !== void 0 ? _e : "deny",
                    writePolicy: (_f = msg.writePolicy) !== null && _f !== void 0 ? _f : "read_only",
                    limits: {
                        timeoutSec: (_g = msg.timeoutSec) !== null && _g !== void 0 ? _g : 300,
                        memoryMb: (_h = msg.memoryMb) !== null && _h !== void 0 ? _h : 512,
                        cpu: (_j = msg.cpu) !== null && _j !== void 0 ? _j : 1
                    }
                };
                var task = ctx.service.submit(submission);
                ctx.postMessage({ type: "zeroClawTaskSubmitted", task: task });
            }
            catch (e) {
                ctx.postMessage({ type: "zeroClawError", error: e instanceof Error ? e.message : String(e) });
            }
            return true;
        }
        case "zeroClawCancelTask": {
            var taskId = msg.taskId;
            ctx.service.cancel(taskId);
            var task = ctx.service.getTask(taskId);
            if (task)
                pushTask(ctx, task);
            return true;
        }
        case "zeroClawRetryTask": {
            var taskId = msg.taskId;
            var newTask = ctx.service.retry(taskId);
            if (newTask) {
                ctx.postMessage({ type: "zeroClawTaskRetried", newTask: newTask });
            }
            else {
                ctx.postMessage({ type: "zeroClawError", error: "Retry budget exhausted or task not found" });
            }
            return true;
        }
        case "zeroClawApproveTask": {
            var taskId = msg.taskId;
            var approver = (_k = msg.approver) !== null && _k !== void 0 ? _k : "local-user";
            ctx.service.approve(taskId, approver);
            var task = ctx.service.getTask(taskId);
            if (task)
                pushTask(ctx, task);
            return true;
        }
        case "zeroClawRejectTask": {
            var taskId = msg.taskId;
            ctx.service.reject(taskId);
            var task = ctx.service.getTask(taskId);
            if (task)
                pushTask(ctx, task);
            return true;
        }
        default:
            return false;
    }
}
//# sourceMappingURL=zeroclaw-webview.js.map