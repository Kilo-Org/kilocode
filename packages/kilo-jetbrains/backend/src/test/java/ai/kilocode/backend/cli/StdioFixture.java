package ai.kilocode.backend.cli;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

/** An actual child with stdout, stdin and an authenticated socket, also runnable on Windows. */
public final class StdioFixture {
    public static void main(String[] args) throws Exception {
        if (!Arrays.asList(args).subList(2, args.length).equals(List.of("serve", "--port", "0", "--stdio")))
            throw new IllegalArgumentException("Unexpected CLI arguments");
        long pid = ProcessHandle.current().pid();
        Files.writeString(Path.of(pid + ".started"), "");
        String secret = System.getenv("OPENCODE_PASSWORD");
        String auth = "Basic " + Base64.getEncoder().encodeToString(("opencode:" + secret).getBytes(StandardCharsets.UTF_8));
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/info", exchange -> {
            boolean allowed = auth.equals(exchange.getRequestHeaders().getFirst("Authorization"));
            String version = args[0].equals("mismatch") ? "wrong" : "fixture";
            byte[] data = (allowed ? "{\"pid\":" + pid + ",\"version\":\"" + version + "\"}" : "{}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
            exchange.sendResponseHeaders(allowed ? 200 : 401, data.length);
            exchange.getResponseBody().write(data);
            exchange.close();
        });
        server.start();
        System.out.println("server listening on http://127.0.0.1:" + server.getAddress().getPort());
        System.out.println("{malformed");
        System.out.println("{\"url\":\"https://example.invalid\"}");
        if (!args[1].isEmpty()) System.out.println("{\"url\":\"" + args[1] + "\"}");
        if (!args[0].equals("legacy-text-only")) System.out.println("{\"url\":\"http://127.0.0.1:" + server.getAddress().getPort() + "\"}");
        System.out.flush();
        // stdout must keep draining after readiness, rather than deadlocking a verbose CLI.
        System.out.println("x".repeat(256 * 1024));
        while (System.in.read() != -1) {}
        Files.writeString(Path.of(pid + ".eof"), "");
        server.stop(0);
    }
}
