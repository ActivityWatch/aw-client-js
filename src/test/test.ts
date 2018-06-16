import * as assert from 'assert';
import { AWClient, Event } from '../aw-client';

// Bucket info
const bucketId = 'aw-client-js-test';
const eventType = 'test';
const hostname = 'unknown';

// Create client
const clientName = 'aw-client-js-unittest';
const awc = new AWClient(clientName, true);

const testevent: Event = {
    timestamp: '2016-08-09T14:35:10.363000+00:00',
    duration: 0,
    data: {
        'label': 'this is a test label'
    }
};

describe('All', function () {
    it('info', (done) => {
        awc.info().then((resp) => {
            console.log(resp.data);
            assert.equal(resp.data.testing, true);
            done();
        });
    });

    before('Delete test bucket', () => {
        return awc.deleteBucket(bucketId);
    })

    // Make sure the test bucket exists before each test case
    beforeEach('Create test bucket', () => {
        return awc.createBucket(bucketId, eventType, hostname);
    });

    it('Post event, get event and assert', (done) => {
        awc.insertEvent(bucketId, testevent).then((resp) => {
            awc.getEvents(bucketId, { limit: 1 }).then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['timestamp'], resp.data[0]['timestamp']);
                assert.equal(testevent['data']['label'], resp.data[0]['data']['label']);
                done();
            });
        });
    });

    it('Create, delete and get buckets', (done) => {
        /* Create -> getBucketInfo and verify -> delete -> getBuckets and verify */
        awc.createBucket(bucketId, eventType, hostname).then((resp) => {
            awc.getBucketInfo(bucketId).then((resp) => {
                assert.equal(clientName, resp.data['client']);
                awc.deleteBucket(bucketId).then((resp) => {
                    awc.getBuckets().then((resp) => {
                        assert.equal(false, bucketId in resp.data)
                        done();
                    });
                });
            });
        });
    });

    it('Heartbeat', (done) => {
        // Send 10 heartbeat events with little time difference one after another (for testing the queue)
        Promise.all(Array.from({ length: 10 }, (v, index) => {
            const { timestamp, ...event } = testevent;
            const curTimestamp = (new Date()).toISOString();
            const newEvent = {
                timestamp: curTimestamp,
                ...event
            };

            return awc.heartbeat(bucketId, 5, newEvent)
        }))
            .then(resp => {
                const firstResponse = resp[0];
                console.log(firstResponse.data);
                // assert.equal(testevent['timestamp'], firstResponse.data['timestamp']);
                assert.equal(testevent['data']['label'], firstResponse.data['data']['label']);
                done();
            })
            .catch(err => {
                console.error(err);
                done(false);
            });
    });

    it('Query', (done) => {
        awc.heartbeat(bucketId, 5, testevent).then((resp) => {
            let timeperiods = [testevent.timestamp + "/" + testevent.timestamp];
            let query = [
                `bucket="${bucketId}";`,
                "RETURN=query_bucket(bucket);"
            ];
            awc.query(timeperiods, query).then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['timestamp'], resp.data[0][0]['timestamp']);
                assert.equal(testevent['data']['label'], resp.data[0][0]['data']['label']);
                done();
            });
        });
    });
});
