'use strict';

const axios = require('axios');


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
		// Make 304 not an error (necessary for create bucket requests)
        this.req.interceptors.response.use(
            response => {
                return response;
            }, err => {
                if (err.response.status == 304) {
                    return err.response;
                } else {
                    return Promise.reject(err);
                }
            }
        );
    }

    createBucket(bucket_id, client, type, hostname) {
        return this.req.post('/0/buckets/'+bucket_id, {
            client: client,
            type: type,
            hostname: hostname,
        });
    }

    deleteBucket(bucket_id) {
        return this.req.delete('/0/buckets/'+bucket_id)
    }

    getBuckets() {
        return this.req.get("/0/buckets/");
    }

    getBucketInfo(bucket_id) {
        return this.req.get("/0/buckets/" + bucket_id);
    }

    getEvents(bucket_id, params) {
        return this.req.get("/0/buckets/" + bucket_id + "/events", {params: params});
    }

    insertEvent(bucket_id, event) {
        return this.insertEvents(bucket_id, [event]);
    }

    insertEvents(bucket_id, events) {
        return this.req.post('/0/buckets/' + bucket_id + "/events", events);
    }

    heartbeat(bucket_id, pulsetime, data) {
        return this.req.post('/0/buckets/' + bucket_id + "/heartbeat?pulsetime=" + pulsetime, data);
    }
}

module.exports.AWClient = AWClient;
