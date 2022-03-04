import * as assert from "assert";
import { AWClient, IEvent } from "../aw-client";

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

    before("Delete test bucket", () => {
        // Delete bucket if it exists
        return awc.deleteBucket(bucketId)
            .catch((err) => {
              if (err && err.response && err.response.status === 404) {
                return "ok";
              }
              throw err;
            });
    });

    // Make sure the test bucket exists before each test case
    beforeEach("Create test bucket", () => {
        return awc.ensureBucket(bucketId, eventType, hostname);
    });

    it("info", () => {
        return awc.getInfo().then((resp) => {
            console.log("info", resp);
            assert.equal(resp.testing, true);
        });
    });

    // NOTE: This test will fail in CI until v0.12 is released (with support for 'get event by ID')
    it("Post event, get event and assert", async () => {
        const eventInserted = await awc.insertEvent(bucketId, testevent);
        console.log("insertEvent", eventInserted);

        const events = await awc.getEvents(bucketId, { limit: 1 });
        console.log("result from getEvents", events);

        assert.equal(events.length, 1);
        let event: IEvent = events[0];
        console.log("getEvent", event);

        event = await awc.getEvent(bucketId, event.id!);
        console.log("result from getEvent", event);

        assert.equal(testevent.timestamp.toISOString(), event.timestamp.toISOString());
        assert.equal(testevent.data.label, event.data.label);
    });

    it("Create, delete and get buckets", async () => {
        /* Create -> getBucketInfo and verify -> delete -> getBuckets and verify */
        await awc.ensureBucket(bucketId, eventType, hostname);
        let buckets = await awc.getBuckets();

        console.log("getBuckets", buckets);
        assert.equal(true, bucketId in buckets);
        const bucketInfo = await awc.getBucketInfo(bucketId);

        console.log("getBucketInfo", bucketInfo);
        assert.equal(bucketInfo.created instanceof Date, true);
        assert.equal(clientName, bucketInfo.client);

        await awc.deleteBucket(bucketId);
        buckets = await awc.getBuckets();
        console.log("getBuckets", buckets);
        assert.equal(false, bucketId in buckets);
    });

    it("Heartbeat", () => {
        // Send 10 heartbeat events with little time difference one after another (for testing the queue)
        return Promise.all(Array.from({ length: 10 }, (v, index) => {
            const { timestamp, ...event } = testevent;
            const curTimestamp = new Date();
            const newEvent = {
                timestamp: curTimestamp,
                ...event,
            };

            return awc.heartbeat(bucketId, 5, newEvent);
        }))
        .then(([ firstResponse ]) => {
            console.log("heartbeat", firstResponse);
        });
    });

    it("Query", async () => {
        const e1 = {...testevent, timestamp: new Date("2022-01-01")};
        const e2 = {...testevent, timestamp: new Date("2022-01-02")};
        await awc.heartbeat(bucketId, 5, e1);
        await awc.heartbeat(bucketId, 5, e2);

        // Both these are valid timeperiod specs
        const timeperiods = [
            {start: e1.timestamp, end: e2.timestamp},
            `${e1.timestamp.toISOString()}/${e2.timestamp.toISOString()}`,
        ];
        const query = [
            `bucket="${bucketId}";`,
            "RETURN=query_bucket(bucket);",
        ];
        console.log(timeperiods);
        const resp = await awc.query(timeperiods, query);
        console.log("query", resp);
        assert.equal(e1.timestamp.toISOString(), new Date(resp[0][1].timestamp).toISOString());
        assert.equal(e1.data.label, resp[0][1].data.label);
        assert.equal(e2.timestamp.toISOString(), new Date(resp[0][0].timestamp).toISOString());
        assert.equal(e2.data.label, resp[0][0].data.label);
    });
});

describe("API config behavior", () => {
    it("can abort requests", () => {
        const awc = new AWClient(clientName, {
          testing: true,
        });
        let caught = new Promise((resolve, reject) => {
            awc.getInfo().catch(resolve).then(reject);
        });
        awc.abort();
        return caught;
    });
});
