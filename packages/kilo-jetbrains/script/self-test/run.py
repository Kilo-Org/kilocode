"""Run the installed native plugin in disposable local and split IDEs; see README.md."""

import argparse
import contextlib
import hashlib
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
from fixture import start

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def ide_files(path):
    home = path.expanduser().resolve()
    if (home / "Contents").is_dir():
        home /= "Contents"
    info = next((p for p in (home / "Resources/product-info.json", home / "product-info.json") if p.exists()), None)
    if not info:
        raise ValueError("--ide must be an extracted IntelliJ IDEA distribution with a bundled JBR")
    product = json.loads(info.read_text())
    launch = next(p for p in product["launch"] if p["os"] == {"darwin": "macOS", "linux": "Linux"}[sys.platform])
    return home, info.parent, product, launch


def install_driver(java, home, root, plugins):
    classes = root / "driver-classes"
    classes.mkdir()
    subprocess.run([java.with_name("javac"), "-proc:none", "-cp", str(home / "lib/*"), "-d", classes, HERE / "Smoke.java"], check=True)
    lib = plugins / "kilo-smoke-driver/lib"
    (lib / "modules").mkdir(parents=True)
    with zipfile.ZipFile(lib / "driver.jar", "w") as jar:
        jar.writestr("META-INF/plugin.xml", """<idea-plugin><id>ai.kilocode.selftest</id><name>Kilo fixture driver</name>
<vendor>Kilo</vendor><version>1</version><depends>com.intellij.modules.platform</depends>
<content><module name="kilo.selftest.frontend"/></content></idea-plugin>""")
    with zipfile.ZipFile(lib / "modules/kilo.selftest.frontend.jar", "w") as jar:
        jar.writestr("kilo.selftest.frontend.xml", """<idea-plugin><dependencies><module name="intellij.platform.frontend"/></dependencies>
<extensions defaultExtensionNs="com.intellij"><postStartupActivity implementation="ai.kilocode.selftest.Smoke"/></extensions></idea-plugin>""")
        for file in classes.rglob("*.class"):
            jar.write(file, file.relative_to(classes))


def env_for(root, config, origin):
    # In particular do not inherit the agent's KILO_*, OPENCODE_*, AUTH_*,
    # proxies, JVM options, API keys, GIT_CONFIG_* or SSH agent socket.
    env = {k: os.environ[k] for k in ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "SYSTEMROOT") if k in os.environ}
    bun = shutil.which("bun")
    if not bun:
        raise ValueError("Bun is required to run the checkout's isolated CLI")
    env.update(PATH=os.pathsep.join([str(Path(bun).parent), "/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
               HOME=str(root / "home"), USER="fixture", LOGNAME="fixture", SHELL="/bin/sh", LANG="en_US.UTF-8",
               TMPDIR=str(root / "tmp"), GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0",
               KILO_V2_PROFILE=str(root / "profile"), KILO_TEST_HOME=str(root / "profile/home"),
               OPENCODE_CONFIG_CONTENT=json.dumps(config), KILO_DISABLE_MODELS_FETCH="1", KILO_DISABLE_AUTOUPDATE="1",
               KILO_API_URL=origin, KILO_AI_GATEWAY_URL=origin + "/v1", NO_PROXY="localhost,127.0.0.1",
               REMOTE_DEV_TRUST_PROJECTS="1", REMOTE_DEV_NON_INTERACTIVE="1", CWM_NO_TIMEOUTS="1")
    for kind in ("CONFIG", "DATA", "CACHE", "STATE"):
        env["XDG_" + kind + "_HOME"] = str(root / "xdg" / kind.lower())
    for path in (root / "home", root / "tmp", root / "profile/home"):
        path.mkdir(parents=True)
    return env


def launch(files, root, side, phase, args, env):
    home, meta, _, launch = files
    target = next(c for c in launch["customCommands"] if "thinClient" in c["commands"]) if side == "frontend" else launch
    replace = lambda s: s.replace("$APP_PACKAGE/Contents", str(home)).replace("$IDE_HOME", str(home))
    options = [replace(l.strip()) for l in (meta / target["vmOptionsFilePath"]).read_text().splitlines() if l.strip() and not l.startswith("#")]
    options.extend(replace(l) for l in target["additionalJvmArguments"])
    dirs = {k: root / side / k for k in ("config", "system", "log", "plugins")}
    for d in dirs.values():
        d.mkdir(parents=True, exist_ok=True)
    props = root / side / "idea.properties"
    props.write_text("".join(f"idea.{k}.path={v}\n" for k, v in dirs.items()))
    options.extend(f"-Didea.{k}.path={v}" for k, v in dirs.items())
    options.extend([f"-Didea.properties.file={props}", f"-Didea.home.path={home}", f"-Duser.home={env['HOME']}",
                    f"-Djava.io.tmpdir={env['TMPDIR']}", f"-Dkilo.dev.worktree.root={REPO}", f"-Dkilo.smoke.root={root}",
                    f"-Dkilo.smoke.phase={phase}", "-Didea.is.internal=true", "-Didea.plugin.in.sandbox.mode=true",
                    "-Didea.trust.all.projects=true", "-Didea.initially.ask.config=never", "-Dide.no.platform.update=true",
                    "-Didea.load.shell.env=false", "-Didea.suppress.statistics.report=true", "-Djb.consents.confirmation.enabled=false",
                    "-Dide.experimental.ui.onboarding=false", "-Dide.show.tips.on.startup.default.value=false",
                    "-Dide.mac.screenmenu=false", "-Dnosplash=true", "-Xmx2g"])
    cp = os.pathsep.join(str(home / "lib" / jar) for jar in target["bootClassPathJarNames"])
    with (root / f"{side}-{phase}.log").open("w") as log:
        return subprocess.Popen([meta / launch["javaExecutablePath"], *options, "-cp", cp, target["mainClass"], *args],
                                env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)


def stop(proc):
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(12)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()


def wait(proc, what, check, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        if proc.poll() is not None:
            raise RuntimeError(f"{what}: IDE exited with status {proc.returncode}")
        time.sleep(.25)
    raise TimeoutError(f"timed out after {timeout}s: {what}")


def session(files, root, mode, artifact, probe, keep):
    home, meta, product, manifest = files
    root.mkdir(mode=0o700)
    project = root / "kilo-smoke-project"
    project.mkdir()
    (project / "fixture.txt").write_text("before\n")
    model, config, base = start()
    report = {"mode": mode, "ideBuild": product["buildNumber"], "probe": probe, "phases": [], "modelEvents": model.events}
    try:
        env = env_for(root, config, base)
        if artifact:
            report["pluginSha256"] = hashlib.sha256(artifact.read_bytes()).hexdigest()
        subprocess.run(["git", "init", "-q", project], env=env, check=True)
        side = "local" if mode == "local" else "frontend"
        for target in ([side] if mode == "local" else ["backend", side]):
            plugins = root / target / "plugins"
            plugins.mkdir(parents=True)
            if artifact:
                with zipfile.ZipFile(artifact) as z:
                    z.extractall(plugins)
            if target == side:
                install_driver(meta / manifest["javaExecutablePath"], home, root, plugins)
        args = [str(project)]
        with contextlib.ExitStack() as cleanup:
            if mode == "split":
                with socket.socket() as sock:
                    sock.bind(("127.0.0.1", 0))
                    port = sock.getsockname()[1]
                # The same local split-mode entrypoints used by IntelliJ Platform's runIdeSplitMode.
                env.update(CWM_HOST_PASSWORD="fixture-only", CWM_CLIENT_PASSWORD="fixture-only")
                backend = launch(files, root, "backend", "host", ["serverMode", "-l", "127.0.0.1", "-p", str(port), str(project)], env)
                cleanup.callback(stop, backend)
                def join_link():
                    text = (root / "backend-host.log").read_text(errors="replace")
                    return re.search(rf"tcp://(?:localhost|127\.0\.0\.1):{port}[^\s\x1b]+", text)
                link = wait(backend, "loopback backend join link (backend-host.log)", join_link, 120).group(0)
                args = ["thinClient", link + ("&" if "#" in link else "#") + "remoteId=Split%20Mode", "--refresh-split-mode-token=true"]
                report["backendPid"] = backend.pid
            for phase in (["probe"] if probe else ["create", "reconnect"]):
                ui = launch(files, root, side, phase, args, env)
                try:
                    with (root / f"{side}-{phase}.log").open(errors="replace") as log:
                        def check():
                            if (root / (phase + ".error")).exists():
                                raise AssertionError((root / (phase + ".error")).read_text().strip())
                            if "#LicenseManager - License required;" in log.read() and not (root / (phase + ".frame")).exists():
                                raise RuntimeError(f"{side}: JetBrains requires a license in the isolated profile before project startup")
                            if mode == "split" and backend.poll() is not None:
                                raise RuntimeError(f"Split backend exited with status {backend.returncode}")
                            return (root / (phase + ".done")).exists()
                        wait(ui, f"{side}/{phase} (see {phase}.step; use --keep-sandbox for IDE logs)", check, 300)
                    frame = (root / (phase + ".frame")).read_text().strip()
                    if not frame.startswith(f"pid={ui.pid} "):
                        raise AssertionError("Driver did not run inside the expected IDE process")
                    report["phases"].append({"name": phase, "frame": frame})
                finally:
                    stop(ui)
            if not probe:
                if "edit-complete" not in model.events or "reconnected" not in model.events:
                    raise AssertionError("Missing fixture-model edit result or post-reconnect request")
            report["status"] = "passed"
    except Exception as e:
        report.update(status="failed", error=str(e))
    finally:
        model.shutdown()
        model.server_close()
        (root / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        if not keep:
            # Everything below root was created for this one lane. Retain just the
            # pass/fail evidence, not IDE caches, logs with join tokens, or profiles.
            for child in root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                elif child.suffix == ".log":
                    child.unlink()
    print(json.dumps(report), flush=True)
    return report["status"] == "passed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ide", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--plugin", type=Path, help="Installable buildPlugin zip")
    source.add_argument("--probe", action="store_true", help="Prove isolated IDE startup only; no Kilo assertions")
    parser.add_argument("--mode", choices=["local", "split", "both"], default="both")
    parser.add_argument("--output-parent", type=Path, help="Existing directory for a fresh private evidence directory")
    parser.add_argument("--keep-sandbox", action="store_true", help="Keep private profiles and IDE logs for troubleshooting")
    cli = parser.parse_args()
    if cli.plugin and not cli.plugin.is_file():
        parser.error(f"Missing plugin artifact: {cli.plugin}")
    files = ide_files(cli.ide)
    root = Path(tempfile.mkdtemp(prefix="kjs-", dir=cli.output_parent)).resolve()
    print(f"Evidence: {root}", flush=True)
    results = [session(files, root / m, m, cli.plugin, cli.probe, cli.keep_sandbox) for m in (["local", "split"] if cli.mode == "both" else [cli.mode])]
    sys.exit(0 if all(results) else 1)
