let axios = require('axios');
let rp = require('request-promise');

let baseaddr = null;


class AWClient {
    constructor(options) {
        if(options !== undefined) {
            console.error("AWClient options currently not implemented")
        }
        this.req = axios.create({
          baseURL: 'http://127.0.0.1:5666/api',
          timeout: 1000,
          headers: {'X-Custom-Header': 'foobar'}
        });
    }

    getBucketInfo(bucket_id) {
        return this.req.get("/0/buckets/" + bucket_id);
    }

    getEvents(bucket_id, params) {
        return this.req.get("/0/buckets/" + bucket_id + "/events", {params: params});
    }
}

module.exports.AWClient = AWClient;
