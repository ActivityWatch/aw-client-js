import axios, { AxiosError, AxiosInstance } from "axios";

type EventData = { [k: string]: string | number };

// Default interface for events
export interface IEvent {
    id?: number;
    timestamp: Date;
    duration?: number; // duration in seconds
    data: EventData;
}

// Interfaces for coding activity
export interface IAppEditorEvent extends IEvent {
    data: EventData & {
        project: string; // Path to the current project / workDir
        file: string; // Path to the current file
        language: string; // Coding Language identifier (e.g. javascript, python, ...)
    };
}

export interface AWReqOptions {
    controller?: AbortController;
    testing?: boolean;
    baseURL?: string;
    timeout?: number;
}

export interface IBucket {
    id: string;
    name: string;
    type: string;
    client: string;
    hostname: string;
    created: Date;
    last_update?: Date;
    data: Record<string, unknown>;
}

interface IHeartbeatQueueItem {
    onSuccess: (value?: PromiseLike<undefined> | undefined) => void;
    onError: (err: AxiosError) => void;
    pulsetime: number;
    heartbeat: IEvent;
}

interface IInfo {
    hostname: string;
    version: string;
    testing: boolean;
}

interface GetEventsOptions {
    start?: Date;
    end?: Date;
    limit?: number;
}

export class AWClient {
    public clientname: string;
    public baseURL: string;
    public testing: boolean;
    public req: AxiosInstance;

    public controller: AbortController;

    private heartbeatQueues: {
        [bucketId: string]: {
            isProcessing: boolean;
            data: IHeartbeatQueueItem[];
        };
    } = {};

    constructor(clientname: string, options: AWReqOptions = {}) {
        this.clientname = clientname;
        this.testing = options.testing || false;
        if (typeof options.baseURL === "undefined") {
            const port = !options.testing ? 5600 : 5666;
            // Note: had to switch to 127.0.0.1 over localhost as otherwise there's
            // a possibility it tries to connect to IPv6's `::1`, which will be refused.
            this.baseURL = `http://127.0.0.1:${port}`;
        } else {
            this.baseURL = options.baseURL;
        }
        this.controller = options.controller || new AbortController();

        this.req = axios.create({
            baseURL: this.baseURL + "/api",
            timeout: options.timeout || 30000,
        });
    }

    private async _get(endpoint: string, params: object = {}) {
        return this.req
            .get(endpoint, { ...params, signal: this.controller.signal })
            .then((res) => (res && res.data) || res);
    }

    private async _post(endpoint: string, data: object = {}) {
        return this.req
            .post(endpoint, data, { signal: this.controller.signal })
            .then((res) => (res && res.data) || res);
    }

    private async _delete(endpoint: string) {
        return this.req.delete(endpoint, { signal: this.controller.signal });
    }

    public async getInfo(): Promise<IInfo> {
        return this._get("/0/info");
    }

    public async abort(msg?: string) {
        console.info(msg || "Requests cancelled");
        this.controller.abort();
        this.controller = new AbortController();
    }

    public async ensureBucket(
        bucketId: string,
        type: string,
        hostname: string
    ): Promise<{ alreadyExist: boolean }> {
        try {
            await this._post(`/0/buckets/${bucketId}`, {
                client: this.clientname,
                type,
                hostname,
            });
        } catch (err) {
            // Will return 304 if bucket already exists
            if (
                axios.isAxiosError(err) &&
                err.response &&
                err.response.status === 304
            ) {
                return { alreadyExist: true };
            }
            throw err;
        }
        return { alreadyExist: false };
    }

    public async createBucket(
        bucketId: string,
        type: string,
        hostname: string
    ): Promise<undefined> {
        await this._post(`/0/buckets/${bucketId}`, {
            client: this.clientname,
            type,
            hostname,
        });
        return undefined;
    }

    public async deleteBucket(bucketId: string): Promise<undefined> {
        await this._delete(`/0/buckets/${bucketId}?force=1`);
        return undefined;
    }

    public async getBuckets(): Promise<{ [bucketId: string]: IBucket }> {
        const buckets = await this._get("/0/buckets/");
        Object.keys(buckets).forEach((bucket) => {
            buckets[bucket].created = new Date(buckets[bucket].created);
            if (buckets[bucket].last_updated) {
                buckets[bucket].last_updated = new Date(
                    buckets[bucket].last_updated
                );
            }
        });
        return buckets;
    }

    public async getBucketInfo(bucketId: string): Promise<IBucket> {
        const bucket = await this._get(`/0/buckets/${bucketId}`);
        if (bucket.data === undefined) {
            console.warn(
                "Received bucket had undefined data, likely due to data field unsupported by server. Try updating your ActivityWatch server to get rid of this message."
            );
            bucket.data = {};
        }
        bucket.created = new Date(bucket.created);
        return bucket;
    }

    public async getEvent(bucketId: string, eventId: number): Promise<IEvent> {
        // Get a single event by ID
        const event = await this._get(
            "/0/buckets/" + bucketId + "/events/" + eventId
        );
        event.timestamp = new Date(event.timestamp);
        return event;
    }

    public async getEvents(
        bucketId: string,
        params: GetEventsOptions = {}
    ): Promise<IEvent[]> {
        const events = await this._get("/0/buckets/" + bucketId + "/events", {
            params,
        });
        events.forEach((event: IEvent) => {
            event.timestamp = new Date(event.timestamp);
        });
        return events;
    }

    public async countEvents(
        bucketId: string,
        startTime?: Date,
        endTime?: Date
    ) {
        const params = {
            starttime: startTime ? startTime.toISOString() : null,
            endtime: endTime ? endTime.toISOString() : null,
        };
        return this._get("/0/buckets/" + bucketId + "/events/count", {
            params,
        });
    }

    // Insert a single event, requires the event to not have an ID assigned
    public async insertEvent(bucketId: string, event: IEvent): Promise<void> {
        await this.insertEvents(bucketId, [event]);
    }

    // Insert multiple events, requires the events to not have IDs assigned
    public async insertEvents(
        bucketId: string,
        events: IEvent[]
    ): Promise<void> {
        // Check that events don't have IDs
        // To replace an event, use `replaceEvent`, which does the opposite check (requires ID)
        for (const event of events) {
            if (event.id !== undefined || event.id !== null) {
                throw Error(`Can't insert event with ID assigned: ${event}`);
            }
        }
        await this._post("/0/buckets/" + bucketId + "/events", events);
    }

    // Replace an event, requires the event to have an ID assigned
    public async replaceEvent(bucketId: string, event: IEvent): Promise<void> {
        await this.replaceEvents(bucketId, [event]);
    }

    // Replace multiple events, requires the events to have IDs assigned
    public async replaceEvents(
        bucketId: string,
        events: IEvent[]
    ): Promise<void> {
        for (const event of events) {
            if (event.id === undefined) {
                throw Error("Can't replace event without ID assigned");
            }
        }
        await this._post("/0/buckets/" + bucketId + "/events", events);
    }

    public async deleteEvent(bucketId: string, eventId: number): Promise<void> {
        await this._delete("/0/buckets/" + bucketId + "/events/" + eventId);
    }

    /**
     *
     * @param bucketId The id of the bucket to send the heartbeat to
     * @param pulsetime The maximum amount of time in seconds since the last heartbeat to be merged
     *                  with the previous heartbeat in aw-server
     * @param heartbeat The actual heartbeat event
     */
    public heartbeat(
        bucketId: string,
        pulsetime: number,
        heartbeat: IEvent
    ): Promise<void> {
        // Create heartbeat queue for bucket if not already existing
        if (
            !Object.prototype.hasOwnProperty.call(
                this.heartbeatQueues,
                bucketId
            )
        ) {
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

    /* eslint-disable @typescript-eslint/no-explicit-any */
    public async query(
        timeperiods: (string | { start: Date; end: Date })[],
        query: string[]
    ): Promise<any[]> {
        const data = {
            query,
            timeperiods: timeperiods.map((tp) => {
                return typeof tp !== "string"
                    ? `${tp.start.toISOString()}/${tp.end.toISOString()}`
                    : tp;
            }),
        };
        return await this._post("/0/query/", data);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */

    private async send_heartbeat(
        bucketId: string,
        pulsetime: number,
        data: IEvent
    ): Promise<IEvent> {
        const url =
            "/0/buckets/" + bucketId + "/heartbeat?pulsetime=" + pulsetime;
        const heartbeat = await this._post(url, data);
        heartbeat.timestamp = new Date(heartbeat.timestamp);
        return heartbeat;
    }

    // Start heartbeat queue processing if not currently processing
    private updateHeartbeatQueue(bucketId: string) {
        const queue = this.heartbeatQueues[bucketId];

        if (!queue.isProcessing && queue.data.length) {
            const { pulsetime, heartbeat, onSuccess, onError } =
                queue.data.shift() as IHeartbeatQueueItem;

            queue.isProcessing = true;
            this.send_heartbeat(bucketId, pulsetime, heartbeat)
                .then(() => {
                    onSuccess();
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucketId);
                })
                .catch((err) => {
                    onError(err);
                    queue.isProcessing = false;
                    this.updateHeartbeatQueue(bucketId);
                });
        }
    }
}
