import * as assert from "assert";
import { AWClient, IEvent } from "../aw-client";

// The encoded-looking percent case is literal data, not pre-encoded input.
const bucketIds = [
    ["aw-client-test-ordinary", "aw-client-test-ordinary"],
    ["aw-client-test-#fragment", "aw-client-test-%23fragment"],
    ["aw-client-test-?query", "aw-client-test-%3Fquery"],
    ["aw-client-test-%23literal", "aw-client-test-%2523literal"],
    ["aw-client-test-räka", "aw-client-test-r%C3%A4ka"],
];
const event: IEvent = {
    timestamp: new Date("2026-01-01T12:00:00Z"),
    duration: 1,
    data: { label: "synthetic" },
};
const start = new Date("2026-01-01T00:00:00Z");
const end = new Date("2026-01-02T00:00:00Z");
const range = new URLSearchParams({
    start: start.toISOString(),
    end: end.toISOString(),
}).toString();

describe("Bucket path segments", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    for (const [bucketId, encoded] of bucketIds) {
        it(`encodes only the bucket segment across all methods: ${bucketId}`, async () => {
            const requests: { url: string; init?: RequestInit }[] = [];
            globalThis.fetch = async (input, init) => {
                requests.push({ url: String(input), init });
                const url = new URL(String(input));
                const body =
                    init?.method === "POST" &&
                    url.pathname.endsWith("/heartbeat")
                        ? event
                        : url.pathname.endsWith("/events")
                          ? []
                          : url.pathname.endsWith("/count")
                            ? 0
                            : url.pathname.endsWith("/7")
                              ? event
                              : { id: bucketId, created: start, data: {} };
                return new Response(JSON.stringify(body));
            };
            const client = new AWClient("bucket-path-test", {
                baseURL: "http://127.0.0.1:1",
            });
            await client.ensureBucket(bucketId, "test", "unknown");
            await client.createBucket(bucketId, "test", "unknown");
            await client.getBucketInfo(bucketId);
            await client.getEvent(bucketId, 7);
            await client.getEvents(bucketId, { start, end, limit: 2 });
            await client.countEvents(bucketId, start, end);
            await client.insertEvent(bucketId, event);
            await client.insertEvents(bucketId, [event]);
            await client.replaceEvent(bucketId, { ...event, id: 7 });
            await client.replaceEvents(bucketId, [{ ...event, id: 7 }]);
            await client.deleteEvent(bucketId, 7);
            await client.heartbeat(bucketId, 5, event);
            await client.deleteBucket(bucketId);

            const base = `http://127.0.0.1:1/api/0/buckets/${encoded}`;
            assert.deepStrictEqual(
                requests.map(({ url, init }) => [init?.method ?? "GET", url]),
                [
                    ["POST", base],
                    ["POST", base],
                    ["GET", base],
                    ["GET", `${base}/events/7`],
                    ["GET", `${base}/events?${range}&limit=2`],
                    ["GET", `${base}/events/count?${range}`],
                    ["POST", `${base}/events`],
                    ["POST", `${base}/events`],
                    ["POST", `${base}/events`],
                    ["POST", `${base}/events`],
                    ["DELETE", `${base}/events/7`],
                    ["POST", `${base}/heartbeat?pulsetime=5`],
                    ["DELETE", `${base}?force=1`],
                ],
            );
            assert.deepStrictEqual(JSON.parse(String(requests[6].init?.body)), [
                { ...event, timestamp: event.timestamp.toISOString() },
            ]);
        });
    }
});

describe("Supported-server bucket paths", () => {
    const client = new AWClient("bucket-path-test", { testing: true });

    for (const [bucketId, encoded] of bucketIds) {
        it(`preserves the literal ID through CRUD and heartbeat: ${bucketId}`, async () => {
            // Establish server support independently before using AWClient.
            const path = `${client.apiURL}/0/buckets/${encoded}`;
            const created = await fetch(path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    client: "bucket-path-test",
                    type: "test",
                    hostname: "unknown",
                }),
            });
            assert.equal(created.status, 200);
            try {
                assert.equal(
                    (await client.getBucketInfo(bucketId)).id,
                    bucketId,
                );
                assert.equal(
                    (await client.ensureBucket(bucketId, "test", "unknown"))
                        .alreadyExist,
                    true,
                );
                await client.insertEvent(bucketId, event);
                const events = await client.getEvents(bucketId, {
                    start,
                    end,
                    limit: 2,
                });
                assert.equal(events.length, 1);
                assert.deepStrictEqual(events[0].data, event.data);
                assert.equal(await client.countEvents(bucketId, start, end), 1);
                const id = events[0].id!;
                await client.replaceEvent(bucketId, {
                    ...events[0],
                    data: { label: "replaced" },
                });
                assert.equal(
                    (await client.getEvent(bucketId, id)).data.label,
                    "replaced",
                );
                await client.deleteEvent(bucketId, id);
                assert.equal(await client.countEvents(bucketId), 0);
                await client.heartbeat(bucketId, 5, event);
                assert.equal(await client.countEvents(bucketId), 1);
                await client.deleteBucket(bucketId);
                assert.equal((await fetch(path)).status, 404);
                await client.createBucket(bucketId, "test", "unknown");
                assert.equal(
                    (await client.getBucketInfo(bucketId)).id,
                    bucketId,
                );
            } finally {
                // Cleanup also works on the unfixed client.
                const deleted = await fetch(`${path}?force=1`, {
                    method: "DELETE",
                });
                assert.equal(deleted.status, 200);
            }
        });
    }
});
