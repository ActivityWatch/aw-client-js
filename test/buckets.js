var assert = require('assert');
const AWClient = require('../aw-client').AWClient;

var awc = new AWClient("aw-client-js-unittest", true);


testevent = {
    'timestamp': '2016-08-09T14:35:10.363000+00:00',
    'data': {
        'label': 'this is a test label'
    }
};

describe('Buckets', function() {

    it('Post event, get event and assert', (done) => {
        awc.createBucket("aw-client-js-test", "test", "unknown").then((resp) => {
            awc.insertEvent("aw-client-js-test", testevent).then((resp) => {
                awc.getEvents("aw-client-js-test", {limit: 1}).then((resp) => {
                    console.log(resp.data);
                    assert.equal(testevent['timestamp'], resp.data[0]['timestamp']);
                    assert.equal(testevent['data']['label'], resp.data[0]['data']['label']);
                    done();
                })
            })
        })
    });

    it('Create, delete and get buckets', (done) => {
        /* Create -> getBucketInfo and verify -> delete -> getBuckets and verify */
        awc.createBucket("aw-client-js-test", "test", "unknown").then((resp) => {
            awc.getBucketInfo("aw-client-js-test").then((resp) => {
                assert.equal('aw-client-js-unittest', resp.data['client']);
                awc.deleteBucket("aw-client-js-test").then((resp) => {
                    awc.getBuckets().then((resp) => {
                        assert.equal(false, "aw-client-js-test" in resp.data)
                        done();
                    })
                })
            })
        })
    });

    it('Heartbeat', (done) => {
        awc.createBucket("aw-client-js-test", "test", "unknown").then((resp) => {
            awc.heartbeat("aw-client-js-test", 5, testevent).then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['timestamp'], resp.data['timestamp']);
                assert.equal(testevent['data']['label'], resp.data['data']['label']);
                done();
            })
        })
    });

    it('Query', (done) => {
        awc.createBucket("aw-client-js-test", "test", "unknown").then((resp) => {
            awc.heartbeat("aw-client-js-test", 5, testevent).then((resp) => {
                let timeperiods = [testevent.timestamp+"/"+testevent.timestamp];
                let query = [
                    "bucket='aw-client-js-test';",
                    "RETURN=query_bucket(bucket);"
                ];
                awc.query(timeperiods, query).then((resp) => {
                    console.log(resp.data);
                    assert.equal(testevent['timestamp'], resp.data[0][0]['timestamp']);
                    assert.equal(testevent['data']['label'], resp.data[0][0]['data']['label']);
                    done();
                })
            })
        })
    });
});
