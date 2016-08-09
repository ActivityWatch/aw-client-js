var assert = require('assert');
var aw_client = require('../aw-client');
aw_client.init('127.0.0.1', '5666');

describe('Get', function() {
    it('Get buckets', function() {
        return aw_client.get('/api/0/buckets')
    });
});

testevent = {
    'label': 'this is a test label',
    'timestamp': '2016-08-09T14:35:10.363841+02:00'
};

describe('Post', function() {
    it('Create event and assert', function() {
        return aw_client.post('/api/0/buckets/testbucket/events', testevent)
            .then(function(){
                return aw_client.get('/api/0/buckets/testbucket/events')
                    .then(function(data){
                        console.log(data);
                        assert.equal(data[0]['label'], testevent['label'])
                        assert.equal(data[0]['timestamp'], testevent['timestamp'])
                    });
            });
    });
});
