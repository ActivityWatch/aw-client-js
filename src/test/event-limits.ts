import * as assert from "assert";
import * as http from "http";
import { AddressInfo } from "net";
import { AWClient } from "../aw-client";

describe("getEvents limit serialization", () => {
    let server: http.Server;
    let client: AWClient;
    let requested: URL;
    const timestamp = "2026-10-01T01:00:00.000Z";

    before(async () => {
        server = http.createServer((req, res) => {
            requested = new URL(req.url!, "http://127.0.0.1");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify([
                    { id: 1, timestamp, duration: 1, data: { title: "test" } },
                ]),
            );
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const port = (server.address() as AddressInfo).port;
        client = new AWClient("limit-test", {
            baseURL: `http://127.0.0.1:${port}`,
        });
    });

    after(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve())),
        );
    });

    for (const limit of [0, 1, -1]) {
        it(`transmits limit=${limit} alongside date filters and parses events`, async () => {
            const start = new Date("2026-10-01T00:00:00Z");
            const end = new Date("2026-10-02T00:00:00Z");
            const events = await client.getEvents("synthetic", {
                limit,
                start,
                end,
            });
            assert.strictEqual(
                requested.pathname,
                "/api/0/buckets/synthetic/events",
            );
            assert.strictEqual(
                requested.searchParams.get("limit"),
                String(limit),
            );
            assert.strictEqual(
                requested.searchParams.get("start"),
                start.toISOString(),
            );
            assert.strictEqual(
                requested.searchParams.get("end"),
                end.toISOString(),
            );
            // The fixture always returns one event: limit enforcement belongs to
            // the server, and the client must still parse the response normally.
            assert.strictEqual(events.length, 1);
            assert.strictEqual(events[0].timestamp.toISOString(), timestamp);
            assert.strictEqual(events[0].data.title, "test");
        });
    }

    it("omits the limit when options are absent", async () => {
        await client.getEvents("synthetic");
        assert.strictEqual(requested.searchParams.has("limit"), false);
    });

    for (const limit of [undefined, null as unknown as number]) {
        it(`omits an explicit ${limit} limit`, async () => {
            // null is not part of the typed API; preserve existing JS behavior.
            await client.getEvents("synthetic", { limit });
            assert.strictEqual(requested.searchParams.has("limit"), false);
        });
    }
});
