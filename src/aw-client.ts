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

interface HeartbeatQueueItem {
    onSuccess: Function;
    onError: Function;
    pulsetime: number;
    heartbeat: Heartbeat;
}

class AWClient {
    public clientname: string;
    public testing: boolean;
    public req: AxiosInstance;

    private heartbeatQueues: {
        [bucket_id: string]: {
            isProcessing: boolean;
            data: Array<HeartbeatQueueItem>
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

    heartbeat(bucket_id: string, pulsetime: number, heartbeat: Heartbeat): AxiosPromise {
        // Create heartbeat queue for bucket if not already existing
        if (!this.heartbeatQueues.hasOwnProperty(bucket_id)) {
            this.heartbeatQueues[bucket_id] = {
                isProcessing: false,
                data: []
            };
        }

        return new Promise((resolve, reject) => {
            // Add heartbeat request to queue
            this.heartbeatQueues[bucket_id].data.push({
                onSuccess: resolve,
                onError: reject,
                pulsetime,
                heartbeat
            });

            this.updateHeartbeatQueue(bucket_id);
        });
    }

    // Start heartbeat queue processing if not currently processing
    private updateHeartbeatQueue(bucket_id: string) {
        const queue = this.heartbeatQueues[bucket_id];
        
        if (!queue.isProcessing && queue.data.length) {
            const { pulsetime, heartbeat, onSuccess, onError } = queue.data.shift() as HeartbeatQueueItem;

            queue.isProcessing = true;
            this.send_heartbeat(bucket_id, pulsetime, heartbeat)
                .then((response) => {
                    onSuccess(response);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucket_id);
                })
                .catch((response) => {
                    onError(response);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucket_id);
                });
        }
    }

    query(timeperiods: Array<string>, query: Array<string>) {
        const data = { timeperiods: timeperiods, query: query };
        return this.req.post('/0/query/', data);
    }
}

export { AWClient };