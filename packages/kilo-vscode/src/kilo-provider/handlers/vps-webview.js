/**
 * vps-webview.ts
 *
 * Bridges webview messages from VPSTab.tsx → VPS server state (persisted in
 * ExtensionContext workspaceState) + SSH-based metric collection.
 *
 * Server inventory is persisted locally so it survives reloads without a
 * running backend. Metric collection / service / docker actions are forwarded
 * via SSH using the server's configured sshProfile.
 *
 * Message types handled:
 *   requestVpsServers      → load inventory, push vpsServersLoaded
 *   vpsAddServer           → add server to inventory, push vpsServersLoaded
 *   vpsUpdateServer        → update server in inventory, push vpsServersLoaded
 *   vpsRemoveServer        → remove server from inventory, push vpsServersLoaded
 *   requestVpsMetrics      → collect metrics via SSH, push vpsMetricsLoaded + vpsServicesLoaded + vpsContainersLoaded
 *   vpsServiceAction       → run systemctl action via SSH, push vpsActionResult
 *   vpsDockerAction        → run docker action via SSH, push vpsActionResult + vpsContainersLoaded
 *   vpsTriggerDeploy       → trigger deploy script via SSH, push vpsDeployResult
 *   vpsCreateBackup        → trigger backup script via SSH, push vpsBackupResult
 *   vpsRollbackDeploy      → trigger rollback script via SSH, push vpsDeployResult
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var SERVERS_KEY = "vps.servers";
var DEPLOY_HISTORY_KEY = "vps.deployHistory";
function loadServers(ctx) {
    return ctx.extensionContext.workspaceState.get(SERVERS_KEY, []);
}
function saveServers(ctx, servers) {
    return ctx.extensionContext.workspaceState.update(SERVERS_KEY, servers);
}
function loadDeployHistory(ctx) {
    return ctx.extensionContext.workspaceState.get(DEPLOY_HISTORY_KEY, []);
}
function saveDeployHistory(ctx, history) {
    return ctx.extensionContext.workspaceState.update(DEPLOY_HISTORY_KEY, history.slice(0, 100));
}
function sshRun(server, command, timeoutMs) {
    if (timeoutMs === void 0) { timeoutMs = 15000; }
    return __awaiter(this, void 0, void 0, function () {
        var target, _a, stdout, stderr;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    target = server.sshProfile || "" + server.ip;
                    return [4 /*yield*/, execFileAsync("ssh", ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=no", target, command], { timeout: timeoutMs })];
                case 1:
                    _a = _b.sent(), stdout = _a.stdout, stderr = _a.stderr;
                    return [2 /*return*/, { stdout: stdout, stderr: stderr }];
            }
        });
    });
}
function parseMetrics(stdout, serverId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    var lines = stdout.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    var cpu = 0;
    var ramUsed = 0;
    var ramTotal = 0;
    var disks = [];
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        if (line.startsWith("CPU:"))
            cpu = parseFloat((_a = line.split(":")[1]) !== null && _a !== void 0 ? _a : "0");
        else if (line.startsWith("RAM:")) {
            var parts = (_c = (_b = line.split(":")[1]) === null || _b === void 0 ? void 0 : _b.split("/")) !== null && _c !== void 0 ? _c : [];
            ramUsed = parseInt((_d = parts[0]) !== null && _d !== void 0 ? _d : "0", 10);
            ramTotal = parseInt((_e = parts[1]) !== null && _e !== void 0 ? _e : "0", 10);
        }
        else if (line.startsWith("DISK:")) {
            var parts = (_g = (_f = line.split(":")[1]) === null || _f === void 0 ? void 0 : _f.split(",")) !== null && _g !== void 0 ? _g : [];
            disks.push({
                mount: (_j = (_h = parts[0]) === null || _h === void 0 ? void 0 : _h.trim()) !== null && _j !== void 0 ? _j : "/",
                used: parseInt((_k = parts[1]) !== null && _k !== void 0 ? _k : "0", 10),
                total: parseInt((_l = parts[2]) !== null && _l !== void 0 ? _l : "0", 10)
            });
        }
    }
    return { serverId: serverId, cpu: cpu, ramUsed: ramUsed, ramTotal: ramTotal, disks: disks, timestamp: Date.now() };
}
function parseServices(stdout) {
    return stdout
        .split("\n")
        .map(function (l) { return l.trim(); })
        .filter(Boolean)
        .map(function (line) {
        var _a, _b, _c, _d, _e;
        var parts = line.split(/\s+/);
        return {
            name: (_a = parts[0]) !== null && _a !== void 0 ? _a : "",
            status: ((_b = parts[1]) !== null && _b !== void 0 ? _b : "unknown"),
            pid: parseInt((_c = parts[2]) !== null && _c !== void 0 ? _c : "0", 10),
            cpuPercent: parseFloat((_d = parts[3]) !== null && _d !== void 0 ? _d : "0"),
            memPercent: parseFloat((_e = parts[4]) !== null && _e !== void 0 ? _e : "0")
        };
    })
        .filter(function (s) { return s.name.length > 0; });
}
function parseContainers(stdout) {
    return stdout
        .split("\n")
        .map(function (l) { return l.trim(); })
        .filter(Boolean)
        .map(function (line) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        var parts = line.split("|");
        return {
            id: (_b = (_a = parts[0]) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : "",
            name: (_d = (_c = parts[1]) === null || _c === void 0 ? void 0 : _c.trim()) !== null && _d !== void 0 ? _d : "",
            image: (_f = (_e = parts[2]) === null || _e === void 0 ? void 0 : _e.trim()) !== null && _f !== void 0 ? _f : "",
            status: (_h = (_g = parts[3]) === null || _g === void 0 ? void 0 : _g.trim()) !== null && _h !== void 0 ? _h : "",
            ports: ((_k = (_j = parts[4]) === null || _j === void 0 ? void 0 : _j.trim()) !== null && _k !== void 0 ? _k : "").split(",").map(function (p) { return p.trim(); }).filter(Boolean)
        };
    })
        .filter(function (c) { return c.id.length > 0; });
}
var METRICS_SCRIPT = [
    "echo CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | tr -d '%us,')",
    "MEM=$(free -m | awk '/^Mem/{print $3\"/\"$2}'); echo RAM:$MEM",
    "df -BM --output=target,used,size | tail -n+2 | awk '{gsub(/M/,\"\",$2); gsub(/M/,\"\",$3); print \"DISK:\"$1\",\"$2\",\"$3}'",
].join("; ");
var SERVICES_SCRIPT = "systemctl list-units --type=service --state=running --no-legend --no-pager | awk '{print $1\" running 0 0 0}' | head -20";
var CONTAINERS_SCRIPT = "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null || true";
// eslint-disable-next-line complexity
export function handleVpsWebviewMessage(msg, ctx) {
    var _a, _b, _c, _d, _e, _f, _g;
    return __awaiter(this, void 0, void 0, function () {
        var _h, servers, history_1, servers, server, servers, idx, servers, servers, server, _j, metricsOut, servicesOut, containersOut, allOk, e_1, servers, server, svc, action, stdout, e_2, servers, server, containerId, action, dockerCmd, stdout, listOut, e_3, servers, server, entryId, history_2, entry, stdout, e_4, servers, server, stdout, e_5, servers, server, stdout, e_6;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    _h = msg.type;
                    switch (_h) {
                        case "requestVpsServers": return [3 /*break*/, 1];
                        case "vpsAddServer": return [3 /*break*/, 2];
                        case "vpsUpdateServer": return [3 /*break*/, 4];
                        case "vpsRemoveServer": return [3 /*break*/, 7];
                        case "requestVpsMetrics": return [3 /*break*/, 9];
                        case "vpsServiceAction": return [3 /*break*/, 16];
                        case "vpsDockerAction": return [3 /*break*/, 21];
                        case "vpsTriggerDeploy": return [3 /*break*/, 28];
                        case "vpsCreateBackup": return [3 /*break*/, 35];
                        case "vpsRollbackDeploy": return [3 /*break*/, 40];
                    }
                    return [3 /*break*/, 45];
                case 1:
                    {
                        servers = loadServers(ctx);
                        history_1 = loadDeployHistory(ctx);
                        ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                        ctx.postMessage({ type: "vpsDeployHistoryLoaded", history: history_1 });
                        return [2 /*return*/, true];
                    }
                    _k.label = 2;
                case 2:
                    servers = loadServers(ctx);
                    server = {
                        id: msg.id,
                        hostname: (_a = msg.hostname) !== null && _a !== void 0 ? _a : "",
                        ip: (_b = msg.ip) !== null && _b !== void 0 ? _b : "",
                        sshProfile: (_c = msg.sshProfile) !== null && _c !== void 0 ? _c : "",
                        os: (_d = msg.os) !== null && _d !== void 0 ? _d : "linux",
                        region: (_e = msg.region) !== null && _e !== void 0 ? _e : "",
                        tags: (_f = msg.tags) !== null && _f !== void 0 ? _f : [],
                        status: "unknown"
                    };
                    servers.push(server);
                    return [4 /*yield*/, saveServers(ctx, servers)];
                case 3:
                    _k.sent();
                    ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                    return [2 /*return*/, true];
                case 4:
                    servers = loadServers(ctx);
                    idx = servers.findIndex(function (s) { return s.id === msg.id; });
                    if (!(idx >= 0)) return [3 /*break*/, 6];
                    servers[idx] = __assign(__assign({}, servers[idx]), msg);
                    return [4 /*yield*/, saveServers(ctx, servers)];
                case 5:
                    _k.sent();
                    _k.label = 6;
                case 6:
                    ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                    return [2 /*return*/, true];
                case 7:
                    servers = loadServers(ctx);
                    servers = servers.filter(function (s) { return s.id !== msg.serverId; });
                    return [4 /*yield*/, saveServers(ctx, servers)];
                case 8:
                    _k.sent();
                    ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                    return [2 /*return*/, true];
                case 9:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server) {
                        ctx.postMessage({ type: "vpsError", error: "Server not found" });
                        return [2 /*return*/, true];
                    }
                    _k.label = 10;
                case 10:
                    _k.trys.push([10, 13, , 15]);
                    return [4 /*yield*/, Promise.allSettled([
                            sshRun(server, METRICS_SCRIPT),
                            sshRun(server, SERVICES_SCRIPT),
                            sshRun(server, CONTAINERS_SCRIPT),
                        ])];
                case 11:
                    _j = _k.sent(), metricsOut = _j[0], servicesOut = _j[1], containersOut = _j[2];
                    if (metricsOut.status === "fulfilled") {
                        ctx.postMessage({ type: "vpsMetricsLoaded", metrics: parseMetrics(metricsOut.value.stdout, server.id) });
                    }
                    if (servicesOut.status === "fulfilled") {
                        ctx.postMessage({ type: "vpsServicesLoaded", services: parseServices(servicesOut.value.stdout) });
                    }
                    if (containersOut.status === "fulfilled") {
                        ctx.postMessage({ type: "vpsContainersLoaded", containers: parseContainers(containersOut.value.stdout) });
                    }
                    allOk = [metricsOut, servicesOut, containersOut].every(function (r) { return r.status === "fulfilled"; });
                    server.status = allOk ? "online" : "degraded";
                    return [4 /*yield*/, saveServers(ctx, servers)];
                case 12:
                    _k.sent();
                    ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                    return [3 /*break*/, 15];
                case 13:
                    e_1 = _k.sent();
                    server.status = "offline";
                    return [4 /*yield*/, saveServers(ctx, servers)];
                case 14:
                    _k.sent();
                    ctx.postMessage({ type: "vpsServersLoaded", servers: servers });
                    ctx.postMessage({ type: "vpsError", error: e_1 instanceof Error ? e_1.message : String(e_1) });
                    return [3 /*break*/, 15];
                case 15: return [2 /*return*/, true];
                case 16:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server)
                        return [2 /*return*/, true];
                    svc = msg.service;
                    action = msg.action;
                    _k.label = 17;
                case 17:
                    _k.trys.push([17, 19, , 20]);
                    return [4 /*yield*/, sshRun(server, "sudo systemctl " + action + " " + svc + " 2>&1 || true", 20000)];
                case 18:
                    stdout = (_k.sent()).stdout;
                    ctx.postMessage({ type: "vpsActionResult", service: svc, action: action, output: stdout, success: true });
                    return [3 /*break*/, 20];
                case 19:
                    e_2 = _k.sent();
                    ctx.postMessage({ type: "vpsActionResult", service: svc, action: action, output: "", success: false, error: e_2 instanceof Error ? e_2.message : String(e_2) });
                    return [3 /*break*/, 20];
                case 20: return [2 /*return*/, true];
                case 21:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server)
                        return [2 /*return*/, true];
                    containerId = msg.containerId;
                    action = msg.action;
                    dockerCmd = action === "logs"
                        ? "docker logs --tail 100 " + containerId + " 2>&1"
                        : "docker " + action + " " + containerId + " 2>&1";
                    _k.label = 22;
                case 22:
                    _k.trys.push([22, 26, , 27]);
                    return [4 /*yield*/, sshRun(server, dockerCmd, 20000)];
                case 23:
                    stdout = (_k.sent()).stdout;
                    ctx.postMessage({ type: "vpsActionResult", containerId: containerId, action: action, output: stdout, success: true });
                    if (!(action !== "logs")) return [3 /*break*/, 25];
                    return [4 /*yield*/, sshRun(server, CONTAINERS_SCRIPT)];
                case 24:
                    listOut = (_k.sent()).stdout;
                    ctx.postMessage({ type: "vpsContainersLoaded", containers: parseContainers(listOut) });
                    _k.label = 25;
                case 25: return [3 /*break*/, 27];
                case 26:
                    e_3 = _k.sent();
                    ctx.postMessage({ type: "vpsActionResult", containerId: containerId, action: action, output: "", success: false, error: e_3 instanceof Error ? e_3.message : String(e_3) });
                    return [3 /*break*/, 27];
                case 27: return [2 /*return*/, true];
                case 28:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server)
                        return [2 /*return*/, true];
                    entryId = "deploy-" + Date.now();
                    history_2 = loadDeployHistory(ctx);
                    entry = { id: entryId, timestamp: Date.now(), action: "deploy", status: "in-progress", rollbackAvailable: false };
                    history_2.unshift(entry);
                    return [4 /*yield*/, saveDeployHistory(ctx, history_2)];
                case 29:
                    _k.sent();
                    ctx.postMessage({ type: "vpsDeployHistoryLoaded", history: history_2 });
                    _k.label = 30;
                case 30:
                    _k.trys.push([30, 32, , 33]);
                    return [4 /*yield*/, sshRun(server, "bash ~/deploy.sh 2>&1 || true", 120000)];
                case 31:
                    stdout = (_k.sent()).stdout;
                    entry.status = "success";
                    entry.rollbackAvailable = true;
                    ctx.postMessage({ type: "vpsDeployResult", success: true, output: stdout });
                    return [3 /*break*/, 33];
                case 32:
                    e_4 = _k.sent();
                    entry.status = "failed";
                    ctx.postMessage({ type: "vpsDeployResult", success: false, error: e_4 instanceof Error ? e_4.message : String(e_4) });
                    return [3 /*break*/, 33];
                case 33: return [4 /*yield*/, saveDeployHistory(ctx, history_2)];
                case 34:
                    _k.sent();
                    ctx.postMessage({ type: "vpsDeployHistoryLoaded", history: history_2 });
                    return [2 /*return*/, true];
                case 35:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server)
                        return [2 /*return*/, true];
                    _k.label = 36;
                case 36:
                    _k.trys.push([36, 38, , 39]);
                    return [4 /*yield*/, sshRun(server, "bash ~/backup.sh 2>&1 || true", 120000)];
                case 37:
                    stdout = (_k.sent()).stdout;
                    ctx.postMessage({ type: "vpsBackupResult", success: true, output: stdout });
                    return [3 /*break*/, 39];
                case 38:
                    e_5 = _k.sent();
                    ctx.postMessage({ type: "vpsBackupResult", success: false, error: e_5 instanceof Error ? e_5.message : String(e_5) });
                    return [3 /*break*/, 39];
                case 39: return [2 /*return*/, true];
                case 40:
                    servers = loadServers(ctx);
                    server = servers.find(function (s) { return s.id === msg.serverId; });
                    if (!server)
                        return [2 /*return*/, true];
                    _k.label = 41;
                case 41:
                    _k.trys.push([41, 43, , 44]);
                    return [4 /*yield*/, sshRun(server, "bash ~/rollback.sh " + ((_g = msg.deployId) !== null && _g !== void 0 ? _g : "") + " 2>&1 || true", 120000)];
                case 42:
                    stdout = (_k.sent()).stdout;
                    ctx.postMessage({ type: "vpsDeployResult", success: true, output: stdout });
                    return [3 /*break*/, 44];
                case 43:
                    e_6 = _k.sent();
                    ctx.postMessage({ type: "vpsDeployResult", success: false, error: e_6 instanceof Error ? e_6.message : String(e_6) });
                    return [3 /*break*/, 44];
                case 44: return [2 /*return*/, true];
                case 45: return [2 /*return*/, false];
            }
        });
    });
}
//# sourceMappingURL=vps-webview.js.map