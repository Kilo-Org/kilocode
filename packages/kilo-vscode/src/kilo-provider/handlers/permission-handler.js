/**
 * Permission handlers — extracted from KiloProvider.
 *
 * Manages permission responses (once/always/reject) and recovery of
 * pending permissions after SSE reconnections. No vscode dependency.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArrays = (this && this.__spreadArrays) || function () {
    for (var s = 0, i = 0, il = arguments.length; i < il; i++) s += arguments[i].length;
    for (var r = Array(s), k = 0, i = 0; i < il; i++)
        for (var a = arguments[i], j = 0, jl = a.length; j < jl; j++, k++)
            r[k] = a[j];
    return r;
};
export function recoveryDirs(workspace, dirs) {
    return __spreadArrays(new Set(__spreadArrays([workspace], dirs.values())));
}
export function recoverablePermissions(perms, tracked, seen) {
    return perms.filter(function (perm) {
        if (seen.has(perm.id))
            return false;
        seen.add(perm.id);
        return tracked.has(perm.sessionID);
    });
}
/**
 * Handle permission response from the webview.
 * Calls saveAlwaysRules first (if any), then reply — sequentially to avoid races.
 */
export function handlePermissionResponse(ctx, permissionId, sessionID, response, approvedAlways, deniedAlways) {
    return __awaiter(this, void 0, void 0, function () {
        var target, dir, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({ type: "permissionError", permissionID: permissionId });
                        return [2 /*return*/];
                    }
                    target = sessionID || ctx.currentSessionId;
                    if (!target) {
                        console.error("[Kilo New] KiloProvider: No sessionID for permission response");
                        ctx.postMessage({ type: "permissionError", permissionID: permissionId });
                        return [2 /*return*/];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 5, , 6]);
                    dir = ctx.getWorkspaceDirectory(target);
                    if (!(approvedAlways.length > 0 || deniedAlways.length > 0)) return [3 /*break*/, 3];
                    return [4 /*yield*/, ctx.client.permission.saveAlwaysRules({
                            requestID: permissionId,
                            directory: dir,
                            approvedAlways: approvedAlways,
                            deniedAlways: deniedAlways
                        }, { throwOnError: true })];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3: return [4 /*yield*/, ctx.client.permission.reply({ requestID: permissionId, reply: response, directory: dir }, { throwOnError: true })];
                case 4:
                    _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    console.error("[Kilo New] KiloProvider: Failed to respond to permission:", error_1);
                    ctx.postMessage({ type: "permissionError", permissionID: permissionId });
                    return [3 /*break*/, 6];
                case 6: return [2 /*return*/];
            }
        });
    });
}
/**
 * Fetch all pending permissions from the backend and forward any that belong
 * to tracked sessions to the webview. Called after SSE reconnects and after
 * loading messages for a session so that missed permission.asked events are
 * recovered instead of leaving the server blocked indefinitely.
 */
export function fetchAndSendPendingPermissions(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var dirs, seen, _i, dirs_1, dir, data, _a, _b, perm, error_2;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!ctx.client)
                        return [2 /*return*/];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 6, , 7]);
                    dirs = recoveryDirs(ctx.getWorkspaceDirectory(), ctx.sessionDirectories);
                    seen = new Set();
                    _i = 0, dirs_1 = dirs;
                    _c.label = 2;
                case 2:
                    if (!(_i < dirs_1.length)) return [3 /*break*/, 5];
                    dir = dirs_1[_i];
                    return [4 /*yield*/, ctx.client.permission.list({ directory: dir })];
                case 3:
                    data = (_c.sent()).data;
                    if (!data)
                        return [3 /*break*/, 4];
                    for (_a = 0, _b = recoverablePermissions(data, ctx.trackedSessionIds, seen); _a < _b.length; _a++) {
                        perm = _b[_a];
                        ctx.postMessage({
                            type: "permissionRequest",
                            permission: {
                                id: perm.id,
                                sessionID: perm.sessionID,
                                toolName: perm.permission,
                                patterns: perm.patterns,
                                always: perm.always,
                                args: perm.metadata,
                                message: "Permission required: " + perm.permission,
                                tool: perm.tool
                            }
                        });
                    }
                    _c.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [3 /*break*/, 7];
                case 6:
                    error_2 = _c.sent();
                    console.error("[Kilo New] KiloProvider: Failed to fetch pending permissions:", error_2);
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
//# sourceMappingURL=permission-handler.js.map