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
        window = await("tool-window", () -> ToolWindowManager.getInstance(project).getToolWindow("Kilo Code"));
        edt(() -> { window.activate(null); return null; });
        tab = await("chat-tab", () -> Arrays.stream(window.getContentManager().getContents())
            .filter(c -> c.getDisplayName().equals("Chat")).findFirst().orElse(null));
        edt(() -> { window.getContentManager().setSelectedContent(tab, true); chat = tab.getComponent(); return null; });
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
