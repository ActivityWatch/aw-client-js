import axios, { AxiosInstance, AxiosPromise } from 'axios';

const isNode = (typeof module !== 'undefined' && module.exports);

export interface Heartbeat {
    id?: number;
    timestamp: string;    // timestamp as iso8601 string
    duration?: number;    // duration in seconds
    data: { [k: string]: any };
}

export interface Event extends Heartbeat {
    duration: number;
}

class AWClient {
    public clientname: string;
    public testing: boolean;
    public req: AxiosInstance;

    private heartbeatQueues: {
        [bucket_id: string]: {
            isProcessing: boolean;
            data: Array<{
                onSuccess: Function,
                onError: Function,
                pulsetime: number;
                heartbeat: Heartbeat;
            }>
        }
    } = {};

    constructor(clientname: string, testing: boolean, baseurl: string | undefined = undefined) {
        this.clientname = clientname;
        this.testing = testing;
        if (baseurl == undefined) {
            const port = !testing ? 5600 : 5666;
            baseurl = 'http://127.0.0.1:' + port;
        }

        this.req = axios.create({
            baseURL: baseurl + '/api',
            timeout: 10000,
            headers: (!isNode) ? {} : { 'User-Agent': 'aw-client-js/0.1' }
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

    createBucket(bucket_id: string, type: string, hostname: string) {
        return this.req.post('/0/buckets/' + bucket_id, {
            client: this.clientname,
            type: type,
            hostname: hostname,
        });
    }

    deleteBucket(bucket_id: string) {
        return this.req.delete('/0/buckets/' + bucket_id + "?force=1");
    }

    getBuckets() {
        return this.req.get("/0/buckets/");
    }

    getBucketInfo(bucket_id: string) {
        return this.req.get("/0/buckets/" + bucket_id);
    }

    getEvents(bucket_id: string, params: { [k: string]: any }) {
        return this.req.get("/0/buckets/" + bucket_id + "/events", { params: params });
    }

    getEventCount(bucket_id: string, starttime: string, endtime: string) {
        const params = {
            starttime: starttime,
            endtime: endtime,
        };
        return this.req.get("/0/buckets/" + bucket_id + "/events/count", { params: params });
    }

    insertEvent(bucket_id: string, event: Event) {
        return this.insertEvents(bucket_id, [event]);
    }

    insertEvents(bucket_id: string, events: Array<Event>) {
        return this.req.post('/0/buckets/' + bucket_id + "/events", events);
    }

    private send_heartbeat(bucket_id: string, pulsetime: number, data: Heartbeat) {
        return this.req.post('/0/buckets/' + bucket_id + "/heartbeat?pulsetime=" + pulsetime, data);
    }

    // TODO: Make type AxiosPromise friendly
    heartbeat(bucket_id: string, pulsetime: number, heartbeat: Heartbeat): AxiosPromise {
        if (!this.heartbeatQueues.hasOwnProperty(bucket_id)) {
            this.heartbeatQueues[bucket_id] = {
                isProcessing: false,
                data: []
            };
        }


        return new Promise((resolve, reject) => {
            
            this.heartbeatQueues[bucket_id].data.push({
                pulsetime,
                onSuccess: resolve,
                onError: reject,
                heartbeat
            });

            this.updateHeartbeatQueue(bucket_id);
        });
    }

    private updateHeartbeatQueue(bucket_id: string) {
        const queue = this.heartbeatQueues[bucket_id];
        
        if (!queue.isProcessing && queue.data.length) {
            const oldestHeartbeatData = queue.data.shift();
            if (!oldestHeartbeatData) {
                return;
            }

            const { pulsetime, heartbeat, onSuccess, onError } = oldestHeartbeatData;

            queue.isProcessing = true;
            this.send_heartbeat(bucket_id, pulsetime, heartbeat)
                .then((...args: any[]) => {
                    onSuccess(...args);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucket_id);
                })
                .catch((...args: any[]) => {
                    onError(...args);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucket_id);
                })
        }
    }

    query(timeperiods: Array<string>, query: Array<string>) {
        const data = { timeperiods: timeperiods, query: query };
        return this.req.post('/0/query/', data);
    }
}

export { AWClient };