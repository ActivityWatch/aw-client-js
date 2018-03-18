var assert = require('assert');
const AWClient = require('../aw-client').AWClient;

var awc = new AWClient();


testevent = {
    'timestamp': '2016-08-09T14:35:10.363841+02:00',
    'data': {
        'label': 'this is a test label'
    }
};

describe('Buckets', function() {

    it('Post event, get event and assert', function() {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
            awc.getBucketInfo("aw-watcher-web-test").then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['label'], resp.data[0]['label']);
                assert.equal(testevent['timestamp'], resp.data[0]['timestamp']);
            })
        })
    });

    it('Get buckets', function() {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
            awc.getEvents("aw-watcher-web-test", {limit: 1}).then((resp) => {
                console.log(resp.data);
                assert.equal('testbucket', resp.data[0]['id']);
            })
        })
    });
    it('Heartbeat', function() {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
            awc.heartbeat("aw-watcher-web-test", 5, testevent).then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['label'], resp.data[0]['label']);
                assert.equal(testevent['timestamp'], resp.data[0]['timestamp']);
            })
        })
    });
});
