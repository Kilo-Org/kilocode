const std = @import("std");
const protocol = @import("protocol.zig");

const win = @cImport({
    @cDefine("UNICODE", "1");
    @cDefine("_UNICODE", "1");
    @cInclude("windows.h");
    @cInclude("aclapi.h");
    @cInclude("sddl.h");
    @cInclude("userenv.h");
});

const Allocator = std.mem.Allocator;
const W = win.WCHAR;
const Handle = win.HANDLE;
const invalid = @as(Handle, @ptrFromInt(@as(usize, @bitCast(@as(isize, -1)))));
const allow_mask = win.FILE_GENERIC_READ | win.FILE_GENERIC_WRITE | win.FILE_GENERIC_EXECUTE | win.DELETE;
const deny_mask = win.FILE_GENERIC_WRITE | win.DELETE | win.FILE_DELETE_CHILD | win.WRITE_DAC | win.WRITE_OWNER;

const Node = struct {
    handle: Handle,
    path: []u8,
    info: win.BY_HANDLE_FILE_INFORMATION,
};

const Root = struct {
    node: Node,
    sid: win.PSID,
};

fn fail(name: []const u8) noreturn {
    std.debug.print("kilo-sandbox-windows: {s} failed ({d})\n", .{ name, win.GetLastError() });
    std.process.exit(125);
}

fn check(ok: win.BOOL, name: []const u8) void {
    if (ok == 0) fail(name);
}

fn wide(alloc: Allocator, text: []const u8) ![:0]W {
    return std.unicode.utf8ToUtf16LeAllocZ(alloc, text);
}

fn utf8(alloc: Allocator, text: []const W) ![]u8 {
    return std.unicode.utf16LeToUtf8Alloc(alloc, text);
}

fn close(handle: Handle) void {
    if (handle != null and handle != invalid) _ = win.CloseHandle(handle);
}

fn canonical(alloc: Allocator, handle: Handle) ![]u8 {
    var buf: [32768]W = undefined;
    const count = win.GetFinalPathNameByHandleW(handle, &buf, buf.len, win.FILE_NAME_NORMALIZED | win.VOLUME_NAME_DOS);
    if (count == 0 or count >= buf.len) return error.FinalPath;
    const start: usize = if (count >= 4 and std.mem.eql(W, buf[0..4], &[_]W{ '\\', '\\', '?', '\\' })) 4 else 0;
    return utf8(alloc, buf[start..count]);
}

fn open(alloc: Allocator, raw: []const u8, directory: ?bool, access: win.DWORD) !Node {
    if (!protocol.absolute(raw)) return error.NotAbsolute;
    const path = try wide(alloc, raw);
    defer alloc.free(path);
    const handle = win.CreateFileW(path.ptr, access, win.FILE_SHARE_READ | win.FILE_SHARE_WRITE | win.FILE_SHARE_DELETE, null, win.OPEN_EXISTING, win.FILE_FLAG_BACKUP_SEMANTICS | win.FILE_FLAG_OPEN_REPARSE_POINT, null);
    if (handle == invalid) return error.OpenPath;
    errdefer close(handle);
    var info: win.BY_HANDLE_FILE_INFORMATION = undefined;
    if (win.GetFileInformationByHandle(handle, &info) == 0) return error.PathInfo;
    if ((info.dwFileAttributes & win.FILE_ATTRIBUTE_REPARSE_POINT) != 0) return error.ReparsePoint;
    const is_dir = (info.dwFileAttributes & win.FILE_ATTRIBUTE_DIRECTORY) != 0;
    if (directory) |expected| if (is_dir != expected) return error.PathType;
    return .{ .handle = handle, .path = try canonical(alloc, handle), .info = info };
}

fn local(alloc: Allocator, raw: []const u8) !Node {
    const node = try open(alloc, raw, true, win.READ_CONTROL | win.WRITE_DAC);
    errdefer {
        close(node.handle);
        alloc.free(node.path);
    }
    const path = try wide(alloc, node.path);
    defer alloc.free(path);
    var volume: [win.MAX_PATH + 1]W = undefined;
    if (win.GetVolumePathNameW(path.ptr, &volume, volume.len) == 0) return error.VolumePath;
    const vlen = std.mem.indexOfScalar(W, &volume, 0) orelse return error.VolumePath;
    const root = try utf8(alloc, volume[0..vlen]);
    defer alloc.free(root);
    if (std.ascii.eqlIgnoreCase(node.path, root)) return error.VolumeRoot;
    if (win.GetDriveTypeW(&volume) != win.DRIVE_FIXED) return error.NotFixed;
    var fs: [32]W = undefined;
    if (win.GetVolumeInformationW(&volume, null, 0, null, null, null, &fs, fs.len) == 0) return error.VolumeInfo;
    const flen = std.mem.indexOfScalar(W, &fs, 0) orelse return error.VolumeInfo;
    const name = try utf8(alloc, fs[0..flen]);
    defer alloc.free(name);
    if (!std.ascii.eqlIgnoreCase(name, "NTFS")) return error.NotNtfs;
    return node;
}

fn profile(alloc: Allocator) ![]u8 {
    var token: Handle = null;
    check(win.OpenProcessToken(win.GetCurrentProcess(), win.TOKEN_QUERY, &token), "OpenProcessToken");
    defer close(token);
    var size: win.DWORD = 0;
    _ = win.GetUserProfileDirectoryW(token, null, &size);
    if (size == 0) return error.ProfilePath;
    const buf = try alloc.alloc(W, size);
    defer alloc.free(buf);
    if (win.GetUserProfileDirectoryW(token, buf.ptr, &size) == 0) return error.ProfilePath;
    const len = std.mem.indexOfScalar(W, buf, 0) orelse return error.ProfilePath;
    const raw = try utf8(alloc, buf[0..len]);
    defer alloc.free(raw);
    const node = try open(alloc, raw, true, 0);
    defer {
        close(node.handle);
        alloc.free(node.path);
    }
    return alloc.dupe(u8, node.path);
}

fn sid(alloc: Allocator, node: Node) !win.PSID {
    var buf: [96]u8 = undefined;
    const id = (@as(u64, node.info.nFileIndexHigh) << 32) | node.info.nFileIndexLow;
    const text = try protocol.sidText(&buf, node.path, node.info.dwVolumeSerialNumber, id);
    const value = try wide(alloc, text);
    defer alloc.free(value);
    var out: win.PSID = null;
    if (win.ConvertStringSidToSidW(value.ptr, &out) == 0) return error.InvalidSid;
    return out;
}

fn ace(handle: Handle, root_sid: win.PSID, mode: win.ACCESS_MODE, mask: win.DWORD, inherit: win.DWORD) !void {
    var old: win.PACL = null;
    var desc: win.PSECURITY_DESCRIPTOR = null;
    const got = win.GetSecurityInfo(handle, win.SE_FILE_OBJECT, win.DACL_SECURITY_INFORMATION, null, null, &old, null, &desc);
    if (got != win.ERROR_SUCCESS) return error.ReadAcl;
    defer if (desc != null) {
        _ = win.LocalFree(desc);
    };
    var entry = std.mem.zeroes(win.EXPLICIT_ACCESS_W);
    entry.grfAccessPermissions = mask;
    entry.grfAccessMode = mode;
    entry.grfInheritance = inherit;
    entry.Trustee.TrusteeForm = win.TRUSTEE_IS_SID;
    entry.Trustee.TrusteeType = win.TRUSTEE_IS_UNKNOWN;
    entry.Trustee.ptstrName = @ptrCast(@alignCast(root_sid));
    var next: win.PACL = null;
    const made = win.SetEntriesInAclW(1, &entry, old, &next);
    if (made != win.ERROR_SUCCESS) return error.MakeAcl;
    defer if (next != null) {
        _ = win.LocalFree(next);
    };
    const set = win.SetSecurityInfo(handle, win.SE_FILE_OBJECT, win.DACL_SECURITY_INFORMATION, null, null, next, null);
    if (set != win.ERROR_SUCCESS) return error.WriteAcl;
}

fn leaf(path: []const u8) []const u8 {
    const at = std.mem.lastIndexOfAny(u8, path, "\\/") orelse return path;
    return path[at + 1 ..];
}

fn scan(alloc: Allocator, path: []const u8, root_sid: win.PSID, req: protocol.Request) !void {
    const node = try open(alloc, path, null, win.READ_CONTROL | win.WRITE_DAC);
    defer {
        close(node.handle);
        alloc.free(node.path);
    }
    const directory = (node.info.dwFileAttributes & win.FILE_ATTRIBUTE_DIRECTORY) != 0;
    if (!directory and node.info.nNumberOfLinks != 1) return error.Hardlink;
    const inherit: win.DWORD = if (directory) win.SUB_CONTAINERS_AND_OBJECTS_INHERIT else win.NO_INHERITANCE;
    try ace(node.handle, root_sid, win.GRANT_ACCESS, allow_mask, inherit);
    if (protocol.denied(node.path, leaf(node.path), req.denyWrite, req.denyNames))
        try ace(node.handle, root_sid, win.DENY_ACCESS, deny_mask, inherit);
    if (!directory) return;
    const pattern = try std.fmt.allocPrint(alloc, "{s}\\*", .{node.path});
    defer alloc.free(pattern);
    const wpattern = try wide(alloc, pattern);
    defer alloc.free(wpattern);
    var data: win.WIN32_FIND_DATAW = undefined;
    const find = win.FindFirstFileW(wpattern.ptr, &data);
    if (find == invalid) {
        if (win.GetLastError() == win.ERROR_FILE_NOT_FOUND) return;
        return error.ScanTree;
    }
    defer _ = win.FindClose(find);
    while (true) {
        const len = std.mem.indexOfScalar(W, &data.cFileName, 0) orelse return error.ScanTree;
        const name = try utf8(alloc, data.cFileName[0..len]);
        defer alloc.free(name);
        if (!std.mem.eql(u8, name, ".") and !std.mem.eql(u8, name, "..")) {
            const child = try std.fmt.allocPrint(alloc, "{s}\\{s}", .{ node.path, name });
            defer alloc.free(child);
            try scan(alloc, child, root_sid, req);
        }
        if (win.FindNextFileW(find, &data) == 0) {
            if (win.GetLastError() != win.ERROR_NO_MORE_FILES) return error.ScanTree;
            break;
        }
    }
}

fn quote(list: *std.ArrayList(u8), alloc: Allocator, arg: []const u8) !void {
    try list.append(alloc, '"');
    var slashes: usize = 0;
    for (arg) |char| {
        if (char == '\\') {
            slashes += 1;
            continue;
        }
        if (char == '"') {
            try list.appendNTimes(alloc, '\\', slashes * 2 + 1);
            try list.append(alloc, '"');
            slashes = 0;
            continue;
        }
        try list.appendNTimes(alloc, '\\', slashes);
        slashes = 0;
        try list.append(alloc, char);
    }
    try list.appendNTimes(alloc, '\\', slashes * 2);
    try list.append(alloc, '"');
}

fn command(alloc: Allocator, req: protocol.Request) ![:0]W {
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(alloc);
    try quote(&out, alloc, req.command);
    for (req.args) |arg| {
        try out.append(alloc, ' ');
        try quote(&out, alloc, arg);
    }
    return wide(alloc, out.items);
}

fn verify(token: Handle, expected: win.DWORD) !void {
    if (win.IsTokenRestricted(token) == 0) return error.UnrestrictedToken;
    var size: win.DWORD = 0;
    _ = win.GetTokenInformation(token, win.TokenRestrictedSids, null, 0, &size);
    if (size == 0) return error.MissingRestrictedSids;
    const buf = try std.heap.page_allocator.alloc(u8, size);
    defer std.heap.page_allocator.free(buf);
    if (win.GetTokenInformation(token, win.TokenRestrictedSids, buf.ptr, size, &size) == 0) return error.RestrictedSidInfo;
    const groups: *win.TOKEN_GROUPS = @ptrCast(@alignCast(buf.ptr));
    if (groups.GroupCount == 0 or groups.GroupCount != expected) return error.MissingRestrictedSids;
}

fn defaults(alloc: Allocator, token: Handle, roots: []const Root) !void {
    var size: win.DWORD = 0;
    _ = win.GetTokenInformation(token, win.TokenUser, null, 0, &size);
    if (size == 0) return error.MissingTokenUser;
    const buf = try alloc.alignedAlloc(u8, .of(usize), size);
    defer alloc.free(buf);
    if (win.GetTokenInformation(token, win.TokenUser, buf.ptr, size, &size) == 0) return error.TokenUserInfo;
    const user: *win.TOKEN_USER = @ptrCast(@alignCast(buf.ptr));

    const entries = try alloc.alloc(win.EXPLICIT_ACCESS_W, roots.len + 1);
    defer alloc.free(entries);
    for (entries, 0..) |*entry, i| {
        entry.* = std.mem.zeroes(win.EXPLICIT_ACCESS_W);
        entry.grfAccessPermissions = win.GENERIC_ALL;
        entry.grfAccessMode = win.GRANT_ACCESS;
        entry.grfInheritance = win.NO_INHERITANCE;
        entry.Trustee.TrusteeForm = win.TRUSTEE_IS_SID;
        entry.Trustee.TrusteeType = win.TRUSTEE_IS_UNKNOWN;
        const value = if (i == 0) user.User.Sid else roots[i - 1].sid;
        entry.Trustee.ptstrName = @ptrCast(@alignCast(value));
    }
    var acl: win.PACL = null;
    if (win.SetEntriesInAclW(@intCast(entries.len), entries.ptr, null, &acl) != win.ERROR_SUCCESS) return error.MakeDefaultAcl;
    defer if (acl != null) {
        _ = win.LocalFree(acl);
    };
    var info = std.mem.zeroes(win.TOKEN_DEFAULT_DACL);
    info.DefaultDacl = acl;
    if (win.SetTokenInformation(token, win.TokenDefaultDacl, &info, @sizeOf(win.TOKEN_DEFAULT_DACL)) == 0) return error.SetDefaultAcl;
}

fn run(alloc: Allocator, req: protocol.Request) !u32 {
    if (!protocol.absolute(req.command) or !protocol.absolute(req.cwd)) return error.NotAbsolute;
    const exe = try open(alloc, req.command, false, 0);
    defer {
        close(exe.handle);
        alloc.free(exe.path);
    }
    const cwd = try open(alloc, req.cwd, true, 0);
    defer {
        close(cwd.handle);
        alloc.free(cwd.path);
    }
    const home = try profile(alloc);
    defer alloc.free(home);
    var roots = try alloc.alloc(Root, req.allowWrite.len);
    defer alloc.free(roots);
    var count: usize = 0;
    errdefer for (roots[0..count]) |root| {
        close(root.node.handle);
        alloc.free(root.node.path);
        if (root.sid != null) _ = win.LocalFree(root.sid);
    };
    for (req.allowWrite, 0..) |rule, i| {
        const node = try local(alloc, rule.path);
        errdefer {
            close(node.handle);
            alloc.free(node.path);
        }
        if (std.ascii.eqlIgnoreCase(node.path, home)) return error.UserProfileRoot;
        const root_sid = try sid(alloc, node);
        roots[i] = .{ .node = node, .sid = root_sid };
        count += 1;
        try scan(alloc, node.path, root_sid, req);
    }
    defer for (roots) |root| {
        close(root.node.handle);
        alloc.free(root.node.path);
        if (root.sid != null) _ = win.LocalFree(root.sid);
    };

    var source: Handle = null;
    const access = win.TOKEN_DUPLICATE | win.TOKEN_QUERY | win.TOKEN_ASSIGN_PRIMARY | win.TOKEN_ADJUST_DEFAULT | win.TOKEN_ADJUST_SESSIONID | win.TOKEN_ADJUST_PRIVILEGES;
    check(win.OpenProcessToken(win.GetCurrentProcess(), access, &source), "OpenProcessToken");
    defer close(source);
    const groups = try alloc.alloc(win.SID_AND_ATTRIBUTES, roots.len);
    defer alloc.free(groups);
    for (roots, 0..) |root, i| groups[i] = .{ .Sid = root.sid, .Attributes = 0 };
    var restricted: Handle = null;
    check(win.CreateRestrictedToken(source, win.DISABLE_MAX_PRIVILEGE | win.LUA_TOKEN | win.WRITE_RESTRICTED, 0, null, 0, null, @intCast(groups.len), groups.ptr, &restricted), "CreateRestrictedToken");
    defer close(restricted);
    try verify(restricted, @intCast(groups.len));
    // The default descriptor must satisfy both the normal user-SID check and the
    // WRITE_RESTRICTED capability-SID check for process-private kernel objects.
    try defaults(alloc, restricted, roots);

    var handles = [_]Handle{ win.GetStdHandle(win.STD_INPUT_HANDLE), win.GetStdHandle(win.STD_OUTPUT_HANDLE), win.GetStdHandle(win.STD_ERROR_HANDLE) };
    for (handles) |handle| {
        if (handle == null or handle == invalid) return error.InvalidStdHandle;
        check(win.SetHandleInformation(handle, win.HANDLE_FLAG_INHERIT, win.HANDLE_FLAG_INHERIT), "SetHandleInformation");
    }
    var size: win.SIZE_T = 0;
    _ = win.InitializeProcThreadAttributeList(null, 1, 0, &size);
    const attrs = try alloc.alignedAlloc(u8, .of(usize), size);
    defer alloc.free(attrs);
    const list: win.LPPROC_THREAD_ATTRIBUTE_LIST = @ptrCast(attrs.ptr);
    check(win.InitializeProcThreadAttributeList(list, 1, 0, &size), "InitializeProcThreadAttributeList");
    defer win.DeleteProcThreadAttributeList(list);
    check(win.UpdateProcThreadAttribute(list, 0, win.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles, @sizeOf(@TypeOf(handles)), null, null), "UpdateProcThreadAttribute");

    var start = std.mem.zeroes(win.STARTUPINFOEXW);
    start.StartupInfo.cb = @sizeOf(win.STARTUPINFOEXW);
    start.StartupInfo.dwFlags = win.STARTF_USESTDHANDLES;
    start.StartupInfo.hStdInput = handles[0];
    start.StartupInfo.hStdOutput = handles[1];
    start.StartupInfo.hStdError = handles[2];
    start.lpAttributeList = list;
    var proc: win.PROCESS_INFORMATION = undefined;
    const line = try command(alloc, req);
    defer alloc.free(line);
    const wexe = try wide(alloc, exe.path);
    defer alloc.free(wexe);
    const wcwd = try wide(alloc, cwd.path);
    defer alloc.free(wcwd);
    check(win.CreateProcessAsUserW(restricted, wexe.ptr, line.ptr, null, null, 1, win.CREATE_SUSPENDED | win.CREATE_UNICODE_ENVIRONMENT | win.CREATE_NO_WINDOW | win.EXTENDED_STARTUPINFO_PRESENT, null, wcwd.ptr, &start.StartupInfo, &proc), "CreateProcessAsUserW");
    defer close(proc.hThread);
    defer close(proc.hProcess);
    defer _ = win.TerminateProcess(proc.hProcess, 125);
    const job = win.CreateJobObjectW(null, null);
    if (job == null) fail("CreateJobObjectW");
    defer close(job);
    var limits = std.mem.zeroes(win.JOBOBJECT_EXTENDED_LIMIT_INFORMATION);
    limits.BasicLimitInformation.LimitFlags = win.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    check(win.SetInformationJobObject(job, win.JobObjectExtendedLimitInformation, &limits, @sizeOf(@TypeOf(limits))), "SetInformationJobObject");
    check(win.AssignProcessToJobObject(job, proc.hProcess), "AssignProcessToJobObject");
    const current = try alloc.alloc(win.BY_HANDLE_FILE_INFORMATION, roots.len);
    defer alloc.free(current);
    for (roots, 0..) |root, i| {
        if (win.GetFileInformationByHandle(root.node.handle, &current[i]) == 0) return error.PathInfo;
        if (current[i].dwVolumeSerialNumber != root.node.info.dwVolumeSerialNumber or
            current[i].nFileIndexHigh != root.node.info.nFileIndexHigh or
            current[i].nFileIndexLow != root.node.info.nFileIndexLow) return error.RootChanged;
    }
    if (win.ResumeThread(proc.hThread) == @as(win.DWORD, 0xffffffff)) fail("ResumeThread");
    if (win.WaitForSingleObject(proc.hProcess, win.INFINITE) != win.WAIT_OBJECT_0) fail("WaitForSingleObject");
    var code: win.DWORD = 0;
    check(win.GetExitCodeProcess(proc.hProcess, &code), "GetExitCodeProcess");
    if (code != 0) std.debug.print("kilo-sandbox-windows: target exited {d}\n", .{code});
    return code;
}

fn execute(init: std.process.Init) !u32 {
    const alloc = init.gpa;
    var args = try init.minimal.args.iterateAllocator(alloc);
    defer args.deinit();
    _ = args.next() orelse return error.RequestArgumentRequired;
    const flag = args.next() orelse return error.RequestArgumentRequired;
    if (!std.mem.eql(u8, flag, "--request")) return error.RequestArgumentRequired;
    const path = args.next() orelse return error.RequestArgumentRequired;
    if (args.next() != null) return error.RequestArgumentRequired;
    const file = try std.Io.Dir.openFile(.cwd(), init.io, path, .{});
    defer file.close(init.io);
    const data = try alloc.alloc(u8, protocol.max_request + 1);
    const len = try file.readPositionalAll(init.io, data, 0);
    const parsed = try protocol.parse(alloc, data[0..len]);
    defer parsed.deinit();

    // RELEASE BLOCKERS: provisioning is not race-proof against concurrent tree mutation;
    // additive ACEs persist without an ownership journal/recovery mechanism, and restoring
    // stale whole DACLs is forbidden; denyNames only protects entries present during this
    // scan; process containment still needs an independent parent-death lease.
    return run(alloc, parsed.value);
}

pub fn main(init: std.process.Init) void {
    const code = execute(init) catch |err| {
        std.debug.print("kilo-sandbox-windows: setup failed: {s}\n", .{@errorName(err)});
        std.process.exit(125);
    };
    std.process.exit(@truncate(code));
}

comptime {
    if (@import("builtin").os.tag != .windows and !@import("builtin").is_test)
        @compileError("kilo-sandbox-windows only targets Windows");
}
