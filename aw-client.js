'use strict';

const axios = require('axios');


class AWClient {
    constructor(clientname, testing) {
        let port = !testing ? 5600 : 5666;
        this.clientname = clientname;

        this.req = axios.create({
          baseURL: 'http://127.0.0.1:'+port+'/api',
          timeout: 1000,
          headers: {'User-Agent': 'aw-client-js/0.1'}
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

    createBucket(bucket_id, type, hostname) {
        return this.req.post('/0/buckets/'+bucket_id, {
            client: this.clientname,
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

    query(timeperiods, query) {
        var data = {timeperiods: timeperiods, query: query}
        return this.req.post('/0/query/', data);
    }
}

module.exports.AWClient = AWClient;
