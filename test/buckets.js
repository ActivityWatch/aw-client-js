var assert = require('assert');
const AWClient = require('../aw-client').AWClient;

var awc = new AWClient();


testevent = {
    'timestamp': '2016-08-09T14:35:10.363000+00:00',
    'data': {
        'label': 'this is a test label'
    }
};

describe('Buckets', function() {

    it('Post event, get event and assert', (done) => {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
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

    it('Get buckets', (done) => {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
            awc.getBuckets().then((resp) => {
                console.log(resp.data);
                assert.equal('aw-client-js-unittest', resp.data['aw-client-js-test']['client']);
				done();
            })
        })
    });

    it('Heartbeat', (done) => {
        awc.createBucket("aw-client-js-test", "aw-client-js-unittest", "test", "unknown").then((resp) => {
            awc.heartbeat("aw-client-js-test", 5, testevent).then((resp) => {
                console.log(resp.data);
                assert.equal(testevent['timestamp'], resp.data['timestamp']);
                assert.equal(testevent['data']['label'], resp.data['data']['label']);
				done();
            })
        })
    });
});
