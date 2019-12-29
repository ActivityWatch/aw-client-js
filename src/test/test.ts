import * as assert from "assert";
import { AWClient, IEvent } from "../aw-client";

// Bucket info
const bucketId = "aw-client-js-test";
const eventType = "test";
const hostname = "unknown";

// Create client
const clientName = "aw-client-js-unittest";
const awc = new AWClient(clientName, {
  testing: true,
});

const testevent: IEvent = {
    timestamp: new Date(),
    duration: 0,
    data: {
        label: "this is a test label",
    },
};

describe("All", () => {
    before("Delete test bucket", () => {
        // Delete bucket if it exists
        return awc.deleteBucket(bucketId)
            .catch((err) => {
              if (err && err.response.status === 404) {
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

    it("Post event, get event and assert", () => {
        return awc.insertEvent(bucketId, testevent).then((resp) => {
            console.log("insertEvent", resp);
            return awc.getEvents(bucketId, { limit: 1 });
        })
        .then((resp) => {
            console.log("getEvents", resp);
            assert.equal(testevent.timestamp.toISOString(), resp[0].timestamp.toISOString());
            assert.equal(testevent.data.label, resp[0].data.label);
        });
    });

    it("Create, delete and get buckets", () => {
        /* Create -> getBucketInfo and verify -> delete -> getBuckets and verify */
        return awc.ensureBucket(bucketId, eventType, hostname)
        .then(() => awc.getBuckets())
        .then((resp) => {
            console.log("getBuckets", resp);
            assert.equal(true, bucketId in resp);
        })
        .then(() => {
            return awc.getBucketInfo(bucketId);
        })
        .then((resp) => {
            console.log("getBucketInfo", resp);
            assert.equal(resp.created instanceof Date, true);
            assert.equal(clientName, resp.client);
            return awc.deleteBucket(bucketId);
        })
        .then(() => {
          return awc.getBuckets();
        })
        .then((resp) => {
            console.log("getBuckets", resp);
            assert.equal(false, bucketId in resp);
        });
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
        await awc.heartbeat(bucketId, 5, testevent);
        // Both these are valid timeperiod specs
        const timeperiods = [
            {start: testevent.timestamp, end: testevent.timestamp},
            `${testevent.timestamp.toISOString()}/${testevent.timestamp.toISOString()}`,
        ];
        const query = [
            `bucket="${bucketId}";`,
            "RETURN=query_bucket(bucket);",
        ];
        const resp = await awc.query(timeperiods, query);
        console.log("query", resp);
        assert.equal(testevent.timestamp.toISOString(), new Date(resp[0][0].timestamp).toISOString());
        assert.equal(testevent.data.label, resp[0][0].data.label);
    });
});
