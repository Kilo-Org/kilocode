const std = @import("std");

pub const version = 1;
pub const max_request = 1024 * 1024;
pub const max_args = 4096;
pub const max_rules = 4096;
pub const max_names = 1024;
pub const max_text = 32 * 1024;

pub const Kind = enum { literal, subtree };

pub const Rule = struct {
    path: []const u8,
    kind: Kind,
};

pub const Request = struct {
    version: u32,
    command: []const u8,
    args: []const []const u8,
    cwd: []const u8,
    allowWrite: []const Rule,
    denyWrite: []const Rule,
    denyNames: []const []const u8,
    temporaryDirectory: ?[]const u8 = null,
};

pub fn parse(alloc: std.mem.Allocator, data: []const u8) !std.json.Parsed(Request) {
    if (data.len == 0 or data.len > max_request) return error.InvalidRequestSize;
    const parsed = try std.json.parseFromSlice(Request, alloc, data, .{
        .allocate = .alloc_always,
        .ignore_unknown_fields = false,
        .max_value_len = max_request,
    });
    errdefer parsed.deinit();
    const req = parsed.value;
    if (req.version != version) return error.UnsupportedVersion;
    if (!text(req.command) or !text(req.cwd)) return error.MissingPath;
    if (req.args.len > max_args or req.allowWrite.len == 0) return error.InvalidCount;
    if (req.allowWrite.len + req.denyWrite.len > max_rules or req.denyNames.len > max_names) return error.InvalidCount;
    for (req.args) |arg| if (!text(arg)) return error.InvalidText;
    for (req.allowWrite) |rule| {
        if (!text(rule.path)) return error.InvalidText;
        if (rule.kind != .subtree) return error.UnsupportedAllowLiteral;
    }
    for (req.denyWrite) |rule| if (!text(rule.path)) return error.InvalidText;
    for (req.denyNames) |name| {
        if (!text(name) or name.len == 0 or std.mem.indexOfAny(u8, name, "\\/") != null) return error.InvalidName;
    }
    if (req.temporaryDirectory) |path| if (!text(path)) return error.InvalidText;
    return parsed;
}

fn text(value: []const u8) bool {
    return value.len <= max_text and std.mem.indexOfScalar(u8, value, 0) == null;
}

pub fn absolute(path: []const u8) bool {
    if (path.len < 3) return false;
    if (!std.ascii.isAlphabetic(path[0]) or path[1] != ':' or (path[2] != '\\' and path[2] != '/')) return false;
    return std.mem.indexOfScalar(u8, path, 0) == null;
}

pub fn sidText(buf: []u8, path: []const u8, serial: u32, id: u64) ![]const u8 {
    var hash: [32]u8 = undefined;
    var state = std.crypto.hash.sha2.Sha256.init(.{});
    state.update(path);
    state.update(std.mem.asBytes(&serial));
    state.update(std.mem.asBytes(&id));
    state.final(&hash);
    const a = std.mem.readInt(u32, hash[0..4], .little);
    const b = std.mem.readInt(u32, hash[4..8], .little);
    const c = std.mem.readInt(u32, hash[8..12], .little);
    const d = std.mem.readInt(u32, hash[12..16], .little);
    return std.fmt.bufPrint(buf, "S-1-5-21-{d}-{d}-{d}-{d}", .{ a, b, c, d });
}

fn prefix(path: []const u8, root: []const u8) bool {
    if (path.len < root.len or !std.ascii.eqlIgnoreCase(path[0..root.len], root)) return false;
    if (path.len == root.len) return true;
    return path[root.len] == '\\' or path[root.len] == '/';
}

pub fn denied(path: []const u8, name: []const u8, writes: []const Rule, names: []const []const u8) bool {
    for (writes) |rule| switch (rule.kind) {
        .literal => if (std.ascii.eqlIgnoreCase(path, rule.path)) return true,
        .subtree => if (prefix(path, rule.path)) return true,
    };
    for (names) |rule| if (std.ascii.eqlIgnoreCase(name, rule)) return true;
    return false;
}

test "strict versioned request rejects empty roots and literal allows" {
    const alloc = std.testing.allocator;
    try std.testing.expectError(error.InvalidRequestSize, parse(alloc, ""));
    try std.testing.expectError(error.InvalidCount, parse(alloc,
        \\{"version":1,"command":"C:\\\\tool.exe","args":[],"cwd":"C:\\\\work","allowWrite":[],"denyWrite":[],"denyNames":[]}
    ));
    try std.testing.expectError(error.UnsupportedAllowLiteral, parse(alloc,
        \\{"version":1,"command":"C:\\\\tool.exe","args":[],"cwd":"C:\\\\work","allowWrite":[{"path":"C:\\\\work","kind":"literal"}],"denyWrite":[],"denyNames":[]}
    ));
}

test "fully qualified drive paths only" {
    try std.testing.expect(absolute("C:\\work\\tool.exe"));
    try std.testing.expect(!absolute("tool.exe"));
    try std.testing.expect(!absolute("\\\\server\\share\\tool.exe"));
    try std.testing.expect(!absolute("C:tool.exe"));
}

test "synthetic root SID includes canonical identity" {
    var one: [96]u8 = undefined;
    var two: [96]u8 = undefined;
    var three: [96]u8 = undefined;
    const a = try sidText(&one, "c:\\work", 7, 9);
    const b = try sidText(&two, "c:\\work", 7, 9);
    const c = try sidText(&three, "c:\\work", 7, 10);
    try std.testing.expectEqualStrings(a, b);
    try std.testing.expect(!std.mem.eql(u8, a, c));
}

test "literal and subtree deny rules differ" {
    const writes = [_]Rule{
        .{ .path = "C:\\work\\one", .kind = .literal },
        .{ .path = "C:\\work\\tree", .kind = .subtree },
    };
    try std.testing.expect(denied("c:\\WORK\\ONE", "one", &writes, &.{}));
    try std.testing.expect(!denied("C:\\work\\one\\child", "child", &writes, &.{}));
    try std.testing.expect(denied("C:\\work\\tree\\child", "child", &writes, &.{}));
}
