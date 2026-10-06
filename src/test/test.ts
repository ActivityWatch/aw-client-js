import * as assert from "assert";
import { FetchError } from "../aw-client";
import { AWClient, HeartbeatBuffer, IEvent } from "../aw-client";

function isFetchError(error: unknown): error is FetchError {
    return error instanceof FetchError;
}

// Bucket info
const bucketId = "aw-client-js-test";
const eventType = "test";
const hostname = "unknown";
const clientName = "aw-client-js-unittest";

const testevent: IEvent = {
    timestamp: new Date(),
    duration: 0,
    data: {
        label: "this is a test label",
    },
};

describe("Basic API usage", () => {
    // Create client
    const awc = new AWClient(clientName, {
        testing: true,
    });

    before("Delete test bucket", async () => {
        // Delete bucket if it exists
        try {
            return await awc.deleteBucket(bucketId);
        } catch (err) {
            if (isFetchError(err)) {
                if (err.response?.status === 404) {
                    return;
                }
            }
            throw err;
        }
    });

    // Make sure the test bucket exists before each test case
    beforeEach("Create test bucket", () => {
        return awc.ensureBucket(bucketId, eventType, hostname);
    });

    it("info", async () => {
        const resp = await awc.getInfo();
        assert.equal(resp.testing, true);
    });

    it("get data", async () => {
        const resp = await awc.getBucketInfo(bucketId);
        assert.deepEqual(resp.data, {});
    });

    // NOTE: This test will fail in CI until v0.12 is released (with support for 'get event by ID')
    it("Insert event, get event, replace event, and assert", async () => {
        // Insert
        await awc.insertEvent(bucketId, testevent);

        // Get all
        const events = await awc.getEvents(bucketId, { limit: 1 });
        assert.equal(events.length, 1);
        assert.equal(events[0].data.label, testevent.data.label);

        // Replace
        const newEvent = events[0];
        const newLabel = "this is a new label";
        newEvent.data.label = newLabel;
        await awc.replaceEvent(bucketId, newEvent);

        // Get specific
        const replacedEvent = await awc.getEvent(bucketId, newEvent.id!);

        // Check that the event is correct
        assert.equal(
            replacedEvent.timestamp.toISOString(),
            testevent.timestamp.toISOString(),
        );
        assert.equal(replacedEvent.data.label, newLabel);

        // Check that we only have one event
        const events_after = await awc.getEvents(bucketId, { limit: 1 });
        assert.equal(events_after.length, 1);
    });

    it("pre-merging preserves the server's heartbeat result", async () => {
        await awc.deleteBucket(bucketId);
        await awc.ensureBucket(bucketId, eventType, hostname);
        const events = [
            {
                timestamp: new Date("2026-10-02T09:00:00Z"),
                duration: 2,
                data: { label: "same" },
            },
            {
                timestamp: new Date("2026-10-02T09:00:02Z"),
                duration: 0,
                data: { label: "same" },
            },
            {
                timestamp: new Date("2026-10-02T09:00:07Z"),
                duration: 0,
                data: { label: "same" },
            },
            {
                timestamp: new Date("2026-10-02T09:00:13Z"),
                duration: 0,
                data: { label: "changed" },
            },
            {
                timestamp: new Date("2026-10-02T09:00:14Z"),
                duration: 1,
                data: { label: "changed" },
            },
        ];
        for (const event of events) await awc.heartbeat(bucketId, 5, event);
        const normalize = (items: IEvent[]) =>
            items.map(({ timestamp, duration, data }) => ({
                timestamp,
                duration,
                data,
            }));
        const direct = normalize(await awc.getEvents(bucketId));
        await awc.deleteBucket(bucketId);
        await awc.ensureBucket(bucketId, eventType, hostname);
        const buffer = new HeartbeatBuffer(awc, bucketId, 5);
        for (const event of events) buffer.heartbeat(event);
        await buffer.flush();
        assert.deepEqual(normalize(await awc.getEvents(bucketId)), direct);
    });

    it("Checks for presence/absence of event IDs for insert/replace", async () => {
        // Try replacing event without ID, should fail
        try {
            await awc.replaceEvent(bucketId, {
                timestamp: new Date(),
                duration: 0,
                data: {},
            });
            assert.fail("Should have thrown error");
        } catch (err) {
            if (isFetchError(err)) {
                throw err;
            }
        }

        // Try inseting event with ID, should fail
        try {
            await awc.insertEvent(bucketId, {
                id: 123,
                timestamp: new Date(),
                duration: 0,
                data: {},
            });
            assert.fail("Should have thrown error");
        } catch (err) {
            if (isFetchError(err)) {
                throw err;
            }
        }
    });

    it("Create, delete and get buckets", async () => {
        /* Create -> getBucketInfo and verify -> delete -> getBuckets and verify */
        await awc.ensureBucket(bucketId, eventType, hostname);
        let buckets = await awc.getBuckets();

        //console.log("getBuckets", buckets);
        assert.equal(true, bucketId in buckets);
        const bucketInfo = await awc.getBucketInfo(bucketId);

        //console.log("getBucketInfo", bucketInfo);
        assert.equal(bucketInfo.created instanceof Date, true);
        assert.equal(clientName, bucketInfo.client);

        await awc.deleteBucket(bucketId);
        buckets = await awc.getBuckets();
        //console.log("getBuckets", buckets);
        assert.equal(false, bucketId in buckets);
    });

    it("Heartbeat", async () => {
        // Send 10 heartbeat events with little time difference one after another (for testing the queue)
        await Promise.all(
            Array.from({ length: 10 }, () => {
                const curTimestamp = new Date();
                const newEvent: IEvent = {
                    timestamp: curTimestamp,
                    duration: testevent.duration,
                    data: testevent.data,
                };

                return awc.heartbeat(bucketId, 5, newEvent);
            }),
        );
        const events = await awc.getEvents(bucketId);
        assert.equal(events.length, 1);
    });

    it("Query", async () => {
        const d1 = new Date("2022-01-01");
        const d2 = new Date("2022-01-02");
        const d3 = new Date("2022-01-03");
        const e1 = { ...testevent, timestamp: d1 };
        const e2 = { ...testevent, timestamp: d2 };
        const e3 = { ...testevent, timestamp: d3 };
        await awc.heartbeat(bucketId, 5, e1);
        await awc.heartbeat(bucketId, 5, e2);
        await awc.heartbeat(bucketId, 5, e3);

        // Both these are valid timeperiod specs
        const timeperiods = [
            { start: e1.timestamp, end: e2.timestamp },
            `${e1.timestamp.toISOString()}/${e2.timestamp.toISOString()}`,
        ];
        const query = [`bucket="${bucketId}";`, "RETURN=query_bucket(bucket);"];
        const resp: IEvent[][] = await awc.query(timeperiods, query);
        const resp_e1: IEvent = resp[0][0];
        const resp_e2: IEvent = resp[0][1];
        assert.equal(
            e1.timestamp.toISOString(),
            new Date(resp_e2.timestamp).toISOString(),
        );
        assert.equal(e1.data.label, resp_e2.data.label);
        assert.equal(
            e2.timestamp.toISOString(),
            new Date(resp_e1.timestamp).toISOString(),
        );
        assert.equal(e2.data.label, resp_e1.data.label);

        // Run query again and check that the results are the same (correctly cached)
        const resp2: IEvent[][] = await awc.query(timeperiods, query);
        assert.deepEqual(resp, resp2);

        // Add a timeperiod and query again, to check that partial cache works
        const timeperiods2 = [
            { start: d1, end: d2 },
            { start: d2, end: d3 },
        ];
        const resp3: IEvent[][] = await awc.query(timeperiods2, query);
        assert.equal(2, resp3[0].length);
        assert.equal(2, resp3[1].length);

        // Query a timeperiod without events in the past,
        // then add an event for the timeperiod, and query again.
        // This is to check that we don't cache when the query returned nothing.
        const timeperiods3 = [
            { start: new Date("1980-1-1"), end: new Date("1980-1-2") },
        ];
        const resp4: IEvent[][] = await awc.query(timeperiods3, query);

        // Check that the result is empty
        assert.equal(0, resp4[0].length);

        // Add an event for the timeperiod
        await awc.heartbeat(bucketId, 5, {
            ...testevent,
            timestamp: new Date("1980-1-1"),
        });

        // Query again and check that the result is not empty
        const resp5: IEvent[][] = await awc.query(timeperiods3, query);
        assert.equal(1, resp5[0].length);
    });
});

describe("API config behavior", () => {
    it("can abort requests", () => {
        const awc = new AWClient(clientName, {
            testing: true,
        });
        const caught = new Promise((resolve, reject) => {
            awc.getInfo().catch(resolve).then(reject);
        });
        awc.abort();
        return caught;
    });

    it("cleans up propagated abort listeners after a successful request", async () => {
        const awc = new AWClient(clientName, {
            testing: true,
            timeout: 30_000,
        });

        const signal = awc.controller.signal;
        const originalAddEventListener = signal.addEventListener.bind(signal);
        const originalRemoveEventListener =
            signal.removeEventListener.bind(signal);
        const originalFetch = global.fetch;

        let activeAbortListeners = 0;
        let addCalls = 0;
        let removeCalls = 0;

        signal.addEventListener = ((
            type: string,
            listener: any,
            options?: any,
        ) => {
            if (type === "abort" && listener !== null) {
                activeAbortListeners += 1;
                addCalls += 1;
            }
            originalAddEventListener(type, listener, options);
        }) as typeof signal.addEventListener;

        signal.removeEventListener = ((
            type: string,
            listener: any,
            options?: any,
        ) => {
            if (type === "abort" && listener !== null) {
                activeAbortListeners -= 1;
                removeCalls += 1;
            }
            originalRemoveEventListener(type, listener, options);
        }) as typeof signal.removeEventListener;

        global.fetch = (() =>
            Promise.resolve(
                new Response(JSON.stringify({ testing: true }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            )) as typeof fetch;

        try {
            const resp = await awc.getInfo();
            assert.equal(resp.testing, true);
            assert.equal(addCalls, 1);
            assert.equal(removeCalls, 1);
            assert.equal(activeAbortListeners, 0);
        } finally {
            signal.addEventListener = originalAddEventListener;
            signal.removeEventListener = originalRemoveEventListener;
            global.fetch = originalFetch;
        }
    });
});

describe("String response handling (#45)", () => {
    const awc = new AWClient(clientName, { testing: true });
    const originalFetch = global.fetch;

    function mockJsonResponse(body: unknown) {
        global.fetch = (() =>
            Promise.resolve(
                new Response(JSON.stringify(body), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
            )) as typeof fetch;
    }

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("getEvents parses a double-encoded (string) JSON array", async () => {
        const events = [
            { id: 1, timestamp: new Date().toISOString(), data: {} },
        ];
        // Simulate a server that returns the array JSON-encoded a second time,
        // i.e. the body is the *string* '[{"id":1,...}]' rather than the array.
        mockJsonResponse(JSON.stringify(events));
        const resp = await awc.getEvents(bucketId, { limit: 1 });
        assert.equal(resp.length, 1);
        assert.equal(resp[0].id, 1);
    });

    it("getEvents throws a descriptive error on truly invalid JSON string", async () => {
        mockJsonResponse("not valid json at all {broken");
        await assert.rejects(
            () => awc.getEvents(bucketId, { limit: 1 }),
            (err: Error) => {
                assert.match(err.message, /Received invalid JSON from/);
                assert.match(err.message, /not valid json at all/);
                return true;
            },
        );
    });

    it("query parses a double-encoded (string) JSON array", async () => {
        const results = [[{ id: 1, data: {} }]];
        mockJsonResponse(JSON.stringify(results));
        const resp = await awc.query(
            [{ start: new Date(0), end: new Date(1) }],
            ["events = query_bucket('x');"],
        );
        assert.deepEqual(resp, results);
    });

    it("getInfo parses a double-encoded (string) JSON object", async () => {
        const info = { testing: true, version: "0.0.0" };
        mockJsonResponse(JSON.stringify(info));
        const resp = await awc.getInfo();
        assert.deepEqual(resp, info);
    });

    it("getBuckets parses a double-encoded (string) JSON object", async () => {
        const raw = {
            [bucketId]: {
                id: bucketId,
                created: new Date(0).toISOString(),
                type: eventType,
                hostname,
                data: {},
            },
        };
        mockJsonResponse(JSON.stringify(raw));
        const resp = await awc.getBuckets();
        assert.ok(resp[bucketId]);
        assert.ok(resp[bucketId].created instanceof Date);
    });

    it("getBucketInfo parses a double-encoded (string) JSON object", async () => {
        const raw = {
            id: bucketId,
            created: new Date(0).toISOString(),
            type: eventType,
            hostname,
            data: {},
        };
        mockJsonResponse(JSON.stringify(raw));
        const resp = await awc.getBucketInfo(bucketId);
        assert.equal(resp.id, bucketId);
        assert.ok(resp.created instanceof Date);
    });

    it("getEvent parses a double-encoded (string) JSON object", async () => {
        const raw = {
            id: 1,
            timestamp: new Date(0).toISOString(),
            data: {},
        };
        mockJsonResponse(JSON.stringify(raw));
        const resp = await awc.getEvent(bucketId, 1);
        assert.equal(resp.id, 1);
        assert.ok(resp.timestamp instanceof Date);
    });

    it("countEvents parses a double-encoded (string) number", async () => {
        mockJsonResponse(JSON.stringify(42));
        const resp = await awc.countEvents(bucketId);
        assert.strictEqual(resp, 42);
    });

    it("get_setting still returns a bare JSON string", async () => {
        // Regression guard: string-valued settings must NOT be re-parsed by the
        // structured normalizer (Greptile round 1, commit 49d353a).
        // The response body is the JSON text '"hello"', so res.json() yields
        // the bare string "hello".
        mockJsonResponse("hello");
        const resp = await awc.get_setting("some-key");
        assert.strictEqual(resp, "hello");
    });
});
