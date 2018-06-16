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

    // Make sure the test bucket exists before each test case
    beforeEach(function createTestBucket(done) {
        awc.createBucket(bucketId, eventType, hostname)
            .then(() => done());
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
        awc.heartbeat(bucketId, 5, testevent).then((resp) => {
            console.log(resp.data);
            assert.equal(testevent['timestamp'], resp.data['timestamp']);
            assert.equal(testevent['data']['label'], resp.data['data']['label']);
            done();
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
