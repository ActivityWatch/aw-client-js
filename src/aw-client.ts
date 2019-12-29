import axios, { AxiosError, AxiosInstance } from "axios";

// Default interface for events
export interface IEvent {
    id?: number;
    timestamp: Date;
    duration?: number;    // duration in seconds
    data: { [k: string]: any };
}

// Interfaces for coding activity
export interface IAppEditorEvent extends IEvent {
    data: {
        project: string;    // Path to the current project / workDir
        file: string;       // Path to the current file
        language: string;   // Coding Language identifier (e.g. javascript, python, ...)
        [k: string]: any;   // Additional (custom) data
    };
}

export interface IBucket {
  id: string;
  name: string;
  type: string;
  client: string;
  hostname: string;
  created: Date;
  last_update?: Date;
}

interface IHeartbeatQueueItem {
    onSuccess: () => void;
    onError: (err: AxiosError) => void;
    pulsetime: number;
    heartbeat: IEvent;
}

interface IInfo {
  hostname: string;
  version: string;
  testing: boolean;
}

export class AWClient {
    public clientname: string;
    public baseURL: string;
    public testing: boolean;
    public req: AxiosInstance;

    private heartbeatQueues: {
        [bucketId: string]: {
            isProcessing: boolean;
            data: IHeartbeatQueueItem[];
        },
    } = {};

    constructor(clientname: string, options: {testing?: boolean, baseURL?: string} = {}) {
        this.clientname = clientname;
        this.testing = options.testing || false;
        if (typeof options.baseURL === "undefined") {
            const port = !options.testing ? 5600 : 5666;
            this.baseURL = `http://127.0.0.1:${port}`;
        } else {
          this.baseURL = options.baseURL;
        }

        this.req = axios.create({
            baseURL: this.baseURL + "/api",
            timeout: 30000,
        });
    }

    public async getInfo(): Promise<IInfo> {
        return this.req.get("/0/info").then(res => res.data);
    }

    public async ensureBucket(bucketId: string, type: string, hostname: string): Promise<{ alreadyExist: boolean }> {
        try {
            await this.req.post(`/0/buckets/${bucketId}`, {
                client: this.clientname,
                type,
                hostname,
            })
        } catch(err) {
            // Will return 304 if bucket already exists
            if (err && err.response && err.response.status === 304) {
                return {alreadyExist: true};
            }
            throw err;
        }
        return {alreadyExist: false}
    }

    public async createBucket(bucketId: string, type: string, hostname: string): Promise<undefined> {
        await this.req.post(`/0/buckets/${bucketId}`, {
            client: this.clientname,
            type,
            hostname,
        })
        return undefined;
    }

    public async deleteBucket(bucketId: string): Promise<undefined> {
        await this.req.delete(`/0/buckets/${bucketId}?force=1`);
        return undefined;
    }

    public async getBuckets(): Promise<{[bucketId: string]: IBucket}> {
        let buckets = (await this.req.get("/0/buckets/")).data;
        Object.keys(buckets).forEach(bucket => {
            buckets[bucket].created = new Date(buckets[bucket].created);
            if (buckets[bucket].last_updated) {
                buckets[bucket].last_updated = new Date(buckets[bucket].last_updated);
            }
        });
        return buckets;
    }

    public async getBucketInfo(bucketId: string): Promise<IBucket> {
        let bucket = (await this.req.get(`/0/buckets/${bucketId}`)).data;
        bucket.created = new Date(bucket.created);
        return bucket;
    }

    public async getEvents(bucketId: string, params: { [k: string]: any }): Promise<IEvent[]> {
        let events = (await this.req.get("/0/buckets/" + bucketId + "/events", { params })).data;
        events.forEach((event: IEvent) => {
            event.timestamp = new Date(event.timestamp);
        });
        return events;
    }

    public async countEvents(bucketId: string, startTime?: Date, endTime?: Date) {
        const params = {
            starttime: startTime ? startTime.toISOString() : null,
            endtime: endTime ? endTime.toISOString() : null,
        };
        return this.req.get("/0/buckets/" + bucketId + "/events/count", { params });
    }

    public async insertEvent(bucketId: string, event: IEvent): Promise<IEvent> {
        return this.insertEvents(bucketId, [event]).then(events => events[0]);
    }

    public async insertEvents(bucketId: string, events: IEvent[]): Promise<IEvent[]> {
        let insertedEvents = (await this.req.post("/0/buckets/" + bucketId + "/events", events)).data;
        if (!Array.isArray(insertedEvents)) {
            insertedEvents = [insertedEvents];
        }
        insertedEvents.forEach((event: IEvent) => {
            event.timestamp = new Date(event.timestamp);
        });
        return insertedEvents;
    }

    // Just an alias for insertEvent requiring the event to have an ID assigned
    public async replaceEvent(bucketId: string, event: IEvent): Promise<IEvent> {
        if(event.id === undefined) {
            throw("Can't replace event without ID assigned")
        }
        return this.insertEvent(bucketId, event);
    }

    public async deleteEvent(bucketId: string, eventId: number): Promise<undefined> {
        await this.req.delete('/0/buckets/' + bucketId + '/events/' + eventId);
        return undefined;
    }

    /**
     *
     * @param bucketId The id of the bucket to send the heartbeat to
     * @param pulsetime The maximum amount of time in seconds since the last heartbeat to be merged
     *                  with the previous heartbeat in aw-server
     * @param heartbeat The actual heartbeat event
     */
    public heartbeat(bucketId: string, pulsetime: number, heartbeat: IEvent): Promise<undefined> {
        // Create heartbeat queue for bucket if not already existing
        if (!this.heartbeatQueues.hasOwnProperty(bucketId)) {
            this.heartbeatQueues[bucketId] = {
                isProcessing: false,
                data: [],
            };
        }

        return new Promise((resolve, reject) => {
            // Add heartbeat request to queue
            this.heartbeatQueues[bucketId].data.push({
                onSuccess: resolve,
                onError: reject,
                pulsetime,
                heartbeat,
            });

            this.updateHeartbeatQueue(bucketId);
        });
    }

    public async query(timeperiods: Array<string|{start: Date, end: Date}>, query: string[]): Promise<any> {
        const data = {
            query,
            timeperiods: timeperiods.map(tp => {
                return typeof tp !== "string" ? `${tp.start.toISOString()}/${tp.end.toISOString()}` : tp;
            }),
        };
        return (await this.req.post("/0/query/", data)).data;
    }

    private async send_heartbeat(bucketId: string, pulsetime: number, data: IEvent): Promise<IEvent> {
        let heartbeat = (await this.req.post("/0/buckets/" + bucketId + "/heartbeat?pulsetime=" + pulsetime, data)).data;
        heartbeat.timestamp = new Date(heartbeat.timestamp);
        return heartbeat;
    }

    // Start heartbeat queue processing if not currently processing
    private updateHeartbeatQueue(bucketId: string) {
        const queue = this.heartbeatQueues[bucketId];

        if (!queue.isProcessing && queue.data.length) {
            const { pulsetime, heartbeat, onSuccess, onError } = queue.data.shift() as IHeartbeatQueueItem;

            queue.isProcessing = true;
            this.send_heartbeat(bucketId, pulsetime, heartbeat)
                .then((response) => {
                    onSuccess();
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucketId);
                })
                .catch((response) => {
                    onError(response);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucketId);
                });
        }
    }
}
