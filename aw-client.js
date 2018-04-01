'use strict';

const axios = require('axios');


class AWClient {
    constructor(clientname, testing, baseurl) {
        this.clientname = clientname;
        this.testing = testing;
        if (baseurl == undefined){
            let port = !testing ? 5600 : 5666;
            baseurl = 'http://127.0.0.1:'+port;
        }

        this.req = axios.create({
          baseURL: baseurl+'/api',
          timeout: 5000,
          headers: {'User-Agent': 'aw-client-js/0.1'}
        });

        // Make 304 not an error (necessary for create bucket requests)
        this.req.interceptors.response.use(
            response => {
                return response;
            }, err => {
                if (err && err.response && err.response.status == 304) {
                    return err.data;
                } else {
                    return Promise.reject(err);
                }
            }
        );
    }

    info() {
        return this.req.get('/0/info');
    }

    createBucket(bucket_id, type, hostname) {
        return this.req.post('/0/buckets/'+bucket_id, {
            client: this.clientname,
            type: type,
            hostname: hostname,
        });
    }

    deleteBucket(bucket_id) {
        return this.req.delete('/0/buckets/'+bucket_id+"?force=1");
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

    getEventCount(bucket_id, starttime, endtime) {
        let params = {
            starttime: starttime,
            endtime: endtime,
        }
        return this.req.get("/0/buckets/" + bucket_id + "/events/count", {params: params});
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
        let data = {timeperiods: timeperiods, query: query}
        return this.req.post('/0/query/', data);
    }
}

module.exports.AWClient = AWClient;
