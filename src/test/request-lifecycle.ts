import * as assert from "assert";
import { getEventListeners } from "events";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { AWClient, FetchError } from "../aw-client";

const operations = {
    events: (client: AWClient) => client.getEvents("test"),
    query: (client: AWClient) =>
        client.query(["2026-01-01/2026-01-02"], ["RETURN = 1;"]),
    heartbeat: (client: AWClient) =>
        client.heartbeat("test", 5, {
            timestamp: new Date("2026-01-01"),
            duration: 0,
            data: {},
        }),
};

describe("JSON request lifecycle", function () {
    this.timeout(5000);
    let server: Server;
    let baseURL: string;
    let body: string;
    let status: number;
    let delay: number;
    const originalFetch = global.fetch;

    beforeEach(async () => {
        body = "[]";
        status = 200;
        delay = 500;
        server = createServer((req, res) => {
            req.resume();
            res.writeHead(status, { "Content-Type": "application/json" });
            res.flushHeaders();
            const timer = setTimeout(() => res.end(body), delay);
            res.on("close", () => clearTimeout(timer));
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterEach(async () => {
        global.fetch = originalFetch;
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    });

    for (const [name, request] of Object.entries(operations)) {
        it(`${name}: enforces the timeout while the body is pending`, async () => {
            const client = new AWClient("lifecycle", { baseURL, timeout: 200 });
            if (name === "heartbeat") {
                body = '{"timestamp":"2026-01-01","duration":0,"data":{}}';
            }
            await assert.rejects(request(client), { name: "AbortError" });
            assert.equal(
                getEventListeners(client.controller.signal, "abort").length,
                0,
            );
        });

        it(`${name}: propagates cancellation after headers`, async () => {
            const client = new AWClient("lifecycle", {
                baseURL,
                timeout: 2000,
            });
            const signal = client.controller.signal;
            if (name === "heartbeat") {
                body = '{"timestamp":"2026-01-01","duration":0,"data":{}}';
            }
            let headersDelivered!: () => void;
            const headers = new Promise<void>((resolve) => {
                headersDelivered = resolve;
            });
            global.fetch = async (...args) => {
                const response = await originalFetch(...args);
                headersDelivered();
                return response;
            };
            const pending = request(client);
            const rejected = assert.rejects(pending, { name: "AbortError" });
            await headers;
            // Let the response handlers run before aborting the pending body.
            await new Promise<void>((resolve) => setImmediate(resolve));
            await client.abort();
            await rejected;
            assert.equal(getEventListeners(signal, "abort").length, 0);
        });
    }

    it("cleans up listeners after body success and preserves JSON values", async () => {
        body = JSON.stringify([
            {
                id: 1,
                timestamp: "2026-01-01",
                duration: 2,
                data: { title: "test" },
            },
        ]);
        delay = 20;
        const client = new AWClient("lifecycle", { baseURL, timeout: 2000 });
        const events = await client.getEvents("test");
        assert.equal(events[0].data.title, "test");
        assert.ok(events[0].timestamp instanceof Date);
        assert.equal(
            getEventListeners(client.controller.signal, "abort").length,
            0,
        );
    });

    it("cleans up listeners when JSON parsing fails", async () => {
        body = "invalid JSON";
        delay = 0;
        const client = new AWClient("lifecycle", { baseURL, timeout: 2000 });
        await assert.rejects(client.getEvents("test"), SyntaxError);
        assert.equal(
            getEventListeners(client.controller.signal, "abort").length,
            0,
        );
    });

    it("cleans up listeners on HTTP failure", async () => {
        status = 500;
        const client = new AWClient("lifecycle", { baseURL, timeout: 2000 });
        await assert.rejects(client.getEvents("test"), FetchError);
        assert.equal(
            getEventListeners(client.controller.signal, "abort").length,
            0,
        );
    });
});
