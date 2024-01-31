import * as assert from "assert";
import { FetchError } from "../aw-client";
import { AWClient, IEvent } from "../aw-client";

function isFetchError(error: unknown): error is FetchError {
    return error instanceof FetchError
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
});
