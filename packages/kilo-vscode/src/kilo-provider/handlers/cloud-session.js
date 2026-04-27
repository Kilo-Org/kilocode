/**
 * Cloud session handlers — extracted from KiloProvider.
 *
 * Manages fetching cloud sessions, previewing them, and the "import + send"
 * flow that clones a cloud session locally on first message. No vscode dependency.
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
import { getErrorMessage, sessionToWebview, mapCloudSessionMessageToWebviewMessage } from "../../kilo-provider-utils";
/** Fetch cloud sessions list and send to webview. */
export function handleRequestCloudSessions(ctx, message) {
    var _a, _b, _c, _d;
    return __awaiter(this, void 0, void 0, function () {
        var result, error_1;
        return __generator(this, function (_e) {
            switch (_e.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({ type: "error", message: "Not connected to CLI backend" });
                        return [2 /*return*/];
                    }
                    _e.label = 1;
                case 1:
                    _e.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ctx.client.kilo.cloudSessions({
                            cursor: message.cursor,
                            limit: message.limit,
                            gitUrl: message.gitUrl
                        })];
                case 2:
                    result = _e.sent();
                    ctx.postMessage({
                        type: "cloudSessionsLoaded",
                        sessions: (_b = (_a = result.data) === null || _a === void 0 ? void 0 : _a.cliSessions) !== null && _b !== void 0 ? _b : [],
                        nextCursor: (_d = (_c = result.data) === null || _c === void 0 ? void 0 : _c.nextCursor) !== null && _d !== void 0 ? _d : null
                    });
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _e.sent();
                    console.error("[Kilo New] KiloProvider: Failed to fetch cloud sessions:", error_1);
                    ctx.postMessage({
                        type: "error",
                        message: error_1 instanceof Error ? error_1.message : "Failed to fetch cloud sessions"
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Fetch full cloud session data for read-only preview.
 * Transforms the export data into webview message format and sends it back.
 */
export function handleRequestCloudSessionData(ctx, sessionId) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var result, data, messages, err_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({
                            type: "cloudSessionImportFailed",
                            cloudSessionId: sessionId,
                            error: "Not connected to CLI backend"
                        });
                        return [2 /*return*/];
                    }
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ctx.client.kilo.cloud.session.get({ id: sessionId })];
                case 2:
                    result = _c.sent();
                    data = result.data;
                    if (!data) {
                        ctx.postMessage({
                            type: "cloudSessionImportFailed",
                            cloudSessionId: sessionId,
                            error: "Failed to fetch cloud session"
                        });
                        return [2 /*return*/];
                    }
                    messages = ((_a = data.messages) !== null && _a !== void 0 ? _a : []).filter(function (m) { return m.info; }).map(mapCloudSessionMessageToWebviewMessage);
                    ctx.postMessage({
                        type: "cloudSessionDataLoaded",
                        cloudSessionId: sessionId,
                        title: (_b = data.info.title) !== null && _b !== void 0 ? _b : "Untitled",
                        messages: messages
                    });
                    return [3 /*break*/, 4];
                case 3:
                    err_1 = _c.sent();
                    console.error("[Kilo New] Failed to load cloud session data:", err_1);
                    ctx.postMessage({
                        type: "cloudSessionImportFailed",
                        cloudSessionId: sessionId,
                        error: err_1 instanceof Error ? err_1.message : "Failed to load cloud session"
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Import a cloud session to local storage, then send a new message on it.
 * This is the "clone on first message" flow — the cloud session becomes a
 * local session only when the user decides to continue it.
 */
export function handleImportAndSend(ctx, cloudSessionId, text, messageID, providerID, modelID, agent, variant, files, command, commandArgs) {
    var _a;
    return __awaiter(this, void 0, void 0, function () {
        var client, dir, session, result, error_2, run, err_2;
        var _this = this;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (!ctx.client) {
                        ctx.postMessage({
                            type: "cloudSessionImportFailed",
                            cloudSessionId: cloudSessionId,
                            error: "Not connected to CLI backend"
                        });
                        return [2 /*return*/];
                    }
                    client = ctx.client;
                    dir = ctx.getWorkspaceDirectory();
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, ctx.client.kilo.cloud.session["import"]({
                            sessionId: cloudSessionId,
                            directory: dir
                        })];
                case 2:
                    result = _b.sent();
                    session = result.data;
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _b.sent();
                    console.error("[Kilo New] KiloProvider: ❌ Cloud session import failed:", error_2);
                    ctx.postMessage({
                        type: "cloudSessionImportFailed",
                        cloudSessionId: cloudSessionId,
                        error: getErrorMessage(error_2) || "Failed to import session from cloud"
                    });
                    return [2 /*return*/];
                case 4:
                    if (!session) {
                        ctx.postMessage({
                            type: "cloudSessionImportFailed",
                            cloudSessionId: cloudSessionId,
                            error: "Failed to import session from cloud"
                        });
                        return [2 /*return*/];
                    }
                    // Track the new local session
                    ctx.currentSession = session;
                    ctx.trackedSessionIds.add(session.id);
                    // Notify webview of the import success
                    ctx.postMessage({
                        type: "cloudSessionImported",
                        cloudSessionId: cloudSessionId,
                        session: sessionToWebview(session)
                    });
                    run = (_a = ctx.runWithMessageConfirmation) !== null && _a !== void 0 ? _a : (function (_id, _label, fn) { return fn(); });
                    _b.label = 5;
                case 5:
                    _b.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, run(messageID, "Cloud import send", function () { return __awaiter(_this, void 0, void 0, function () {
                            var parts_1, parts, _i, files_1, f, editorContext;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        if (messageID) {
                                            ctx.connectionService.recordMessageSessionId(messageID, session.id);
                                        }
                                        if (!command) return [3 /*break*/, 2];
                                        parts_1 = files === null || files === void 0 ? void 0 : files.map(function (f) { return ({
                                            type: "file",
                                            mime: f.mime,
                                            url: f.url,
                                            filename: f.filename,
                                            source: f.source
                                        }); });
                                        return [4 /*yield*/, client.session.command({
                                                sessionID: session.id,
                                                directory: dir,
                                                command: command,
                                                arguments: commandArgs !== null && commandArgs !== void 0 ? commandArgs : "",
                                                messageID: messageID,
                                                model: providerID && modelID ? providerID + "/" + modelID : undefined,
                                                agent: agent,
                                                variant: variant,
                                                parts: parts_1
                                            }, { throwOnError: true })];
                                    case 1:
                                        _a.sent();
                                        return [2 /*return*/];
                                    case 2:
                                        parts = [];
                                        if (files) {
                                            for (_i = 0, files_1 = files; _i < files_1.length; _i++) {
                                                f = files_1[_i];
                                                parts.push({ type: "file", mime: f.mime, url: f.url, filename: f.filename, source: f.source });
                                            }
                                        }
                                        parts.push({ type: "text", text: text });
                                        return [4 /*yield*/, ctx.gatherEditorContext()];
                                    case 3:
                                        editorContext = _a.sent();
                                        return [4 /*yield*/, client.session.promptAsync({
                                                sessionID: session.id,
                                                directory: dir,
                                                messageID: messageID,
                                                parts: parts,
                                                model: providerID && modelID ? { providerID: providerID, modelID: modelID } : undefined,
                                                agent: agent,
                                                variant: variant,
                                                editorContext: editorContext
                                            }, { throwOnError: true })];
                                    case 4:
                                        _a.sent();
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 6:
                    _b.sent();
                    return [3 /*break*/, 8];
                case 7:
                    err_2 = _b.sent();
                    console.error("[Kilo New] Failed to send message after cloud import:", err_2);
                    ctx.postMessage({
                        type: "sendMessageFailed",
                        error: err_2 instanceof Error ? err_2.message : "Failed to send message after import",
                        text: text,
                        sessionID: session.id,
                        draftID: session.id,
                        messageID: messageID,
                        files: files
                    });
                    return [3 /*break*/, 8];
                case 8: return [2 /*return*/];
            }
        });
    });
}
//# sourceMappingURL=cloud-session.js.map