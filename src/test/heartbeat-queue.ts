import * as assert from "assert";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { AWClient, IEvent } from "../aw-client";

describe("Heartbeat queue", function () {
    this.timeout(5000);
    let server: Server;
    let baseURL: string;
    let received: { timestamp: string; data: { title: string } }[];
    let respond: (event: string) => string;

    beforeEach(async () => {
        received = [];
        respond = (event) => event;
        server = createServer((req, res) => {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                received.push(JSON.parse(body));
                // Keep the first heartbeat in flight so later ones queue up.
                setTimeout(() => {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(respond(body));
                }, 50);
            });
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    });

    it("sends each queued heartbeat as it was when heartbeat() was called", async () => {
        const client = new AWClient("heartbeat-queue", { baseURL });
        const event: IEvent = {
            timestamp: new Date("2026-01-01T00:00:00Z"),
            duration: 0,
            data: { title: "first" },
        };
        const first = client.heartbeat("bucket", 10, event);
        // A watcher that updates one event object between ticks.
        event.data = { title: "second" };
        event.timestamp = new Date("2026-01-01T00:00:05Z");
        const second = client.heartbeat("bucket", 10, event);
        event.data.title = "third";
        event.timestamp.setUTCSeconds(10);
        const third = client.heartbeat("bucket", 10, event);
        await Promise.all([first, second, third]);

        assert.deepEqual(
            received.map((e) => [e.timestamp, e.data.title]),
            [
                ["2026-01-01T00:00:00.000Z", "first"],
                ["2026-01-01T00:00:05.000Z", "second"],
                ["2026-01-01T00:00:10.000Z", "third"],
            ],
        );
    });

    it("resolves when the server double-encodes the merged event", async () => {
        // Same server behaviour as ActivityWatch/aw-client-js#45: the body is a
        // JSON string containing the event. The heartbeat was stored, so it
        // must not be reported as failed.
        respond = (event) => JSON.stringify(event);
        const client = new AWClient("heartbeat-queue", { baseURL });
        await client.heartbeat("bucket", 10, {
            timestamp: new Date("2026-01-01T00:00:00Z"),
            duration: 0,
            data: { title: "first" },
        });
        assert.equal(received.length, 1);
    });
});
