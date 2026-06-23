const std = @import("std");
const builtin = @import("builtin");

pub fn build(b: *std.Build) void {
    if (builtin.zig_version.major != 0 or builtin.zig_version.minor != 16 or builtin.zig_version.patch != 0)
        @panic("kilo-sandbox-windows requires Zig 0.16.0 exactly");
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    if (optimize != .Debug) @panic("kilo-sandbox-windows currently supports Debug builds only due Zig 0.16 MinGW header translation errors");

    const exe = b.addExecutable(.{
        .name = "kilo-sandbox-windows",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    exe.root_module.linkSystemLibrary("c", .{});
    exe.root_module.linkSystemLibrary("advapi32", .{});
    exe.root_module.linkSystemLibrary("kernel32", .{});
    exe.root_module.linkSystemLibrary("userenv", .{});
    b.installArtifact(exe);

    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/protocol.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        }),
    });
    tests.root_module.linkSystemLibrary("c", .{});
    const run = b.addRunArtifact(tests);
    const step = b.step("test", "Run unit tests");
    step.dependOn(&run.step);
}
