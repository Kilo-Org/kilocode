const std = @import("std");

fn write(init: std.process.Init, key: []const u8) bool {
    const path = init.environ_map.get(key) orelse return false;
    const file = std.Io.Dir.createFileAbsolute(init.io, path, .{}) catch return false;
    defer file.close(init.io);
    file.writeStreamingAll(init.io, "probe") catch return false;
    return true;
}

pub fn main(init: std.process.Init) u8 {
    const project = write(init, "KILO_PROBE_PROJECT");
    const external = write(init, "KILO_PROBE_EXTERNAL");
    const git = write(init, "KILO_PROBE_GIT");
    const temp = write(init, "KILO_PROBE_TEMP");
    return if (project and !external and !git and temp) 0 else 2;
}
