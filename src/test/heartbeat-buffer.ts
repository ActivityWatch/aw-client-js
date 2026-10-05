import * as assert from "assert";
import { AWClient, HeartbeatBuffer, IEvent } from "../aw-client";

const sample = (
    seconds: number,
    data = { label: "same" },
    duration = 0,
): IEvent => ({
    timestamp: new Date(seconds * 1000),
    duration,
    data,
});

describe("Heartbeat pre-merging", () => {
    let originalFetch: typeof fetch;
    let sent: IEvent[];
    let client: AWClient;

    beforeEach(() => {
        sent = [];
        client = new AWClient("premerge-test");
        originalFetch = global.fetch;
        global.fetch = (async (_url, init) => {
            sent.push(JSON.parse(init!.body as string));
            return new Response(init!.body as string, { status: 200 });
        }) as typeof fetch;
    });
    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("leaves ordinary heartbeat calls unbuffered", async () => {
        await Promise.all(
            [0, 1, 2].map((time) => client.heartbeat("test", 5, sample(time))),
        );
        assert.equal(sent.length, 3);
    });

    it("merges identical data into one request with the full duration", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5);
        for (let time = 0; time < 5; time++) buffer.heartbeat(sample(time));
        assert.equal(sent.length, 0);
        await buffer.flush();
        assert.equal(sent.length, 1);
        assert.equal(sent[0].duration, 4);
        assert.equal(sent[0].timestamp, new Date(0).toISOString());
    });

    it("flushes on data changes, preserving request order", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5);
        buffer.heartbeat(sample(0));
        buffer.heartbeat(sample(1, { label: "changed" }));
        await buffer.flush();
        assert.deepEqual(
            sent.map((event) => event.data.label),
            ["same", "changed"],
        );
    });

    it("keeps gaps beyond pulsetime and out-of-order samples separate", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5);
        [0, 6, 3].forEach((time) => buffer.heartbeat(sample(time)));
        await buffer.flush();
        assert.equal(sent.length, 3);
    });

    it("includes the pulsetime boundary and never shortens overlapping samples", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5);
        buffer.heartbeat(sample(0, { label: "same" }, 10));
        buffer.heartbeat(sample(2));
        buffer.heartbeat(sample(15, { label: "same" }, 1));
        await buffer.flush();
        assert.equal(sent.length, 1);
        assert.equal(sent[0].duration, 16);
    });

    it("compares data independent of property order and snapshots caller mutations", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5);
        const first: IEvent = { timestamp: new Date(0), data: { a: 1, b: 2 } };
        buffer.heartbeat(first);
        first.data.a = 999;
        first.timestamp.setTime(999);
        buffer.heartbeat({ timestamp: new Date(1000), data: { b: 2, a: 1 } });
        await buffer.flush();
        assert.equal(sent.length, 1);
        assert.equal(sent[0].duration, 1);
        assert.deepEqual(sent[0].data, { a: 1, b: 2 });
    });

    it("delivers the last sample on a timer without another heartbeat", async () => {
        const buffer = new HeartbeatBuffer(client, "test", 5, {
            commitInterval: 0.01,
        });
        buffer.heartbeat(sample(0));
        await new Promise((resolve) => setTimeout(resolve, 30));
        await buffer.flush();
        assert.equal(sent.length, 1);
    });

    it("reports transport failures to flush and the background error handler", async () => {
        const failure = new Error("offline");
        const errors: unknown[] = [];
        global.fetch = async () => {
            throw failure;
        };
        const buffer = new HeartbeatBuffer(client, "test", 5, {
            onError: (error) => errors.push(error),
        });
        buffer.heartbeat(sample(0));
        await assert.rejects(buffer.flush(), (error) => error === failure);
        assert.deepEqual(errors, [failure]);
    });

    it("flush waits for all outstanding sends before rejecting", async () => {
        // Regression for Promise.all: if request A fails before request B
        // completes, Promise.all rejects immediately while B is still running.
        // Promise.allSettled waits for both before the caller sees the failure.
        let releaseB!: () => void;
        let callCount = 0;
        const failure = new Error("offline");
        global.fetch = (async () => {
            const n = ++callCount;
            if (n === 1) throw failure; // request A: fails immediately
            // request B: blocks until released
            await new Promise<void>((r) => {
                releaseB = r;
            });
            return new Response("{}", { status: 200 });
        }) as unknown as typeof fetch;
        const buffer = new HeartbeatBuffer(client, "test", 5, {
            onError: () => {
                // intentionally empty: this test checks flush ordering, not error handling
            },
        });
        buffer.heartbeat(sample(0));
        buffer.heartbeat(sample(10)); // different data → sends sample(0) → A
        const flushPromise = buffer.flush(); // sends sample(10) → B (blocks)
        // Let microtasks run: A rejects, B starts but blocks.
        await new Promise((r) => setTimeout(r, 0));
        // flush() must still be pending — it must be waiting for B.
        let flushed = false;
        flushPromise.finally(() => {
            flushed = true;
        });
        await Promise.resolve();
        assert.equal(
            flushed,
            false,
            "flush() must not settle while B is still in-flight",
        );
        releaseB();
        await assert.rejects(flushPromise, (error) => error === failure);
    });

    it("reports background timer failures without an unhandled rejection", async () => {
        const failure = new Error("offline");
        global.fetch = async () => {
            throw failure;
        };
        let report: (error: unknown) => void;
        const reported = new Promise((resolve) => {
            report = resolve;
        });
        const buffer = new HeartbeatBuffer(client, "test", 5, {
            commitInterval: 0.01,
            onError: (error) => report(error),
        });
        buffer.heartbeat(sample(0));
        assert.equal(await reported, failure);
        await buffer.flush();
    });

    it("isolates independent bucket buffers", async () => {
        const first = new HeartbeatBuffer(client, "first", 5);
        const second = new HeartbeatBuffer(client, "second", 5);
        first.heartbeat(sample(0));
        second.heartbeat(sample(1));
        await first.flush();
        assert.equal(sent.length, 1);
        await second.flush();
        assert.equal(sent.length, 2);
    });
});
