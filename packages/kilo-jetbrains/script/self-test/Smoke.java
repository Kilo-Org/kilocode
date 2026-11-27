package ai.kilocode.selftest;

import com.intellij.openapi.actionSystem.ActionManager;
import com.intellij.openapi.actionSystem.DataProvider;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.ProjectActivity;
import com.intellij.openapi.util.ActionCallback;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.openapi.wm.WindowManager;
import com.intellij.ui.content.Content;
import kotlin.Unit;
import kotlin.coroutines.Continuation;
import kotlinx.coroutines.flow.StateFlow;

import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.text.JTextComponent;
import java.awt.Component;
import java.awt.Container;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import java.util.Arrays;
import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

/** Disposable frontend-only companion installed beside, never in, the plugin under test. */
public final class Smoke implements ProjectActivity {
    private final Path dir = Path.of(System.getProperty("kilo.smoke.root"));
    private final String phase = System.getProperty("kilo.smoke.phase");
    private String step = "start";
    private JComponent chat;
    private ToolWindow window;
    private Content tab;
    private String lastStatus = "";

    @Override public Object execute(Project project, Continuation<? super Unit> continuation) {
        var thread = new Thread(() -> {
            try {
                run(project);
                mark("done");
                if (Files.exists(dir.resolve("rollback"))) {
                    var application = ApplicationManager.getApplication();
                    application.invokeLater(() -> application.exit(true, true, false));
                }
            } catch (Throwable e) {
                try {
                    if (chat != null) edt(() -> { capture("failure"); return null; });
                } catch (Exception ignored) { /* The frontend may already be closing. */ }
                try { mark("error", step + ": " + e); } catch (Exception ignored) {}
            }
        }, "Kilo fixture Swing driver");
        thread.setDaemon(true);
        thread.start();
        return Unit.INSTANCE;
    }

    private void run(Project project) throws Exception {
        await("fixture-frame", () -> {
            var frame = WindowManager.getInstance().getFrame(project);
            return project.getName().contains("kilo-smoke-project") && frame != null && frame.isShowing() ? frame : null;
        });
        mark("frame", "pid=" + ProcessHandle.current().pid() + " project=" + project.getName());
        if (phase.equals("probe")) return;
        if (Files.exists(dir.resolve("rollback"))) {
            boolean stable = phase.startsWith("stable-");
            var action = await("active-plugin-action", () -> ActionManager.getInstance().getAction("Kilo.NewSession"));
            var loader = action.getClass().getClassLoader();
            var settings = loader.loadClass("ai.kilocode.client.plugin.KiloPluginSettings");
            var prefs = settings.getField("INSTANCE").get(null);
            // The action and settings must belong to the enabled plugin, not a leftover module.
            var descriptor = ((com.intellij.ide.plugins.cl.PluginAwareClassLoader) loader).getPluginId().getIdString();
            if (!descriptor.equals(stable ? "ai.kilocode.jetbrains" : "ai.kilocode.jetbrains.v2"))
                throw new AssertionError("Unexpected active plugin: " + descriptor);
            boolean approved = (boolean) settings.getMethod("getAutoApprove").invoke(prefs);
            if (approved != phase.equals("stable-after")) throw new AssertionError("Unexpected auto-approve: " + phase);
            if (phase.equals("stable-before")) {
                settings.getMethod("setAutoApprove", boolean.class).invoke(prefs, true);
                // The harness stops the process immediately after the assertion, before IDE autosave.
                edt(() -> { ApplicationManager.getApplication().saveSettings(); return null; });
            }
            mark("plugin", descriptor + " autoApprove=" + approved);
            if (stable) return;
        }
        window = await("tool-window", () -> ToolWindowManager.getInstance(project).getToolWindow("Kilo Code"));
        edt(() -> { window.activate(null); return null; });
        tab = await("chat-tab", () -> Arrays.stream(window.getContentManager().getContents())
            .filter(c -> c.getDisplayName().equals("Chat")).findFirst().orElse(null));
        edt(() -> { window.getContentManager().setSelectedContent(tab, true); chat = tab.getComponent(); return null; });
        if (phase.equals("editor")) {
            var file = com.intellij.openapi.vfs.LocalFileSystem.getInstance().refreshAndFindFileByNioFile(
                dir.resolve("kilo-smoke-project/fixture.txt"));
            var editor = edt(() -> com.intellij.openapi.fileEditor.FileEditorManager.getInstance(project).openTextEditor(
                new com.intellij.openapi.fileEditor.OpenFileDescriptor(project, file), true));
            if (editor == null) throw new AssertionError("Could not open fixture source editor");
            edt(() -> {
                ApplicationManager.getApplication().runWriteAction(() -> editor.getDocument().setText("top\nfixture_selection_42\nend\n"));
                var doc = editor.getDocument();
                editor.getSelectionModel().setSelection(doc.getLineStartOffset(1), doc.getLineEndOffset(1));
                return null;
            });
            var actions = ActionManager.getInstance();
            var callback = edt(() -> actions.tryToExecute(actions.getAction("Kilo.ExplainSelection"), null, editor.getContentComponent(), null, true));
            await("explain-action", () -> callback.isDone() ? true : null);
            transcript("KILO_FIXTURE_EXPLAINED");
            var repo = dir.resolve("kilo-smoke-project");
            var vcs = com.intellij.openapi.vcs.ProjectLevelVcsManager.getInstance(project);
            edt(() -> {
                vcs.setDirectoryMappings(java.util.List.of(new com.intellij.openapi.vcs.VcsDirectoryMapping(repo.toString(), "Git")));
                return null;
            });
            await("git-root", () -> vcs.getAllVcsRoots().length == 1 ? true : null);
            var commit = edt(() -> new com.intellij.openapi.vcs.ui.CommitMessage(project));
            edt(() -> {
                var action = actions.getAction("Kilo.GenerateCommitMessage");
                var ctx = com.intellij.openapi.actionSystem.impl.SimpleDataContext.builder()
                    .add(com.intellij.openapi.actionSystem.CommonDataKeys.PROJECT, project)
                    .add(com.intellij.openapi.vcs.VcsDataKeys.COMMIT_MESSAGE_CONTROL, commit)
                    .add(com.intellij.openapi.vcs.VcsDataKeys.COMMIT_MESSAGE_DOCUMENT, commit.getEditorField().getDocument()).build();
                action.actionPerformed(com.intellij.openapi.actionSystem.AnActionEvent.createFromAnAction(action, null, "fixture", ctx));
                return null;
            });
            await("commit-input", () -> commit.getEditorField().getText().equals("test: add staged fixture") ? true : null);
            // The Git index stat cache may refresh; verify the indexed blob rather than its metadata.
            var git = new ProcessBuilder("git", "show", ":fixture.txt").directory(repo.toFile()).start();
            if (!new String(git.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).equals("before\n") || git.waitFor() != 0)
                throw new AssertionError("Commit generation changed the staged fixture");
            terminalSelection(project);
            return;
        }
        if (phase.equals("create")) {
            act("Kilo.NewSession");
            send("Update the smoke fixture");
            AbstractButton allow = await("permission-card", () -> tree(chat).filter(AbstractButton.class::isInstance)
                .map(AbstractButton.class::cast).filter(b -> b.isEnabled() && "Allow once".equalsIgnoreCase(b.getText())).findFirst().orElse(null));
            if (!Files.readString(dir.resolve("kilo-smoke-project/fixture.txt")).equals("before\n"))
                throw new AssertionError("Fixture changed before approval");
            edt(() -> { capture("permission"); allow.doClick(); return null; });
            transcript("KILO_FIXTURE_EDIT_FINISHED");
            if (!Files.readString(dir.resolve("kilo-smoke-project/fixture.txt")).equals("after\n"))
                throw new AssertionError("Approved edit was not applied");
            mark("edit", "before -> after (after Allow once)");
            edt(() -> { capture("edited"); return null; });
            return;
        }
        act("Kilo.History");
        var list = await("history-row", () -> tree(component("HistoryPanel")).filter(JList.class::isInstance)
            .map(JList.class::cast).filter(l -> l.getModel().getSize() > 0).findFirst().orElse(null));
        edt(() -> {
            capture("history");
            list.setSelectedIndex(0);
            var enter = list.getActionForKeyStroke(KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0));
            if (enter == null) throw new AssertionError("History has no Enter action");
            enter.actionPerformed(new ActionEvent(list, ActionEvent.ACTION_PERFORMED, "Enter"));
            return null;
        });
        transcript("KILO_FIXTURE_EDIT_FINISHED");
        send("Check fixture continuity");
        transcript("KILO_FIXTURE_RECONNECTED");
        edt(() -> { capture("reconnected"); return null; });
    }

    private void terminalSelection(Project project) throws Exception {
        var tabs = com.intellij.terminal.frontend.toolwindow.TerminalToolWindowTabsManager.getInstance(project);
        var terminal = edt(() -> tabs.createTabBuilder().workingDirectory(project.getBasePath())
            .shellCommand(java.util.List.of("/bin/sh", "-c", "printf 'fixture_terminal_42\\n'; while [ ! -e .terminal-finished ]; do sleep 1; done"))
            .deferSessionStartUntilUiShown(false).createTab());
        try {
            var view = terminal.getView();
            var token = "fixture_terminal_42";
            await("terminal-output", () -> {
                var model = view.getOutputModels().getActive().getValue();
                var start = model.getStartOffset();
                var index = model.getText(start, model.getEndOffset()).toString().indexOf(token);
                if (index < 0) return null;
                view.getTextSelectionModel().updateSelection(com.intellij.terminal.frontend.view.TerminalTextSelection.Companion.of(
                    start.plus(index), start.plus(index + token.length())));
                return true;
            });
            var context = com.intellij.openapi.actionSystem.impl.SimpleDataContext.builder()
                .add(com.intellij.openapi.actionSystem.CommonDataKeys.PROJECT, project)
                .add(com.intellij.terminal.frontend.view.TerminalView.Companion.getDATA_KEY(), view).build();
            for (String id : new String[]{"Kilo.AddTerminalSelection", "Kilo.ExplainTerminalSelection"}) {
                edt(() -> {
                    var action = ActionManager.getInstance().getAction(id);
                    var event = com.intellij.openapi.actionSystem.AnActionEvent.createFromDataContext("fixture", action.getTemplatePresentation().clone(), context);
                    action.update(event);
                    if (!event.getPresentation().isEnabled()) throw new AssertionError(id + " disabled for terminal selection");
                    action.actionPerformed(event);
                    return null;
                });
                if (id.equals("Kilo.AddTerminalSelection")) await("terminal-draft", () -> {
                    var panel = component("PromptPanel");
                    return panel != null && panel.getClass().getMethod("text").invoke(panel).toString().contains(token) ? true : null;
                });
            }
            transcript("KILO_FIXTURE_TERMINAL_EXPLAINED");
        } finally {
            // Closing a live terminal opens the IDE's process-termination confirmation on the EDT.
            // Release only this fixture process; the isolated IDE owns its tab until shutdown.
            Files.writeString(dir.resolve("kilo-smoke-project/.terminal-finished"), "done");
        }
    }

    private void act(String id) throws Exception {
        var inFlight = new AtomicReference<ActionCallback>();
        await(id, () -> {
            var last = inFlight.get();
            if (last != null && last.isDone()) return true;
            if (last != null && !last.isRejected()) return null;
            var context = component("PromptPanel");
            if (context == null) return null;
            var actions = ActionManager.getInstance();
            var action = actions.getAction(id);
            if (action == null) throw new AssertionError("Action not registered: " + id);
            inFlight.set(actions.tryToExecute(action, null, context, null, true));
            return null;
        });
    }

    private void send(String prompt) throws Exception {
        var panel = await("send-enabled", () -> {
            var current = component("PromptPanel");
            if (current == null) return null;
            if (!prompt.equals(current.getClass().getMethod("text").invoke(current)))
                current.getClass().getMethod("setText", String.class).invoke(current, prompt);
            if ((boolean) current.getClass().getMethod("isSendEnabled").invoke(current)) return current;
            var workspace = ((DataProvider) chat).getData("ai.kilocode.client.session.Workspace");
            var type = current.getClass().getClassLoader().loadClass("ai.kilocode.client.app.KiloAppService");
            var status = "app=" + state(ApplicationManager.getApplication().getService(type)) + " workspace=" + state(workspace);
            if (!status.equals(lastStatus)) { mark("readiness", status); lastStatus = status; }
            return null;
        });
        edt(() -> { panel.getClass().getMethod("send").invoke(panel); return null; });
    }

    private static String state(Object service) throws Exception {
        var flow = (StateFlow<?>) service.getClass().getMethod("getState").invoke(service);
        Object value = flow.getValue();
        Object status = value.getClass().getMethod("getStatus").invoke(value);
        return "ERROR".equals(String.valueOf(status)) ? status + ": " + value.getClass().getMethod("getError").invoke(value) : String.valueOf(status);
    }

    private void transcript(String marker) throws Exception {
        await(marker, () -> tree(component("SessionMessageListPanel")).filter(c -> {
            if (c instanceof JTextComponent t && t.getText().contains(marker)) return true;
            if (c instanceof JLabel l && String.valueOf(l.getText()).contains(marker)) return true;
            var a = c.getAccessibleContext();
            return a != null && String.valueOf(a.getAccessibleName()).contains(marker);
        }).findFirst().orElse(null));
        mark(marker);
    }

    private Component component(String name) {
        return tree(chat).filter(c -> c.getClass().getSimpleName().equals(name)).findFirst().orElse(null);
    }

    private static Stream<Component> tree(Component c) {
        if (c == null || !c.isShowing()) return Stream.empty();
        return c instanceof Container p ? Stream.concat(Stream.of(c), Arrays.stream(p.getComponents()).flatMap(Smoke::tree)) : Stream.of(c);
    }

    private void capture(String name) throws Exception {
        // Paint only the fixture's chat surface; never screenshot another application or the desktop.
        var image = new BufferedImage(chat.getWidth(), chat.getHeight(), BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        try { chat.printAll(graphics); } finally { graphics.dispose(); }
        ImageIO.write(image, "PNG", dir.resolve(phase + "-" + name + ".png").toFile());
    }

    private <T> T await(String name, Callable<T> operation) throws Exception {
        step = name;
        mark("step", name);
        long deadline = System.nanoTime() + 120_000_000_000L;
        boolean captured = false;
        do {
            T value = edt(() -> {
                // IDEA can activate its Project pane after the first project scan. Reopen
                // the chat rather than driving detached Swing widgets behind another pane.
                if (chat != null && !chat.isShowing()) {
                    if (!window.isVisible()) window.show();
                    if (window.getContentManager().getSelectedContent() != tab) window.getContentManager().setSelectedContent(tab, true);
                    return null;
                }
                return operation.call();
            });
            if (value != null) return value;
            if (!captured && chat != null && System.nanoTime() > deadline - 115_000_000_000L) {
                edt(() -> { capture(name); return null; });
                captured = true;
            }
            Thread.sleep(250);
        } while (System.nanoTime() < deadline);
        throw new AssertionError("Timed out waiting for " + name);
    }

    private static <T> T edt(Callable<T> call) throws Exception {
        var result = new FutureTask<>(call);
        SwingUtilities.invokeLater(result);
        return result.get(30, java.util.concurrent.TimeUnit.SECONDS);
    }

    private void mark(String name) throws Exception { mark(name, name); }
    private void mark(String name, String value) throws Exception {
        Files.writeString(dir.resolve(phase + "." + name), value + "\n");
    }
}
