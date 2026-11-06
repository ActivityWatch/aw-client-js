import * as assert from "assert";
import { AWClient, IEvent } from "../aw-client";

const bucketIds = ["__proto__", "constructor", "toString", "ordinary"];
const timestamp = "2026-10-01T00:00:00.000Z";

function event(sequence: number): IEvent {
    return { timestamp: new Date(timestamp), data: { sequence } };
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function heartbeatResponse() {
    return new Response(JSON.stringify({ timestamp, data: {} }));
}

// Await the queue's settlement continuation, without relying on elapsed time.
function nextTurn(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("Bucket dictionary keys", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("lists every own bucket key while retaining the public object shape", async () => {
        const raw = Object.fromEntries(
            bucketIds.map((id) => [
                id,
                {
                    id,
                    name: id,
                    type: "test",
                    client: "bucket-key-test",
                    hostname: "unknown",
                    created: timestamp,
                    last_update: timestamp,
                    data: { label: id },
                },
            ]),
        );
        globalThis.fetch = async () => new Response(JSON.stringify(raw));
        const client = new AWClient("bucket-key-test");
        const buckets = await client.getBuckets();

        assert.deepStrictEqual(Object.keys(buckets), bucketIds);
        assert.strictEqual(Object.getPrototypeOf(buckets), Object.prototype);

        assert.deepStrictEqual(
            Object.keys(JSON.parse(JSON.stringify(buckets))),
            bucketIds,
        );
        for (const id of bucketIds) {
            assert.ok(Object.prototype.hasOwnProperty.call(buckets, id));
            assert.strictEqual(buckets[id].id, id);
            assert.deepStrictEqual(buckets[id].data, { label: id });
            assert.strictEqual(buckets[id].created.toISOString(), timestamp);
            assert.strictEqual(
                buckets[id].last_update?.toISOString(),
                timestamp,
            );
        }
    });

    for (const id of bucketIds) {
        it(`sends a heartbeat for the literal bucket key ${id}`, async () => {
            const requests: string[] = [];
            globalThis.fetch = async (input) => {
                requests.push(String(input));
                return heartbeatResponse();
            };
            const client = new AWClient("bucket-key-test", {
                baseURL: "http://127.0.0.1:1",
            });
            assert.strictEqual(
                await client.heartbeat(id, 5, event(1)),
                undefined,
            );
            assert.deepStrictEqual(requests, [
                `http://127.0.0.1:1/api/0/buckets/${id}/heartbeat?pulsetime=5`,
            ]);
        });

        it(`keeps FIFO and failure settlement independent for ${id}`, async () => {
            const first = deferredResponse();
            const second = deferredResponse();
            const requests: { path: string; sequence: number }[] = [];
            globalThis.fetch = async (input, init) => {
                const body = JSON.parse(String(init?.body));
                requests.push({
                    path: new URL(String(input)).pathname,
                    sequence: body.data.sequence,
                });
                if (body.data.sequence === 1) return first.promise;
                if (body.data.sequence === 2) return second.promise;
                return heartbeatResponse();
            };
            const client = new AWClient("bucket-key-test");
            const settlements: string[] = [];
            const failed = assert
                .rejects(
                    client.heartbeat(id, 5, event(1)),
                    /Failed fetch with status code 500/,
                )
                .then(() => settlements.push("first rejected"));
            const queued = client
                .heartbeat(id, 5, event(2))
                .then(() => settlements.push("second resolved"));
            const separateId = id === "__proto__" ? "constructor" : "__proto__";
            await client.heartbeat(separateId, 5, event(3));
            assert.deepStrictEqual(requests, [
                { path: `/api/0/buckets/${id}/heartbeat`, sequence: 1 },
                { path: `/api/0/buckets/${separateId}/heartbeat`, sequence: 3 },
            ]);
            assert.deepStrictEqual(settlements, []);

            first.resolve(new Response("failure", { status: 500 }));
            await failed;
            await nextTurn();
            assert.deepStrictEqual(requests[2], {
                path: `/api/0/buckets/${id}/heartbeat`,
                sequence: 2,
            });
            assert.deepStrictEqual(settlements, ["first rejected"]);
            second.resolve(heartbeatResponse());
            await queued;
            assert.deepStrictEqual(settlements, [
                "first rejected",
                "second resolved",
            ]);

            // Reuse the drained queue: a rejection must not leave it processing.
            await client.heartbeat(id, 5, event(4));
            assert.deepStrictEqual(requests[3], {
                path: `/api/0/buckets/${id}/heartbeat`,
                sequence: 4,
            });
        });
    }
});
