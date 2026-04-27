/**
 * Legacy migration handlers — extracted from KiloProvider.
 *
 * Manages the migration wizard for users upgrading from Kilo Code v5.x.
 * No vscode dependency — all vscode access is injected via MigrationContext.
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
import * as MigrationService from "../../legacy-migration/migration-service";
function postSessionProgress(ctx, progress) {
    ctx.postMessage({
        type: "legacyMigrationSessionProgress",
        session: progress.session,
        index: progress.index,
        total: progress.total,
        phase: progress.phase,
        error: progress.error
    });
}
/**
 * Check for legacy data on first run and send migration state to the webview
 * if the user has not yet been prompted.
 *
 * Uses a state-based approach (migrationState message) instead of navigate
 * to avoid race conditions with SettingsEditorProvider's view navigation.
 */
export function checkAndShowMigrationWizard(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var status, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.extensionContext)
                        return [2 /*return*/];
                    if (ctx.migrationCheckInFlight)
                        return [2 /*return*/];
                    status = MigrationService.getMigrationStatus(ctx.extensionContext);
                    if (status)
                        return [2 /*return*/]; // already prompted (skipped or completed)
                    ctx.migrationCheckInFlight = true;
                    return [4 /*yield*/, MigrationService.detectLegacyData(ctx.extensionContext)];
                case 1:
                    data = _a.sent();
                    ctx.migrationCheckInFlight = false;
                    if (!data.hasData)
                        return [2 /*return*/];
                    // Cache so migrate() doesn't re-read from SecretStorage/disk
                    ctx.cachedLegacyData = data;
                    console.log("[Kilo New] KiloProvider: 🔄 Legacy data detected, showing migration wizard");
                    ctx.postMessage({
                        type: "migrationState",
                        needed: true,
                        data: {
                            providers: data.providers,
                            mcpServers: data.mcpServers,
                            customModes: data.customModes,
                            sessions: data.sessions,
                            defaultModel: data.defaultModel,
                            settings: data.settings
                        }
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/** Send the detected legacy data to the webview on explicit request. */
export function handleRequestLegacyMigrationData(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        var data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.extensionContext)
                        return [2 /*return*/];
                    return [4 /*yield*/, MigrationService.detectLegacyData(ctx.extensionContext)];
                case 1:
                    data = _a.sent();
                    ctx.cachedLegacyData = data;
                    ctx.postMessage({
                        type: "legacyMigrationData",
                        data: {
                            providers: data.providers,
                            mcpServers: data.mcpServers,
                            customModes: data.customModes,
                            sessions: data.sessions,
                            defaultModel: data.defaultModel,
                            settings: data.settings
                        }
                    });
                    return [2 /*return*/];
            }
        });
    });
}
/** Run the migration for the selected items. */
export function handleStartLegacyMigration(ctx, selections) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var results, error_1;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    if (!ctx.extensionContext || !ctx.client)
                        return [2 /*return*/];
                    _c.label = 1;
                case 1:
                    _c.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, MigrationService.migrate(ctx.extensionContext, ctx.client, selections, function (item, status, message) {
                            ctx.postMessage({ type: "legacyMigrationProgress", item: item, status: status, message: message });
                        }, function (progress) {
                            postSessionProgress(ctx, progress);
                        }, (_a = ctx.cachedLegacyData) === null || _a === void 0 ? void 0 : _a.settings, (_b = ctx.cachedLegacyData) === null || _b === void 0 ? void 0 : _b.sessions)];
                case 2:
                    results = _c.sent();
                    ctx.lastMigrationHadErrors = results.some(function (item) { return item.status === "error"; });
                    ctx.postMessage({ type: "legacyMigrationComplete", results: results });
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _c.sent();
                    ctx.lastMigrationHadErrors = true;
                    console.error("[Kilo New] KiloProvider: ❌ Migration failed", error_1);
                    ctx.postMessage({
                        type: "legacyMigrationComplete",
                        results: [
                            {
                                item: "Migration",
                                category: "settings",
                                status: "error",
                                message: error_1 instanceof Error ? error_1.message : String(error_1)
                            },
                        ]
                    });
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
export function handleFinalizeLegacyMigration(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.extensionContext)
                        return [2 /*return*/];
                    return [4 /*yield*/, ctx.disposeGlobal()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, MigrationService.setMigrationStatus(ctx.extensionContext, ctx.lastMigrationHadErrors ? "completed_with_errors" : "completed")];
                case 2:
                    _a.sent();
                    ctx.broadcastComplete();
                    ctx.refreshSessions();
                    return [2 /*return*/];
            }
        });
    });
}
/** Record that the user skipped migration and broadcast to all instances. */
export function handleSkipLegacyMigration(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.extensionContext)
                        return [2 /*return*/];
                    return [4 /*yield*/, MigrationService.setMigrationStatus(ctx.extensionContext, "skipped")];
                case 1:
                    _a.sent();
                    ctx.broadcastComplete();
                    return [2 /*return*/];
            }
        });
    });
}
/** Clear legacy data from SecretStorage and globalState after user opts in. */
export function handleClearLegacyData(ctx) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!ctx.extensionContext)
                        return [2 /*return*/];
                    return [4 /*yield*/, MigrationService.clearLegacyData(ctx.extensionContext)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
//# sourceMappingURL=migration.js.map