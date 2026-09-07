import path from "path"
import { mutates as mutatesGit } from "@/kilocode/sandbox/git"
import type { FileEffect, GitAction, NormalizedProcess, PackageAction } from "./types"

/**
 * Static semantics of individual commands: which operands are read, written or deleted, whether the
 * command escalates privileges, feeds a shell or interpreter, reaches the network, or touches
 * package registries. Everything here is keyed by the resolved executable plus its arguments; the
 * decision itself is made by the rules over classified paths, never by the executable name alone.
 */
export namespace CommandSemantics {
  export type Kind = "bash" | "powershell" | "cmd"

  export interface Unwrapped {
    executable?: string
    argv: string[]
    wrapper?: string
    privileged: boolean
    stdinTargets: boolean
    /** `env -C dir` / `sudo -D dir` style working directory overrides. */
    chdir?: string
    /** Environment assignments that alter what a later command executes (LD_PRELOAD, BASH_ENV, ...). */
    hijack: boolean
    /** Static `NAME=value` assignments seen while unwrapping (`env X=1 cmd`, `X=1 cmd`), dequoted. */
    assignments: Record<string, string>
  }

  export interface Spec {
    effect?: FileEffect
    recursive: boolean
    force: boolean
    /** Operands with the effect applied to each; `within` marks commands acting on directory entries. */
    operands: { value: string; effect: FileEffect; within?: boolean }[]
    /** Operands whose value is opaque (patterns, modes) are excluded from `operands`. */
    indirection?: NormalizedProcess["indirection"]
    /** Static payload for shell / interpreter indirection; undefined when there is none or it is dynamic. */
    payload?: { text: string; kind: Kind }
    /** The payload comes from a script file rather than an inline string. */
    script?: string
    encoded: boolean
    network: boolean
    /** A network URL operand, when the command targets one (curl/wget/...). */
    url?: string
    git?: GitAction
    pkg?: PackageAction
    family?: NormalizedProcess["family"]
    /** Options that make an otherwise benign command execute an arbitrary program. */
    escape?: string
    /** Reads content of its operands (as opposed to metadata-only commands like ls/stat). */
    reads: boolean
    /** Metadata-only command (ls, stat, file, du ...). */
    metadata: boolean
    /** The command carries arguments the analyser could not attribute (Start-Process -ArgumentList). */
    dynamic?: boolean
  }

  const PRIVILEGE = new Set(["sudo", "doas", "su", "pkexec", "runas", "gsudo", "sudo-rs", "run0", "dzdo", "pfexec"])
  const SUDO_VALUE = new Set([
    "-u",
    "-g",
    "-p",
    "-C",
    "-D",
    "-h",
    "-r",
    "-t",
    "-U",
    "-T",
    "--user",
    "--group",
    "--chdir",
  ])
  const WRAPPERS = new Set([
    "env",
    "nohup",
    "nice",
    "time",
    "command",
    "builtin",
    "exec",
    "timeout",
    "caffeinate",
    "stdbuf",
    "ionice",
    "watch",
    "chronic",
    "unbuffer",
    "xargs",
    "parallel",
    "gtimeout",
    "flock",
    "setsid",
    "strace",
    "ltrace",
    "hyperfine",
  ])
  const WRAPPER_VALUE: Record<string, Set<string>> = {
    env: new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]),
    nice: new Set(["-n", "--adjustment"]),
    timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
    gtimeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
    ionice: new Set(["-c", "-n", "-p", "--class", "--classdata"]),
    stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
    watch: new Set(["-n", "--interval", "-d", "--differences"]),
    xargs: new Set([
      "-I",
      "-n",
      "-P",
      "-L",
      "-d",
      "-E",
      "-s",
      "-a",
      "--max-args",
      "--max-procs",
      "--delimiter",
      "--arg-file",
    ]),
    parallel: new Set(["-j", "--jobs", "-a", "--arg-file"]),
    flock: new Set(["-w", "--timeout", "-E", "--conflict-exit-code"]),
    strace: new Set(["-e", "-o", "-p", "-s"]),
    ltrace: new Set(["-e", "-o", "-p", "-s"]),
    "systemd-run": new Set(["-p", "--property", "--unit", "-u", "--on-active", "--on-boot"]),
  }
  const POSITIONAL_WRAPPER = new Set(["timeout", "gtimeout", "flock"])
  const HIJACK_ENV =
    /^(LD_PRELOAD|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|BASH_ENV|ENV|PROMPT_COMMAND|GIT_SSH_COMMAND|GIT_SSH|GIT_EXTERNAL_DIFF|GIT_PAGER|PAGER|EDITOR|VISUAL|PERL5OPT|PYTHONSTARTUP|PYTHONPATH|NODE_OPTIONS|RUBYOPT|SHELL|IFS|PATH|GIT_CONFIG_GLOBAL|GIT_CONFIG_SYSTEM|GIT_DIR|GIT_WORK_TREE)=/

  const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "ash", "fish", "csh", "tcsh", "busybox"])
  const POWERSHELLS = new Set(["powershell", "pwsh"])
  const CMD = new Set(["cmd"])
  const INTERPRETERS: Record<string, Set<string>> = {
    python: new Set(["-c"]),
    python2: new Set(["-c"]),
    python3: new Set(["-c"]),
    pypy: new Set(["-c"]),
    pypy3: new Set(["-c"]),
    uv: new Set(["-c"]),
    node: new Set(["-e", "-p", "--eval", "--print", "-i", "--interactive"]),
    nodejs: new Set(["-e", "-p", "--eval", "--print"]),
    bun: new Set(["-e", "--eval", "-p", "--print"]),
    deno: new Set(["eval"]),
    ruby: new Set(["-e"]),
    perl: new Set(["-e", "-E"]),
    php: new Set(["-r"]),
    lua: new Set(["-e"]),
    luajit: new Set(["-e"]),
    tclsh: new Set([]),
    osascript: new Set(["-e"]),
    rscript: new Set(["-e"]),
    r: new Set(["-e"]),
    julia: new Set(["-e", "-E"]),
    elixir: new Set(["-e"]),
    erl: new Set(["-eval"]),
    groovy: new Set(["-e"]),
    scala: new Set(["-e"]),
    swift: new Set(["-e"]),
    expect: new Set(["-c"]),
    awk: new Set([]),
    gawk: new Set([]),
    mawk: new Set([]),
    nawk: new Set([]),
  }

  const DELETE = new Set([
    "rm",
    "rmdir",
    "unlink",
    "shred",
    "srm",
    "trash",
    "rmtrash",
    "remove-item",
    "del",
    "erase",
    "rd",
  ])
  const READERS = new Set([
    "cat",
    "head",
    "tail",
    "less",
    "more",
    "most",
    "bat",
    "strings",
    "xxd",
    "hexdump",
    "hd",
    "od",
    "base64",
    "base32",
    "uuencode",
    "wc",
    "sha1sum",
    "sha256sum",
    "sha512sum",
    "md5sum",
    "md5",
    "shasum",
    "cksum",
    "cut",
    "sort",
    "uniq",
    "tac",
    "rev",
    "nl",
    "fold",
    "fmt",
    "pr",
    "expand",
    "unexpand",
    "column",
    "paste",
    "join",
    "comm",
    "diff",
    "cmp",
    "grep",
    "egrep",
    "fgrep",
    "zgrep",
    "rg",
    "ag",
    "ack",
    "jq",
    "yq",
    "awk",
    "gawk",
    "mawk",
    "nawk",
    "sed",
    "gsed",
    "iconv",
    "zcat",
    "bzcat",
    "xzcat",
    "gunzip",
    "gzip",
    "bzip2",
    "xz",
    "zstd",
    "openssl",
    "gpg",
    "gpg2",
    "ssh-keygen",
    "scp",
    "rsync",
    "tar",
    "zip",
    "unzip",
    "7z",
    "get-content",
    "type",
    "select-string",
    "measure-object",
    "ssh-add",
  ])
  const METADATA = new Set([
    "ls",
    "dir",
    "stat",
    "file",
    "du",
    "df",
    "test",
    "[",
    "[[",
    "tree",
    "readlink",
    "realpath",
    "basename",
    "dirname",
    "which",
    "whereis",
    "locate",
    "pwd",
    "echo",
    "printf",
    "true",
    "false",
    "date",
    "uname",
    "whoami",
    "id",
    "hostname",
    "env",
    "printenv",
    "sleep",
    "seq",
    "exit",
    "return",
    "export",
    "alias",
    "unalias",
    "set",
    "unset",
    "shopt",
    "hash",
    "history",
    "jobs",
    "bg",
    "fg",
    "wait",
    "ps",
    "top",
    "htop",
    "lsof",
    "netstat",
    "ss",
    "ifconfig",
    "ping",
    "traceroute",
    "dig",
    "nslookup",
    "host",
    "whois",
    "get-childitem",
    "get-item",
    "get-location",
    "test-path",
    "write-output",
    "write-host",
    "get-date",
    "get-process",
    "get-service",
    "get-command",
    "resolve-path",
    "man",
    "help",
    "info",
    "tldr",
    "declare",
    "local",
    "readonly",
    "typeset",
    "let",
    "eval",
    ":",
    "cd",
    "pushd",
    "popd",
    "chdir",
    "set-location",
    "push-location",
    "pop-location",
  ])
  const WRITERS: Record<
    string,
    { mode: "all" | "last" | "first-mode" | "after-script" | "dest-flag"; append?: boolean }
  > = {
    tee: { mode: "all" },
    touch: { mode: "all" },
    mkdir: { mode: "all" },
    truncate: { mode: "all" },
    "new-item": { mode: "all" },
    "set-content": { mode: "all" },
    "add-content": { mode: "all" },
    "out-file": { mode: "all" },
    "tee-object": { mode: "all" },
    "clear-content": { mode: "all" },
    cp: { mode: "last" },
    mv: { mode: "last" },
    install: { mode: "last" },
    ln: { mode: "last" },
    rsync: { mode: "last" },
    "copy-item": { mode: "last" },
    "move-item": { mode: "last" },
    "rename-item": { mode: "last" },
    copy: { mode: "last" },
    move: { mode: "last" },
    ren: { mode: "last" },
    rename: { mode: "last" },
    chmod: { mode: "first-mode" },
    chown: { mode: "first-mode" },
    chgrp: { mode: "first-mode" },
    chattr: { mode: "first-mode" },
    chflags: { mode: "first-mode" },
    setfacl: { mode: "first-mode" },
    xattr: { mode: "first-mode" },
    icacls: { mode: "all" },
    takeown: { mode: "all" },
  }
  const CHMOD = new Set(["chmod", "chown", "chgrp", "chattr", "chflags", "setfacl", "xattr", "icacls", "takeown"])
  const FETCHERS = new Set([
    "curl",
    "wget",
    "fetch",
    "aria2c",
    "http",
    "https",
    "httpie",
    "xh",
    "invoke-webrequest",
    "invoke-restmethod",
  ])
  const NETWORK = new Set([
    ...FETCHERS,
    "nc",
    "ncat",
    "netcat",
    "socat",
    "telnet",
    "ftp",
    "sftp",
    "ssh",
    "scp",
    "rsync",
    "nmap",
    "masscan",
    "mail",
    "mailx",
    "sendmail",
    "mutt",
    "openssl",
    "gh",
    "glab",
    "aws",
    "gcloud",
    "az",
    "kubectl",
    "helm",
    "terraform",
    "tofu",
    "pulumi",
    "ansible",
    "ansible-playbook",
    "vault",
    "consul",
    "doctl",
    "flyctl",
    "fly",
    "vercel",
    "netlify",
    "heroku",
    "firebase",
    "sfdx",
    "sf",
    "serverless",
    "sls",
    "cdk",
    "sst",
    "wrangler",
    "supabase",
    "railway",
    "render",
    "twilio",
    "stripe",
    "ngrok",
    "cloudflared",
    "tailscale",
  ])
  const DECODERS = new Set([
    "base64",
    "base32",
    "xxd",
    "uudecode",
    "openssl",
    "gunzip",
    "zcat",
    "bzcat",
    "xzcat",
    "unxz",
    "bunzip2",
    "python",
    "python3",
    "perl",
    "iconv",
  ])
  const DEVICE = new Set([
    "mkfs",
    "mke2fs",
    "mkswap",
    "fdisk",
    "sfdisk",
    "cfdisk",
    "gdisk",
    "sgdisk",
    "parted",
    "gparted",
    "wipefs",
    "blkdiscard",
    "badblocks",
    "hdparm",
    "nvme",
    "cryptsetup",
    "zpool",
    "zfs",
    "lvremove",
    "vgremove",
    "pvremove",
    "mdadm",
    "diskpart",
    "format",
    "format-volume",
    "clear-disk",
    "remove-partition",
    "initialize-disk",
    "diskutil",
    "asr",
  ])
  const DEVICE_SAFE_SUB = new Set(["list", "info", "activity", "apfs list", "status", "--version", "-l", "--list"])
  const SYSTEM_CONTROL = new Set([
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init",
    "telinit",
    "systemctl",
    "service",
    "launchctl",
    "crontab",
    "at",
    "batch",
    "sysctl",
    "modprobe",
    "insmod",
    "rmmod",
    "kextload",
    "kextunload",
    "mount",
    "umount",
    "swapon",
    "swapoff",
    "iptables",
    "ip6tables",
    "nft",
    "ufw",
    "pfctl",
    "firewall-cmd",
    "useradd",
    "userdel",
    "usermod",
    "adduser",
    "deluser",
    "passwd",
    "chpasswd",
    "groupadd",
    "groupdel",
    "dscl",
    "visudo",
    "csrutil",
    "spctl",
    "nvram",
    "setenforce",
    "systemsetup",
    "defaults",
    "schtasks",
    "sc",
    "bcdedit",
    "reg",
    "net",
    "wmic",
    "stop-computer",
    "restart-computer",
    "set-executionpolicy",
    "set-mppreference",
    "add-mppreference",
    "set-itemproperty",
    "new-itemproperty",
    "register-scheduledtask",
    "register-scheduledjob",
    "new-scheduledtask",
    "set-scheduledtask",
    "new-service",
    "set-service",
    "new-jobtrigger",
    "chroot",
    "unshare",
    "nsenter",
    "systemd-run",
    "timedatectl",
    "hostnamectl",
    "localectl",
    "loginctl",
    "dpkg",
    "rpm",
    "authselect",
    "pam-auth-update",
  ])
  const SYSTEM_DENY = new Set([
    "register-scheduledtask",
    "register-scheduledjob",
    "new-service",
    "shutdown",
    "reboot",
    "halt",
    "poweroff",
    "init",
    "telinit",
    "kextload",
    "kextunload",
    "passwd",
    "chpasswd",
    "userdel",
    "visudo",
    "csrutil",
    "spctl",
    "nvram",
    "setenforce",
    "bcdedit",
    "stop-computer",
    "restart-computer",
    "set-mppreference",
    "add-mppreference",
  ])
  const SYSTEM_READ = new Set([
    "status",
    "show",
    "list",
    "list-units",
    "list-timers",
    "is-active",
    "is-enabled",
    "is-failed",
    "cat",
    "get-default",
    "-l",
    "--list",
    "print",
    "read",
    "query",
    "-a",
    "-n",
    "-t",
    "/query",
    "/q",
    "query",
    "get",
    "is-system-running",
  ])
  const PROCESS_CONTROL = new Set(["kill", "pkill", "killall", "stop-process", "taskkill"])
  const PROCESS_DENY =
    /^(-1|1|--all|init|launchd|systemd|kernel_task|windowserver|loginwindow|sshd|kilo|kilo-serve|csrss|winlogon|wininit|lsass)$/i
  const CONTAINERS = new Set([
    "docker",
    "podman",
    "nerdctl",
    "docker-compose",
    "kubectl",
    "oc",
    "lima",
    "limactl",
    "colima",
  ])
  const CONTAINER_DESTRUCTIVE =
    /^(system prune|rmi|volume rm|volume prune|image prune|container prune|network prune|down -v|drain|delete|cordon)/
  const CONTAINER_ESCAPE =
    /^(--privileged|--pid=host|--net=host|--network=host|--userns=host|--cap-add(=|$)|--security-opt|--device(=|$)|\/:|--mount=.*source=\/(,|$)|.*source=\/(,|$))/
  const PERSISTENCE = new Set(["crontab", "at", "batch", "launchctl", "schtasks", "sc", "systemd-run", "loginctl"])

  const PACKAGE_MANAGERS: Record<
    string,
    { system: boolean; install: Set<string>; publish: Set<string>; fetch: Set<string>; run: Set<string> }
  > = {
    npm: {
      system: false,
      // `ci` / `install-ci-test` / `install-test` install from the manifest and run every dependency's
      // install-time scripts, exactly like a bare `npm install`; they are installs, not project scripts.
      install: new Set([
        "install",
        "i",
        "add",
        "in",
        "ins",
        "isntall",
        "isntal",
        "up",
        "update",
        "upgrade",
        "ci",
        "clean-install",
        "install-clean",
        "isntall-clean",
        "install-ci-test",
        "cit",
        "install-test",
        "it",
      ]),
      publish: new Set(["publish", "login", "adduser", "token", "deprecate", "unpublish", "owner"]),
      fetch: new Set(["exec", "x"]),
      run: new Set(["run", "run-script", "test", "start", "build", "rebuild"]),
    },
    pnpm: {
      system: false,
      install: new Set(["add", "install", "i", "update", "up", "upgrade"]),
      publish: new Set(["publish", "login", "deprecate", "unpublish"]),
      fetch: new Set(["dlx", "exec", "x"]),
      run: new Set(["run", "test", "start", "build"]),
    },
    yarn: {
      system: false,
      install: new Set(["add", "install", "up", "upgrade"]),
      publish: new Set(["publish", "login", "npm"]),
      fetch: new Set(["dlx", "create", "exec"]),
      run: new Set(["run", "test", "start", "build"]),
    },
    bun: {
      system: false,
      install: new Set(["add", "install", "i", "update", "upgrade"]),
      publish: new Set(["publish", "pm"]),
      fetch: new Set(["x"]),
      run: new Set(["run", "test", "build"]),
    },
    bunx: { system: false, install: new Set([]), publish: new Set([]), fetch: new Set(["*"]), run: new Set([]) },
    npx: { system: false, install: new Set([]), publish: new Set([]), fetch: new Set(["*"]), run: new Set([]) },
    pip: {
      system: false,
      install: new Set(["install", "download"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    pip3: {
      system: false,
      install: new Set(["install", "download"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    pipx: {
      system: false,
      install: new Set(["install", "upgrade", "inject"]),
      publish: new Set([]),
      fetch: new Set(["run"]),
      run: new Set([]),
    },
    uv: {
      system: false,
      install: new Set(["add", "pip"]),
      publish: new Set(["publish"]),
      fetch: new Set(["tool", "x"]),
      run: new Set(["run", "sync", "lock"]),
    },
    uvx: { system: false, install: new Set([]), publish: new Set([]), fetch: new Set(["*"]), run: new Set([]) },
    poetry: {
      system: false,
      install: new Set(["add"]),
      publish: new Set(["publish"]),
      fetch: new Set([]),
      run: new Set(["run", "install", "lock"]),
    },
    pipenv: {
      system: false,
      install: new Set(["install"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set(["run"]),
    },
    conda: {
      system: false,
      install: new Set(["install", "create", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set(["run"]),
    },
    mamba: {
      system: false,
      install: new Set(["install", "create", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set(["run"]),
    },
    cargo: {
      system: false,
      install: new Set(["add", "install"]),
      publish: new Set(["publish", "login", "owner", "yank"]),
      fetch: new Set([]),
      run: new Set(["build", "run", "test", "check", "clippy", "fmt", "bench"]),
    },
    go: {
      system: false,
      install: new Set(["get", "install"]),
      publish: new Set([]),
      fetch: new Set(["run"]),
      run: new Set(["build", "test", "vet", "mod", "fmt", "generate"]),
    },
    gem: {
      system: false,
      install: new Set(["install", "update"]),
      publish: new Set(["push", "yank", "owner", "signin"]),
      fetch: new Set([]),
      run: new Set([]),
    },
    bundle: {
      system: false,
      install: new Set(["add", "install", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set(["exec"]),
    },
    composer: {
      system: false,
      install: new Set(["require", "global", "update"]),
      publish: new Set([]),
      fetch: new Set(["create-project"]),
      run: new Set(["install", "run", "run-script"]),
    },
    mix: {
      system: false,
      install: new Set(["deps.get", "archive.install", "escript.install"]),
      publish: new Set(["hex.publish"]),
      fetch: new Set([]),
      run: new Set([]),
    },
    dotnet: {
      system: false,
      install: new Set(["add", "tool"]),
      publish: new Set(["nuget"]),
      fetch: new Set([]),
      run: new Set(["build", "run", "test", "restore"]),
    },
    nuget: {
      system: false,
      install: new Set(["install"]),
      publish: new Set(["push"]),
      fetch: new Set([]),
      run: new Set([]),
    },
    mvn: {
      system: false,
      install: new Set(["dependency:get"]),
      publish: new Set(["deploy"]),
      fetch: new Set([]),
      run: new Set(["compile", "test", "package", "install", "verify"]),
    },
    gradle: {
      system: false,
      install: new Set([]),
      publish: new Set(["publish", "publishToMavenLocal", "uploadArchives"]),
      fetch: new Set([]),
      run: new Set(["build", "test", "assemble"]),
    },
    twine: { system: false, install: new Set([]), publish: new Set(["upload"]), fetch: new Set([]), run: new Set([]) },
    brew: {
      system: true,
      install: new Set([
        "install",
        "reinstall",
        "upgrade",
        "tap",
        "uninstall",
        "remove",
        "rm",
        "link",
        "unlink",
        "services",
      ]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    port: {
      system: true,
      install: new Set(["install", "upgrade", "uninstall"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    apt: {
      system: true,
      install: new Set([
        "install",
        "remove",
        "purge",
        "upgrade",
        "dist-upgrade",
        "full-upgrade",
        "autoremove",
        "update",
      ]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    "apt-get": {
      system: true,
      install: new Set(["install", "remove", "purge", "upgrade", "dist-upgrade", "autoremove", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    yum: {
      system: true,
      install: new Set(["install", "remove", "erase", "update", "upgrade"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    dnf: {
      system: true,
      install: new Set(["install", "remove", "erase", "update", "upgrade"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    pacman: {
      system: true,
      install: new Set(["-S", "-Sy", "-Syu", "-R", "-Rs", "-Rns", "-U"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    zypper: {
      system: true,
      install: new Set(["install", "in", "remove", "rm", "update", "up"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    apk: {
      system: true,
      install: new Set(["add", "del", "upgrade"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    snap: {
      system: true,
      install: new Set(["install", "remove", "refresh"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    flatpak: {
      system: true,
      install: new Set(["install", "uninstall", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    choco: {
      system: true,
      install: new Set(["install", "uninstall", "upgrade"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    winget: {
      system: true,
      install: new Set(["install", "uninstall", "upgrade"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    scoop: {
      system: true,
      install: new Set(["install", "uninstall", "update"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
    "nix-env": {
      system: true,
      install: new Set(["-i", "--install", "-e", "--uninstall", "-u"]),
      publish: new Set([]),
      fetch: new Set([]),
      run: new Set([]),
    },
  }

  const GIT_GLOBAL_VALUE = new Set([
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--exec-path",
    "--config-env",
  ])
  const GIT_READONLY = new Set([
    "status",
    "log",
    "diff",
    "show",
    "blame",
    "rev-parse",
    "rev-list",
    "ls-files",
    "ls-tree",
    "ls-remote",
    "cat-file",
    "describe",
    "shortlog",
    "name-rev",
    "merge-base",
    "for-each-ref",
    "show-ref",
    "check-ignore",
    "check-attr",
    "grep",
    "whatchanged",
    "reflog",
    "var",
    "version",
    "help",
    "count-objects",
    "fsck",
    "verify-commit",
    "verify-tag",
    "diff-tree",
    "diff-index",
    "diff-files",
    "range-diff",
    "bisect",
    "cherry",
    "stash list",
  ])
  const GIT_REMOTE = new Set(["push", "fetch", "pull", "clone", "ls-remote", "remote", "submodule", "lfs", "svn"])

  export const PS_ALIASES: Record<string, string> = {
    rm: "remove-item",
    ri: "remove-item",
    del: "remove-item",
    erase: "remove-item",
    rd: "remove-item",
    rmdir: "remove-item",
    cp: "copy-item",
    copy: "copy-item",
    cpi: "copy-item",
    mv: "move-item",
    move: "move-item",
    mi: "move-item",
    cat: "get-content",
    gc: "get-content",
    type: "get-content",
    sc: "set-content",
    ac: "add-content",
    ni: "new-item",
    ls: "get-childitem",
    dir: "get-childitem",
    gci: "get-childitem",
    iex: "invoke-expression",
    iwr: "invoke-webrequest",
    curl: "invoke-webrequest",
    wget: "invoke-webrequest",
    irm: "invoke-restmethod",
    saps: "start-process",
    start: "start-process",
    icm: "invoke-command",
    ren: "rename-item",
    rni: "rename-item",
    sp: "set-itemproperty",
    ii: "invoke-item",
    kill: "stop-process",
    spps: "stop-process",
    cd: "set-location",
    sl: "set-location",
    chdir: "set-location",
    pushd: "push-location",
    popd: "pop-location",
    echo: "write-output",
    write: "write-output",
    pwd: "get-location",
    gl: "get-location",
    sls: "select-string",
    gp: "get-itemproperty",
    rp: "remove-itemproperty",
    clc: "clear-content",
  }

  /**
   * Remove every layer of shell quoting while keeping the quoted content, so `r''m`, `'r'm`, `"rm"`
   * and `~/".ssh"` normalise to what the shell actually executes. Double-quote escapes are honoured.
   */
  export function dequote(text: string) {
    let out = ""
    let quote: "'" | '"' | undefined
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!
      if (quote === undefined && ch === "$" && text[i + 1] === "'") {
        quote = "'"
        i++
        continue
      }
      if (quote === undefined && (ch === "'" || ch === '"')) {
        quote = ch
        continue
      }
      if (quote !== undefined && ch === quote) {
        quote = undefined
        continue
      }
      if (quote === '"' && ch === "\\" && i + 1 < text.length && /[$`"\\\n]/.test(text[i + 1]!)) {
        out += text[i + 1]
        i++
        continue
      }
      if (quote === undefined && ch === "\\" && i + 1 < text.length) {
        out += text[i + 1]
        i++
        continue
      }
      out += ch
    }
    return out
  }

  function base(token: string) {
    const clean = dequote(token)
    const name = path.basename(clean.replaceAll("\\", "/"))
    return name.replace(/\.(exe|cmd|bat|com|ps1)$/i, "")
  }

  /** Strip wrappers (sudo, env, xargs, nohup ...) and report what they imply. */
  export function unwrap(tokens: string[], kind: Kind): Unwrapped {
    const out: Unwrapped = { argv: [], privileged: false, stdinTargets: false, hijack: false, assignments: {} }
    const list = [...tokens]
    while (list.length > 0) {
      const head = list[0]
      if (head === undefined) break
      const lowered = kind === "bash" ? head : head.toLowerCase()
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
        if (HIJACK_ENV.test(head)) out.hijack = true
        const eq = head.indexOf("=")
        out.assignments[head.slice(0, eq)] = dequote(head.slice(eq + 1))
        list.shift()
        continue
      }
      const name = kind === "bash" ? base(head) : base(lowered).toLowerCase()
      if (PRIVILEGE.has(name)) {
        out.privileged = true
        out.wrapper = name
        list.shift()
        if (name === "su") {
          const idx = list.indexOf("-c")
          if (idx >= 0) {
            const payload = list[idx + 1]
            out.executable = "sh"
            out.argv = payload === undefined ? [] : ["-c", payload]
            return out
          }
          out.executable = "sh"
          out.argv = []
          return out
        }
        while (list.length > 0 && list[0]?.startsWith("-")) {
          const flag = list.shift()!
          if (flag === "--") break
          if (flag === "-s" || flag === "-i" || flag === "--shell" || flag === "--login") {
            out.executable = "sh"
            out.argv = list.splice(0)
            return out
          }
          if (SUDO_VALUE.has(flag)) {
            const value = list.shift()
            if ((flag === "-D" || flag === "--chdir") && value) out.chdir = value
          }
        }
        continue
      }
      if (name === "busybox" && list[1] !== undefined && !SHELLS.has(base(list[1]))) {
        out.wrapper ??= name
        list.shift()
        continue
      }
      if (WRAPPERS.has(name)) {
        out.wrapper ??= name
        if (name === "xargs" || name === "parallel") out.stdinTargets = true
        list.shift()
        const values = WRAPPER_VALUE[name] ?? new Set<string>()
        while (list.length > 0 && list[0]?.startsWith("-")) {
          const flag = list.shift()!
          if (flag === "--") break
          if (name === "env" && (flag === "-C" || flag === "--chdir")) {
            out.chdir = list.shift()
            continue
          }
          // `env -S 'cmd args'` re-splits its argument and executes it: analyse it like `sh -c`.
          if (
            name === "env" &&
            (flag === "-S" || flag === "--split-string" || flag.startsWith("-S") || flag.startsWith("--split-string="))
          ) {
            const inline =
              flag === "-S" || flag === "--split-string"
                ? list.shift()
                : flag.startsWith("-S")
                  ? flag.slice(2)
                  : flag.slice("--split-string=".length)
            out.executable = "sh"
            out.argv = ["-c", [inline ?? "", ...list].join(" ")]
            return out
          }
          if (values.has(flag)) list.shift()
          if (flag.startsWith("-I") && name === "xargs" && flag.length > 2) continue
        }
        if (POSITIONAL_WRAPPER.has(name) && list.length > 0) list.shift()
        continue
      }
      out.executable = name
      out.argv = list.slice(1)
      return out
    }
    return out
  }

  function flags(argv: string[]) {
    const short = new Set<string>()
    const long = new Set<string>()
    for (const arg of argv) {
      if (arg === "--") break
      if (arg.startsWith("--")) {
        long.add(arg.split("=")[0]!)
        continue
      }
      if (arg.startsWith("-") && arg.length > 1 && !/^-\d/.test(arg)) {
        for (const ch of arg.slice(1)) short.add(ch)
      }
    }
    return {
      short,
      long,
      has: (value: string) => (value.startsWith("--") ? long.has(value) : short.has(value.slice(1))),
    }
  }

  /** Non-option operands, honouring `--`. */
  export function operands(argv: string[], valued: Set<string> = new Set()) {
    const out: string[] = []
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--") {
        out.push(...argv.slice(i + 1))
        break
      }
      if (arg.startsWith("-") && arg.length > 1) {
        if (valued.has(arg)) i++
        continue
      }
      out.push(arg)
    }
    return out
  }

  /** Strip one layer of shell quoting, honouring double-quote escapes so nested payloads parse. */
  function unquote(text: string) {
    if (text.length < 2) return text
    const first = text[0]
    const last = text[text.length - 1]
    if (first === "'" && last === "'") return text.slice(1, -1)
    if (first === '"' && last === '"') return text.slice(1, -1).replace(/\\([$`"\\\n])/g, "$1")
    if (text.startsWith("$'") && last === "'") return text.slice(2, -1).replace(/\\(['\\])/g, "$1")
    return text
  }

  function shell(executable: string, argv: string[]): Pick<Spec, "indirection" | "payload" | "script" | "encoded"> {
    const kind = POWERSHELLS.has(executable) ? "powershell" : CMD.has(executable) ? "cmd" : "bash"
    if (kind === "powershell") {
      for (let i = 0; i < argv.length; i++) {
        const flag = argv[i]!.toLowerCase()
        const word = flag.replace(/^[-/]/, "")
        if (/^[-/]/.test(flag) && word.length > 0 && word.startsWith("e") && "encodedcommand".startsWith(word))
          return { indirection: "shell", encoded: true }
        if (/^[-/]/.test(flag) && word.length > 0 && word.startsWith("ec") && "encodedcommand".startsWith(word))
          return { indirection: "shell", encoded: true }
        if (/^-(c|com|comm|command)$/.test(flag)) {
          const text = argv
            .slice(i + 1)
            .map(unquote)
            .join(" ")
          return { indirection: "shell", payload: { text, kind: "powershell" }, encoded: false }
        }
        if (/^-(f|file)$/.test(flag)) return { indirection: "shell", script: argv[i + 1], encoded: false }
      }
      return { indirection: "shell", encoded: false }
    }
    if (kind === "cmd") {
      const idx = argv.findIndex((arg) => /^\/[ck]$/i.test(arg))
      if (idx >= 0)
        return {
          indirection: "cmd",
          payload: {
            text: argv
              .slice(idx + 1)
              .map(unquote)
              .join(" "),
            kind: "cmd",
          },
          encoded: false,
        }
      return { indirection: "cmd", encoded: false }
    }
    if (executable === "busybox") {
      const inner = argv[0]
      if (!inner || !SHELLS.has(inner)) return { indirection: "shell", encoded: false }
      return shell(inner, argv.slice(1))
    }
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--") break
      if (!arg.startsWith("-") || arg.startsWith("--")) {
        if (arg.startsWith("--")) continue
        return { indirection: "shell", script: arg, encoded: false }
      }
      if (arg.includes("c")) {
        const text = argv[i + 1]
        return {
          indirection: "shell",
          payload: text === undefined ? undefined : { text: unquote(text), kind: "bash" },
          encoded: false,
        }
      }
    }
    return { indirection: "shell", encoded: false }
  }

  function interpreter(executable: string, argv: string[]): Pick<Spec, "indirection" | "script"> {
    const evals = INTERPRETERS[executable] ?? new Set<string>()
    if (executable.endsWith("awk")) {
      const program = operands(argv, new Set(["-F", "-v", "-f"]))[0] ?? ""
      // system(), command pipes and output redirection inside the program reach the filesystem/shell.
      if (/system\s*\(|getline|\|\s*"|"\s*\||>\s*"|>>\s*"/.test(program)) return { indirection: "eval" }
      return argv.includes("-f") ? { indirection: "interpreter" } : {}
    }
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i]!
      if (arg === "--") break
      if (evals.has(arg) || (executable === "deno" && arg === "eval")) return { indirection: "interpreter" }
      if (arg === "-m" || arg === "--module") return {}
      if (!arg.startsWith("-")) {
        if (executable === "deno" && (arg === "run" || arg === "task" || arg === "test")) return {}
        if (executable === "uv" || executable === "bun") return {}
        return { indirection: "interpreter", script: arg }
      }
    }
    if (executable === "uv" || executable === "bun" || executable === "deno") return {}
    // No script and no inline code: the program comes from stdin (`curl … | python3`).
    return { indirection: "interpreter" }
  }

  function git(argv: string[]): { git: GitAction; operands: Spec["operands"] } {
    const list = [...argv]
    const paths: Spec["operands"] = []
    while (list.length > 0 && list[0]?.startsWith("-")) {
      const flag = list.shift()!
      if (GIT_GLOBAL_VALUE.has(flag)) {
        const value = list.shift()
        if (flag === "-C" && value) paths.push({ value, effect: "write" })
        if (flag === "--work-tree" && value) paths.push({ value, effect: "write" })
        if (
          flag === "-c" &&
          value &&
          /^(core\.(pager|editor|sshcommand|hookspath|fsmonitor)|diff\.external|credential\.helper|alias\.)/i.test(
            value,
          )
        ) {
          return { git: { subcommand: "config", mutating: true, destructive: true, remote: false }, operands: paths }
        }
      }
      const match = flag.match(/^(--git-dir|--work-tree)=(.+)$/)
      if (match) paths.push({ value: match[2]!, effect: "write" })
    }
    const sub = list.shift()?.toLowerCase() ?? ""
    const rest = list
    const f = flags(rest)
    const ops = operands(rest)
    for (const arg of rest) {
      const match = arg.match(/^--directory=(.+)$/)
      if (match) paths.push({ value: match[1]!, effect: "write" })
    }
    // `git show ~/.ssh/id_rsa`, `git diff --no-index <file> /dev/null`: read-only git still reads files.
    if (GIT_READONLY.has(sub)) {
      for (const op of ops)
        if (/[\\/]/.test(op) || op.startsWith("~") || op.startsWith("."))
          paths.push({ value: op.replace(/^[^:]*:(?=[./~])/, ""), effect: "read" })
    }
    const mutating = mutatesGit(["git", sub, ...rest].join(" "))
    const remote = GIT_REMOTE.has(sub)
    const destructive = (() => {
      if (sub === "push")
        return (
          f.has("-f") ||
          f.has("--force") ||
          f.has("--force-with-lease") ||
          f.has("--force-if-includes") ||
          f.has("-d") ||
          f.has("--delete") ||
          f.has("--mirror") ||
          f.has("--prune") ||
          ops.some((op) => op.startsWith("+") || op.startsWith(":"))
        )
      if (sub === "reset") return f.has("--hard") || f.has("--merge")
      if (sub === "checkout")
        return rest.includes("--") || f.has("-f") || f.has("--force") || ops.includes(".") || ops.includes("*")
      if (sub === "restore") return !(f.has("--staged") || f.has("-S")) || f.has("-W") || f.has("--worktree")
      if (sub === "clean") return f.has("-f") || f.has("--force") || (f.has("-x") && !f.has("-n"))
      if (sub === "branch")
        return f.has("-D") || f.has("-d") || f.has("--delete") || f.has("-f") || f.has("--force") || f.has("-M")
      if (sub === "stash") return rest[0] === "drop" || rest[0] === "clear"
      if (sub === "tag") return f.has("-d") || f.has("--delete") || f.has("-f") || f.has("--force")
      if (sub === "reflog") return rest[0] === "expire" || rest[0] === "delete"
      if (sub === "gc") return f.has("--prune") || rest.some((arg) => arg.startsWith("--prune"))
      if (sub === "worktree") return rest[0] === "remove" || rest[0] === "prune"
      if (sub === "submodule") return rest[0] === "deinit"
      if (sub === "update-ref") return f.has("-d")
      if (sub === "config")
        return (
          f.has("--global") ||
          f.has("--system") ||
          rest.some((arg) =>
            /^(core\.(pager|editor|sshcommand|hookspath|fsmonitor)|diff\.external|credential\.helper|alias\.|url\.)/i.test(
              arg,
            ),
          )
        )
      if (sub === "remote")
        return rest[0] === "remove" || rest[0] === "rm" || rest[0] === "set-url" || rest[0] === "prune"
      if (sub === "apply" || sub === "am")
        return (
          f.has("--unsafe-paths") ||
          rest.some((arg) => arg.startsWith("--directory") || arg === "--include" || arg === "--exclude")
        )
      return ["filter-branch", "filter-repo", "prune", "replace"].includes(sub)
    })()
    return { git: { subcommand: sub, mutating, destructive, remote }, operands: paths }
  }

  function pkg(executable: string, argv: string[]): PackageAction | undefined {
    const spec = PACKAGE_MANAGERS[executable]
    if (!spec) return undefined
    const ops = operands(
      argv,
      new Set([
        "-r",
        "--requirement",
        "-c",
        "--constraint",
        "--registry",
        "--prefix",
        "-C",
        "--cwd",
        "--filter",
        "-w",
        "--workspace",
      ]),
    )
    const global = argv.includes("-g") || argv.includes("--global") || argv.includes("--system")
    if (spec.fetch.has("*"))
      return { manager: executable, operation: "fetch-exec", packages: ops.slice(0, 1), system: spec.system }
    const sub = ops[0] ?? ""
    const rest = ops.slice(1)
    if (executable === "uv" && sub === "pip")
      return {
        manager: executable,
        operation: rest[0] === "install" ? "install" : "other",
        packages: rest.slice(1),
        system: false,
      }
    if (executable === "uv" && (sub === "tool" || sub === "x"))
      return {
        manager: executable,
        operation: "fetch-exec",
        packages: rest.slice(rest[0] === "run" ? 1 : 0, 1),
        system: false,
      }
    if (executable === "dotnet" && sub === "tool")
      return {
        manager: executable,
        operation: rest[0] === "install" ? "install" : "other",
        packages: rest.slice(1),
        system: rest.includes("-g"),
      }
    if (executable === "dotnet" && sub === "add")
      return {
        manager: executable,
        operation: rest.includes("package") ? "install" : "other",
        packages: rest.slice(rest.indexOf("package") + 1),
        system: false,
      }
    if (executable === "yarn" && sub === "npm" && rest[0] === "publish")
      return { manager: executable, operation: "publish", packages: [], system: false }
    if (executable === "yarn" && sub === "global")
      return { manager: executable, operation: "install", packages: rest.slice(1), system: true }
    if (executable === "bun" && sub === "pm")
      return { manager: executable, operation: "other", packages: [], system: false }
    if (executable === "composer" && sub === "global")
      return { manager: executable, operation: "install", packages: rest.slice(1), system: true }
    if (spec.publish.has(sub)) return { manager: executable, operation: "publish", packages: rest, system: spec.system }
    if (spec.fetch.has(sub))
      return { manager: executable, operation: "fetch-exec", packages: rest.slice(0, 1), system: spec.system }
    if (spec.install.has(sub))
      return {
        manager: executable,
        operation: "install",
        packages: rest,
        system: spec.system || global || argv.includes("-g") || argv.includes("--global"),
      }
    if (spec.run.has(sub)) return { manager: executable, operation: "run", packages: [], system: false }
    if (executable === "yarn" && sub === "")
      return { manager: executable, operation: "install", packages: [], system: false }
    return { manager: executable, operation: "other", packages: [], system: spec.system }
  }

  function escape(executable: string, argv: string[]): string | undefined {
    const joined = argv.join(" ")
    const table: Record<string, RegExp> = {
      rg: /(^|\s)--(pre|pre-glob|hostname-bin)(=|\s|$)/,
      man: /(^|\s)(-P|--pager|-H|--html)(=|\s|$)/,
      sort: /(^|\s)--(compress-program|files0-from)(=|\s|$)/,
      tar: /(^|\s)(--checkpoint-action(=|\s)exec|--to-command|-I|--use-compress-program|--rsh-command|--rmt-command|-P|--absolute-names|-[a-zA-Z]*P[a-zA-Z]*)(=|\s|$)/,
      unzip: /(^|\s)-:(\s|$)/,
      bsdtar: /(^|\s)(-P|--absolute-paths)(\s|$)/,
      ag: /(^|\s)--pager(=|\s|$)/,
      less: /(^|\s)(--rscroll|\+!|-\+)/,
      vim: /(^|\s)(-c|--cmd|-S)(\s|$)/,
      vi: /(^|\s)(-c|--cmd|-S)(\s|$)/,
      nvim: /(^|\s)(-c|--cmd|-S)(\s|$)/,
      ssh: /(^|\s)-o\s*(ProxyCommand|LocalCommand|PermitLocalCommand)/i,
      rsync: /(^|\s)(-e|--rsh)(=|\s)/,
      zip: /(^|\s)-TT(\s|$)/,
      git: /(^|\s)-c\s*(core\.(pager|editor|sshcommand|hookspath)|diff\.external|credential\.helper)/i,
      curl: /(^|\s)(-o|--output)\s*\/dev\/(sd|disk|nvme)/,
      tmux: /(^|\s)(new-session|new|send-keys|run-shell|run)(\s|$)/,
      screen: /(^|\s)-dm?S?\s/,
      script: /(^|\s)-c(\s|$)/,
      sed: /(^|\s)(-e\s*)?['"]?[^'"]*\/e['"]?(\s|$)|(^|\s)e\s|(^|[;\s'"{])[wW]\s+[^\s'"]|\/[wW]\s|--sandbox=false/,
      find: /(^|\s)-(exec|execdir|ok|okdir)(\s|$)/,
      npm: /(^|\s)(--script-shell|--onload-script)(=|\s)/,
      nice: /./,
      busybox: /./,
      env: /./,
      ld: /./,
      "ld.so": /./,
    }
    if (argv.includes("--%")) return "--%"
    const pattern = table[executable]
    if (!pattern) return undefined
    if (!pattern.test(joined)) return undefined
    return executable
  }

  function url(argv: string[]) {
    return argv.find((arg) => /^(https?|ftp|sftp|ssh|git|ws|wss):\/\//i.test(unquote(arg)))
  }

  function readerOperands(executable: string, argv: string[]) {
    if (executable === "select-string") {
      // PowerShell parameters are case-insensitive; keep operand spelling, normalise only the flags.
      const list = argv.map((arg) => (arg.startsWith("-") ? arg.toLowerCase() : arg))
      const ops = operands(list, new Set(READER_VALUED["select-string"] ?? []))
      return list.includes("-pattern") ? ops : ops.slice(1)
    }
    if (
      executable === "grep" ||
      executable === "egrep" ||
      executable === "fgrep" ||
      executable === "zgrep" ||
      executable === "rg" ||
      executable === "ag" ||
      executable === "ack"
    ) {
      const valued = new Set([
        "-e",
        "--regexp",
        "-f",
        "--file",
        "-m",
        "--max-count",
        "-A",
        "-B",
        "-C",
        "--include",
        "--exclude",
        "-g",
        "--glob",
        "-t",
        "--type",
        "-T",
        "--type-not",
        "--pattern",
      ])
      const ops = operands(argv, valued)
      const explicit = argv.some(
        (arg) => arg === "-e" || arg === "--regexp" || arg === "-f" || arg === "--file" || arg === "--pattern",
      )
      return explicit ? ops : ops.slice(1)
    }
    if (executable === "sed" || executable === "gsed") {
      const ops = operands(argv, new Set(["-e", "--expression", "-f", "--file"]))
      const explicit = argv.some((arg) => arg === "-e" || arg === "--expression" || arg === "-f" || arg === "--file")
      return explicit ? ops : ops.slice(1)
    }
    if (executable.endsWith("awk")) {
      const ops = operands(argv, new Set(["-F", "-v", "-f"]))
      return argv.includes("-f") ? ops : ops.slice(1)
    }
    if (executable === "jq" || executable === "yq")
      return operands(argv, new Set(["--arg", "--argjson", "--slurpfile", "--rawfile", "-f", "--from-file"])).slice(1)
    if (executable === "openssl") {
      const idx = argv.findIndex(
        (arg) => arg === "-in" || arg === "-inkey" || arg === "-key" || arg === "-CAfile" || arg === "-passin",
      )
      return idx >= 0
        ? argv.filter((_, i) => i > 0 && (argv[i - 1] === "-in" || argv[i - 1] === "-inkey" || argv[i - 1] === "-key"))
        : []
    }
    if (executable === "ssh-keygen") return argv.filter((_, i) => i > 0 && argv[i - 1] === "-f")
    if (executable === "gpg" || executable === "gpg2")
      return operands(argv, new Set(["-o", "--output", "-r", "--recipient", "-u", "--local-user"]))
    if (executable === "tar") {
      const ops = operands(
        argv,
        new Set(["-C", "--directory", "-f", "--file", "-T", "--files-from", "-X", "--exclude-from"]),
      )
      const file = argv.filter((_, i) => i > 0 && (argv[i - 1] === "-f" || argv[i - 1] === "--file"))
      const first = argv[0] ?? ""
      const packed = /^-?[a-zA-Z]*f[a-zA-Z]*$/.test(first) && !first.startsWith("--") ? ops.slice(0, 1) : []
      return [...file, ...packed, ...ops.slice(packed.length)]
    }
    if (executable === "zip" || executable === "7z") return operands(argv).slice(1)
    if (executable === "scp" || executable === "rsync")
      return operands(argv, new Set(["-e", "--rsh", "-i", "-o", "-P", "-F", "-S", "-J"])).slice(0, -1)
    return operands(argv, new Set(READER_VALUED[executable] ?? []))
  }

  /** Options that take a value, per reader: a generic list would swallow `wc -c <file>`. */
  const READER_VALUED: Record<string, string[]> = {
    head: ["-n", "-c", "--lines", "--bytes"],
    tail: ["-n", "-c", "--lines", "--bytes", "--pid", "-s", "--sleep-interval"],
    cut: ["-d", "-f", "-c", "-b", "--delimiter", "--fields", "--characters", "--bytes"],
    uniq: ["-f", "-s", "-w", "--skip-fields", "--skip-chars", "--check-chars"],
    fold: ["-w", "--width"],
    fmt: ["-w", "--width", "-g", "--goal"],
    od: ["-t", "-j", "-N", "-w", "--format", "--skip-bytes", "--read-bytes", "--width"],
    xxd: ["-l", "-s", "-c", "-g", "-o"],
    hexdump: ["-n", "-s", "-e", "-f"],
    strings: ["-n", "-t", "--bytes"],
    base64: ["-w", "--wrap"],
    base32: ["-w", "--wrap"],
    "get-content": [
      "-totalcount",
      "-tail",
      "-head",
      "-encoding",
      "-delimiter",
      "-readcount",
      "-stream",
      "-filter",
      "-include",
      "-exclude",
    ],
    "select-string": ["-pattern", "-encoding", "-context", "-include", "-exclude"],
  }

  /** Options that take a value, per command: a generic list would swallow `cp -r <src>`. */
  const WRITER_VALUED: Record<string, string[]> = {
    cp: ["-t", "--target-directory", "-S", "--suffix"],
    mv: ["-t", "--target-directory", "-S", "--suffix"],
    install: ["-t", "--target-directory", "-m", "--mode", "-o", "--owner", "-g", "--group", "-S", "--suffix"],
    ln: ["-t", "--target-directory", "-S", "--suffix"],
    rsync: [
      "-e",
      "--rsh",
      "--exclude",
      "--include",
      "--exclude-from",
      "--files-from",
      "--chmod",
      "--chown",
      "-T",
      "--temp-dir",
      "--log-file",
      "-B",
      "--block-size",
    ],
    touch: ["-r", "--reference", "-d", "--date", "-t"],
    truncate: ["-s", "--size", "-r", "--reference"],
    mkdir: ["-m", "--mode"],
    chmod: ["--reference"],
    chown: ["--reference", "--from"],
    chgrp: ["--reference"],
    chattr: ["-v", "-p"],
    setfacl: ["-m", "--modify", "-x", "--remove", "-M", "-X", "--set", "--set-file", "--restore"],
    xattr: ["-w", "-p", "-d"],
    "copy-item": ["-exclude", "-include", "-filter"],
    "move-item": ["-exclude", "-include", "-filter"],
    "rename-item": ["-exclude", "-include", "-filter"],
    "set-content": ["-value", "-encoding", "-stream", "-filter", "-include", "-exclude"],
    "add-content": ["-value", "-encoding", "-stream", "-filter", "-include", "-exclude"],
    "out-file": ["-encoding", "-inputobject", "-width"],
    "tee-object": ["-variable", "-inputobject"],
    "new-item": ["-value", "-itemtype", "-name"],
    "clear-content": ["-filter", "-include", "-exclude", "-stream"],
  }

  function writerOperands(executable: string, argv: string[], f: ReturnType<typeof flags>): Spec["operands"] {
    const spec = WRITERS[executable]!
    const valued = new Set(WRITER_VALUED[executable] ?? [])
    const ops = operands(
      argv.map((arg) => (arg.startsWith("-") && executable.includes("-") ? arg.toLowerCase() : arg)),
      valued,
    )
    const target = argv.filter((_, i) => i > 0 && (argv[i - 1] === "-t" || argv[i - 1] === "--target-directory"))
    if (spec.mode === "all") return ops.map((value) => ({ value, effect: "write" }))
    if (spec.mode === "first-mode") {
      const reference = argv.filter((_, i) => i > 0 && argv[i - 1] === "--reference")
      const rest = reference.length > 0 ? ops : ops.slice(1)
      return rest.map((value) => ({ value, effect: "chmod" }))
    }
    if (target.length > 0)
      return [
        ...ops.map((value) => ({ value, effect: "read" as const })),
        ...target.map((value) => ({ value, effect: "write" as const })),
      ]
    // PowerShell names its destination; it need not come last.
    const named = argv.filter((_, i) => i > 0 && /^-dest(ination)?$/i.test(argv[i - 1] ?? ""))
    if (named.length > 0) {
      const rest = ops.filter((value) => !named.includes(value))
      return [
        ...rest.map((value) => ({ value, effect: (executable === "move-item" ? "delete" : "read") as FileEffect })),
        ...named.map((value) => ({ value, effect: "write" as const })),
      ]
    }
    if (executable === "ln") {
      if (ops.length === 1) return [{ value: path.basename(ops[0]!), effect: "write" }]
      return ops.slice(-1).map((value) => ({ value, effect: "write" }))
    }
    if (executable === "rsync" || executable === "scp") {
      const local = ops.filter((value) => !/^[^/]+:/.test(value) && !value.startsWith("rsync://"))
      const dest = ops.at(-1)
      return local.map((value) => ({
        value,
        effect: value === dest ? (f.has("--delete") ? "delete" : "write") : "read",
      }))
    }
    const dest = ops.at(-1)
    const moves =
      executable === "mv" ||
      executable === "move-item" ||
      executable === "move" ||
      executable === "rename-item" ||
      executable === "ren" ||
      executable === "rename"
    return ops.map((value) => ({ value, effect: value === dest ? "write" : moves ? "delete" : "read" }))
  }

  function findSpec(argv: string[]): Spec {
    const start = argv.findIndex((arg) => arg.startsWith("-") || arg === "(" || arg === "!")
    const paths = (start === -1 ? argv : argv.slice(0, start)).filter((arg) => !arg.startsWith("-"))
    const rest = start === -1 ? [] : argv.slice(start)
    const exec = rest.findIndex((arg) => /^-(exec|execdir|ok|okdir)$/.test(arg))
    const command = exec >= 0 ? base(rest[exec + 1] ?? "") : undefined
    const remove = rest.includes("-delete") || (command !== undefined && DELETE.has(command))
    const effect: FileEffect = remove
      ? "delete"
      : command && !READERS.has(command) && !METADATA.has(command)
        ? "exec"
        : "read"
    return {
      effect,
      recursive: true,
      force: true,
      operands: (paths.length > 0 ? paths : ["."]).map((value) => ({ value, effect, within: true })),
      encoded: false,
      network: false,
      reads: effect === "read",
      metadata: effect === "read" && command === undefined,
      indirection: effect === "exec" ? "interpreter" : undefined,
      escape: effect === "exec" ? "find" : undefined,
    }
  }

  function ddSpec(argv: string[]): Spec {
    const out = argv.filter((arg) => arg.startsWith("of=")).map((arg) => arg.slice(3))
    const input = argv.filter((arg) => arg.startsWith("if=")).map((arg) => arg.slice(3))
    return {
      effect: "write",
      recursive: false,
      force: true,
      operands: [
        ...input.map((value) => ({ value, effect: "read" as const })),
        ...out.map((value) => ({ value, effect: "write" as const })),
      ],
      encoded: false,
      network: false,
      reads: true,
      metadata: false,
      family: out.some((value) => value.startsWith("/dev/")) ? "device" : undefined,
    }
  }

  const EMPTY: Spec = {
    recursive: false,
    force: false,
    operands: [],
    encoded: false,
    network: false,
    reads: false,
    metadata: false,
  }

  /** Describe the static semantics of one unwrapped command. */
  export function describe(executable: string, argv: string[], kind: Kind): Spec {
    const name = kind === "bash" ? executable : (PS_ALIASES[executable.toLowerCase()] ?? executable.toLowerCase())
    const f = flags(argv)
    const lower = argv.map((arg) => arg.toLowerCase())

    if (SHELLS.has(name) || POWERSHELLS.has(name) || CMD.has(name)) {
      const inner = shell(name, argv)
      return { ...EMPTY, ...inner, operands: inner.script ? [{ value: inner.script, effect: "exec" }] : [] }
    }
    if (name === "eval" || name === "invoke-expression" || name === "invoke-command")
      return { ...EMPTY, indirection: "eval" }
    if (name === "source" || name === "." || name === "invoke-item") {
      const script = operands(argv)[0]
      return { ...EMPTY, indirection: "shell", script, operands: script ? [{ value: script, effect: "exec" }] : [] }
    }
    if (name === "git") {
      const result = git(argv)
      return {
        ...EMPTY,
        git: result.git,
        operands: result.operands,
        network: result.git.remote,
        reads: !result.git.mutating,
        metadata: !result.git.mutating && result.operands.length === 0,
      }
    }
    if (name === "find") return findSpec(argv)
    if (name === "dd") return ddSpec(argv)
    if (DEVICE.has(name) || name.startsWith("mkfs.") || name.startsWith("mke2fs") || name.startsWith("mkswap")) {
      const sub = lower[0] ?? ""
      const safe = DEVICE_SAFE_SUB.has(sub) || DEVICE_SAFE_SUB.has(lower.slice(0, 2).join(" "))
      return {
        ...EMPTY,
        family: safe ? "metadata" : "device",
        operands: safe ? [] : operands(argv).map((value) => ({ value, effect: "write" as const })),
        metadata: safe,
      }
    }
    if (SYSTEM_CONTROL.has(name)) {
      const sub = lower[0] ?? ""
      const read =
        SYSTEM_READ.has(sub) ||
        (name === "crontab" && lower.includes("-l")) ||
        (name === "defaults" && sub === "read") ||
        (name === "launchctl" && (sub === "list" || sub === "print")) ||
        (name === "reg" && sub === "query") ||
        (name === "net" && sub === "user" && lower.length === 1) ||
        (name === "sysctl" && !lower.includes("-w") && !lower.some((arg) => arg.includes("=")))
      const deny =
        SYSTEM_DENY.has(name) ||
        (name === "crontab" && (lower.includes("-r") || !read)) ||
        (name === "systemctl" && ["poweroff", "reboot", "halt", "kexec", "suspend", "hibernate"].includes(sub)) ||
        (name === "schtasks" && sub === "/create") ||
        (name === "sc" && sub === "create") ||
        (name === "net" && lower.includes("/add")) ||
        (name === "reg" && sub === "add" && lower.some((arg) => arg.includes("\\run"))) ||
        (name === "set-itemproperty" && lower.some((arg) => arg.includes("\\run"))) ||
        (name === "new-itemproperty" && lower.some((arg) => arg.includes("\\run")))
      return {
        ...EMPTY,
        family: read ? "metadata" : deny ? "system-control" : PERSISTENCE.has(name) ? "persistence" : "system-control",
        force: deny,
        metadata: read,
      }
    }
    if (PROCESS_CONTROL.has(name)) {
      const ops = operands(argv, new Set(["-s", "--signal", "-u", "--user", "-n", "-o", "-t"]))
      const deny = ops.some((op) => PROCESS_DENY.test(op)) || lower.includes("-1")
      // `Stop-Process -Id (Get-Process kilo).Id`: the target is computed, so it cannot be vouched for.
      const unknown = argv.some((arg) => /[$(`@]/.test(arg))
      if (deny) return { ...EMPTY, family: "system-control", force: true }
      if (unknown) return { ...EMPTY, family: "system-control", force: false }
      return { ...EMPTY, family: "process-control", metadata: true }
    }
    if (CONTAINERS.has(name)) {
      const sub = lower.slice(0, 2).join(" ")
      const destructive = CONTAINER_DESTRUCTIVE.test(sub) || CONTAINER_DESTRUCTIVE.test(lower[0] ?? "")
      const escapeFlag =
        argv.some((arg) => CONTAINER_ESCAPE.test(arg)) ||
        argv.some((arg, i) => (arg === "-v" || arg === "--volume") && /^\/(:|$)/.test(argv[i + 1] ?? ""))
      const network = ["push", "pull", "login", "logout"].includes(lower[0] ?? "")
      const read =
        [
          "ps",
          "images",
          "logs",
          "inspect",
          "version",
          "info",
          "stats",
          "top",
          "get",
          "describe",
          "config",
          "explain",
          "api-resources",
        ].includes(lower[0] ?? "") ||
        sub.startsWith("compose ps") ||
        sub.startsWith("compose logs")
      return {
        ...EMPTY,
        family: "container",
        force: destructive || escapeFlag,
        escape: escapeFlag ? name : undefined,
        network,
        metadata: read,
        reads: read,
      }
    }
    // Runtimes that are both package managers and interpreters (bun, deno, uv): inline code wins.
    const inline = INTERPRETERS[name] ? interpreter(name, argv) : {}
    const packed = inline.indirection === undefined ? pkg(name, argv) : undefined
    if (packed) {
      const network = packed.operation !== "run" && packed.operation !== "other"
      return { ...EMPTY, pkg: packed, network, metadata: packed.operation === "other" && !INTERPRETERS[name] }
    }
    if (INTERPRETERS[name]) {
      const inner = inline
      const script = inner.script
      const reads = name.endsWith("awk") ? readerOperands(name, argv) : []
      return {
        ...EMPTY,
        ...inner,
        operands: [
          ...(script ? [{ value: script, effect: "exec" as const }] : []),
          ...reads.map((value) => ({ value, effect: "read" as const })),
        ],
        escape: escape(name, argv),
        reads: reads.length > 0,
      }
    }
    if (DELETE.has(name)) {
      const recursive =
        f.has("-r") ||
        f.has("-R") ||
        f.has("--recursive") ||
        lower.includes("-recurse") ||
        lower.includes("/s") ||
        (name === "rmdir" && (f.has("-p") || f.has("--parents"))) ||
        name === "shred" ||
        name === "srm"
      const force =
        f.has("-f") ||
        f.has("--force") ||
        lower.includes("-force") ||
        lower.includes("/q") ||
        f.has("--no-preserve-root")
      const ops =
        kind === "bash"
          ? operands(argv, new Set(["--interactive", "-i", "-I"])).filter((op) => !/^\/[sq]$/i.test(op))
          : operands(
              argv.filter((arg) => !/^-(recurse|force|confirm|whatif|verbose|debug)$/i.test(arg)),
              new Set(["-exclude", "-include", "-filter"]),
            )
      return {
        ...EMPTY,
        effect: "delete",
        recursive,
        force,
        operands: ops.map((value) => ({ value, effect: "delete" as const })),
      }
    }
    if (WRITERS[name]) {
      const recursive =
        f.has("-r") ||
        f.has("-R") ||
        f.has("--recursive") ||
        (f.has("-a") && (name === "cp" || name === "rsync")) ||
        lower.includes("-recurse")
      const force = f.has("-f") || f.has("--force") || lower.includes("-force")
      const ops = writerOperands(
        name,
        kind === "bash" ? argv : argv.filter((arg) => !/^-(recurse|force|confirm|whatif|verbose|debug)$/i.test(arg)),
        f,
      )
      const effect: FileEffect = CHMOD.has(name) ? "chmod" : "write"
      return {
        ...EMPTY,
        effect,
        recursive,
        force,
        operands: ops,
        reads: ops.some((op) => op.effect === "read"),
        network: name === "rsync" && argv.some((arg) => /^[^/]+:/.test(arg)),
      }
    }
    if (name === "patch") {
      const dir = argv
        .filter((_, i) => i > 0 && (argv[i - 1] === "-d" || argv[i - 1] === "--directory"))
        .concat(argv.filter((arg) => arg.startsWith("--directory=")).map((arg) => arg.slice("--directory=".length)))
      const input = argv.filter((_, i) => i > 0 && (argv[i - 1] === "-i" || argv[i - 1] === "--input"))
      return {
        ...EMPTY,
        effect: "write",
        operands: [
          ...(dir.length > 0 ? dir : ["."]).map((value) => ({ value, effect: "write" as const, within: true })),
          ...input.map((value) => ({ value, effect: "read" as const })),
        ],
        reads: true,
      }
    }
    if (name === "sed" || name === "gsed") {
      const inplace = argv.some((arg) => /^-i/.test(arg) || arg === "--in-place")
      const ops = readerOperands(name, argv)
      return {
        ...EMPTY,
        effect: inplace ? "write" : "read",
        operands: ops.map((value) => ({ value, effect: inplace ? ("write" as const) : ("read" as const) })),
        reads: true,
        escape: escape(name, argv),
      }
    }
    if (
      name === "tar" ||
      name === "unzip" ||
      name === "7z" ||
      name === "gzip" ||
      name === "gunzip" ||
      name === "xz" ||
      name === "bzip2" ||
      name === "zstd" ||
      name === "zip"
    ) {
      const extract =
        name === "unzip" ||
        (name === "tar" && (f.has("-x") || f.has("--extract") || /^x/.test(argv[0] ?? ""))) ||
        (name === "7z" && /^[xe]$/.test(argv[0] ?? "")) ||
        ((name === "gunzip" || name === "gzip" || name === "xz" || name === "bzip2" || name === "zstd") &&
          !f.has("-c") &&
          !f.has("--stdout") &&
          !f.has("-k") &&
          !f.has("--keep") &&
          !f.has("-l") &&
          !f.has("-t"))
      const dir = argv.filter(
        (_, i) => i > 0 && (argv[i - 1] === "-C" || argv[i - 1] === "--directory" || argv[i - 1] === "-d"),
      )
      const ops = readerOperands(name === "zip" || name === "7z" || name === "unzip" ? name : "tar", argv)
      const reads = ops.map((value) => ({
        value,
        effect:
          extract && dir.length === 0 && name !== "tar" && name !== "unzip" && name !== "7z"
            ? ("write" as const)
            : ("read" as const),
      }))
      const writes = extract ? (dir.length > 0 ? dir : ["."]).map((value) => ({ value, effect: "write" as const })) : []
      return {
        ...EMPTY,
        effect: extract ? "write" : "read",
        operands: [...reads, ...(name === "tar" || name === "unzip" || name === "7z" ? writes : [])],
        reads: true,
        escape: escape(name, argv),
      }
    }
    if (name === "sort" && (argv.includes("-o") || argv.some((arg) => arg.startsWith("--output")))) {
      const out = argv
        .filter((_, i) => i > 0 && argv[i - 1] === "-o")
        .concat(argv.filter((arg) => arg.startsWith("--output=")).map((arg) => arg.slice("--output=".length)))
      const ops = operands(
        argv,
        new Set(["-o", "-k", "-t", "-S", "-T", "--key", "--field-separator", "--buffer-size", "--temporary-directory"]),
      )
      return {
        ...EMPTY,
        effect: "write",
        operands: [
          ...out.map((value) => ({ value, effect: "write" as const })),
          ...ops.map((value) => ({ value, effect: "read" as const })),
        ],
        reads: true,
        escape: escape(name, argv),
      }
    }
    if (READERS.has(name)) {
      const ops = readerOperands(name, argv)
      const network =
        NETWORK.has(name) && (name !== "openssl" || lower[0] === "s_client")
          ? true
          : name === "scp" || name === "rsync"
            ? argv.some((arg) => /^[^/]+:/.test(arg))
            : false
      const decode =
        DECODERS.has(name) &&
        (f.has("-d") || f.has("--decode") || f.has("-D") || f.has("-r") || (lower.includes("enc") && f.has("-d")))
      const recursive = f.has("-r") || f.has("-R") || f.has("--recursive") || lower.includes("-recurse")
      return {
        ...EMPTY,
        effect: "read",
        recursive,
        operands: ops.map((value) => ({ value, effect: "read" as const })),
        reads: true,
        network,
        encoded: decode,
        escape: escape(name, argv),
        url: url(argv),
      }
    }
    if (FETCHERS.has(name)) {
      const prev = (i: number) => (argv[i - 1] ?? "").toLowerCase()
      const out = argv
        .filter(
          (_, i) =>
            i > 0 &&
            ["-o", "--output", "-O", "--output-document", "-outfile"].includes(
              prev(i) === "-o" && argv[i - 1] === "-O" ? "-O" : prev(i),
            ),
        )
        .concat(
          argv
            .filter((arg) => arg.startsWith("--output=") || arg.startsWith("--output-document="))
            .map((arg) => arg.slice(arg.indexOf("=") + 1)),
        )
      const upload = argv.filter(
        (_, i) =>
          i > 0 &&
          [
            "-t",
            "--upload-file",
            "-d",
            "--data",
            "--data-binary",
            "--data-urlencode",
            "-f",
            "-F",
            "--form",
            "-infile",
            "-body",
          ].includes(prev(i)) &&
          !(argv[i - 1] === "-t" && name !== "curl"),
      )
      // Extract the payload file from curl's operand syntaxes: `@file` (`--data-binary`),
      // `field=@file` (`-F`), `name@file` (`--data-urlencode`), or a bare path (`--upload-file`).
      const files = upload
        .map((arg) => {
          const at = arg.lastIndexOf("@")
          return at >= 0 ? arg.slice(at + 1) : arg
        })
        .filter((value, i) => upload[i].includes("@") || /^[./~]/.test(value))
      return {
        ...EMPTY,
        effect: out.length > 0 ? "write" : undefined,
        operands: [
          ...out.map((value) => ({ value, effect: "write" as const })),
          ...files.map((value) => ({ value, effect: "read" as const })),
        ],
        network: true,
        url: url(argv),
        reads: files.length > 0,
        escape: escape(name, argv),
      }
    }
    if (NETWORK.has(name)) {
      return {
        ...EMPTY,
        network: true,
        url: url(argv),
        escape: escape(name, argv),
        metadata: ["ping", "traceroute", "dig", "nslookup", "host", "whois"].includes(name),
      }
    }
    if (METADATA.has(name)) {
      const ops = [
        "ls",
        "dir",
        "stat",
        "file",
        "du",
        "tree",
        "readlink",
        "realpath",
        "get-childitem",
        "get-item",
        "test-path",
        "resolve-path",
      ].includes(name)
        ? operands(argv)
        : []
      return {
        ...EMPTY,
        effect: ops.length > 0 ? "read" : undefined,
        operands: ops.map((value) => ({ value, effect: "read" as const })),
        metadata: true,
        escape: escape(name, argv),
      }
    }
    if (name === "open" || name === "xdg-open" || name === "start") {
      return {
        ...EMPTY,
        indirection: "interpreter",
        operands: operands(argv)
          .slice(0, 1)
          .map((value) => ({ value, effect: "exec" as const })),
        network: true,
        metadata: false,
      }
    }
    if (name === "start-process" || name === "saps") {
      // `Start-Process bash -ArgumentList '-c','rm -rf ~'`: hand the argument list to the shell analyser.
      const ops = operands(
        argv,
        new Set([
          "-argumentlist",
          "-args",
          "-workingdirectory",
          "-filepath",
          "-verb",
          "-windowstyle",
          "-redirectstandardoutput",
          "-redirectstandarderror",
          "-redirectstandardinput",
        ]),
      )
      const file = argv.find((_, i) => i > 0 && /^-filepath$/i.test(argv[i - 1] ?? "")) ?? ops[0]
      const list = argv
        .filter((_, i) => i > 0 && /^-(argumentlist|args)$/i.test(argv[i - 1] ?? ""))
        .flatMap((arg) => arg.split(","))
        .map(unquote)
      const target = file ? base(file) : undefined
      if (target && (SHELLS.has(target) || POWERSHELLS.has(target) || CMD.has(target)))
        return { ...EMPTY, ...shell(target, list) }
      return {
        ...EMPTY,
        indirection: "interpreter",
        operands: file ? [{ value: file, effect: "exec" as const }] : [],
        network: false,
        metadata: false,
        dynamic: list.length > 0,
      }
    }
    // Unrecognised command: any operand that escapes the workspace is classified with an unknown effect
    // so credential stores, startup files and system paths cannot be reached through a tool the model
    // does not know (shuf -o, ed, robocopy, Import-Csv, ...).
    const escaping = operands(argv)
      .map(dequote)
      .filter((op) => /^[\/~]|^\$\{?HOME|(^|[\/])\.\.([\/]|$)|%[^%]+%/.test(op))
    return {
      ...EMPTY,
      escape: escape(name, argv),
      operands: escaping.map((value) => ({ value, effect: "unknown" as const })),
      metadata: false,
    }
  }

  export function isShell(executable: string) {
    return SHELLS.has(executable) || POWERSHELLS.has(executable) || CMD.has(executable)
  }

  const GIT_KNOWN = new Set([
    ...GIT_READONLY,
    ...GIT_REMOTE,
    "add",
    "am",
    "apply",
    "branch",
    "cherry-pick",
    "checkout",
    "clean",
    "commit",
    "config",
    "init",
    "merge",
    "mv",
    "rebase",
    "reset",
    "restore",
    "rm",
    "stash",
    "switch",
    "tag",
    "update-index",
    "update-ref",
    "worktree",
    "gc",
    "notes",
    "revert",
    "format-patch",
    "archive",
    "bundle",
    "mailinfo",
    "mergetool",
    "difftool",
    "sparse-checkout",
    "maintenance",
    "prune",
    "replace",
    "filter-branch",
    "filter-repo",
  ])

  export function gitKnown(subcommand: string) {
    return GIT_KNOWN.has(subcommand)
  }

  export function isFetcher(executable: string) {
    return FETCHERS.has(executable)
  }

  export function isDecoder(executable: string, argv: string[]) {
    const f = flags(argv)
    if (executable === "base64" || executable === "base32") return f.has("-d") || f.has("--decode") || f.has("-D")
    if (executable === "xxd") return f.has("-r")
    if (executable === "openssl") return (argv[0] === "enc" && f.has("-d")) || (argv[0] === "base64" && f.has("-d"))
    return ["uudecode", "gunzip", "zcat", "bzcat", "xzcat", "unxz", "bunzip2"].includes(executable)
  }

  export function unquoteToken(text: string) {
    return unquote(text)
  }
}
