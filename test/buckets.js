var assert = require('assert');
var aw_client = require('../aw-client');

aw_client.init('127.0.0.1', '5666');


testevent = {
    'label': 'this is a test label',
    'timestamp': '2016-08-09T14:35:10.363841+02:00'
};

describe('Buckets', function() {
    
    it('Post event, get event and assert', function() {
        return aw_client.post('/api/0/buckets/testbucket/events', testevent)
            .then(function(){
                return aw_client.get('/api/0/buckets/testbucket/events')
                    .then(function(data){
                        //console.log(data);
                        assert.equal(testevent['label'], data[0]['label']);
                        assert.equal(testevent['timestamp'], data[0]['timestamp']);
                    });
            });
    });

    it('Get buckets', function() {
        return aw_client.get('/api/0/buckets')
            .then(function(data){
                //console.log(data);
                assert.equal('testbucket', data[0]['id']);
            });
    });
});
