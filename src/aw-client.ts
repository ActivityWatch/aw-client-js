export class FetchError extends Error {
    response: Response;
    constructor(res: Response) {
        super(`Failed fetch with status code ${res.status}`);
        this.response = res;
    }
}

type EventData = { [k: string]: string | number | boolean };

type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONObject | JSONArray;
type JSONArray = Array<JSONValue>;
type JSONObject = { [member: string]: JSONValue };

// Default interface for events
interface IEventRaw {
    id?: number;
    timestamp: string;
    duration?: number;
    data: EventData;
}
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

interface IBucketRaw {
    id: string;
    name: string;
    type: string;
    client: string;
    hostname: string;
    created: string;
    last_update?: string;
    data: Record<string, unknown>;
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
    onError: (err: Error) => void;
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

function makeTimeoutAbortSignal(
    timeout?: number,
    existingSignal?: AbortSignal,
) {
    if (timeout === undefined)
        return { signal: existingSignal, timeoutId: undefined };
    const abortController = new AbortController();
    const timeoutId = setTimeout(
        () => abortController.abort(),
        timeout || 10000,
    );
    // Sync with existing abort signal if it exists
    if (existingSignal?.aborted) abortController.abort();
    else
        existingSignal?.addEventListener("abort", () =>
            abortController.abort(),
        );
    return { signal: abortController.signal, timeoutId };
}

async function fetchWithFailure(
    input: string,
    init: RequestInit,
    timeout?: number,
): Promise<Response> {
    const { signal, timeoutId } = makeTimeoutAbortSignal(
        timeout,
        init.signal || undefined,
    );
    return fetch(input, { ...init, signal })
        .then((res) => {
            if (res.status >= 300) throw new FetchError(res);
            return res;
        })
        .finally(() => clearTimeout(timeoutId));
}

export class AWClient {
    public clientname: string;
    public baseURL: string;
    public apiURL: string;
    public timeout: number;
    public testing: boolean;

    public controller: AbortController;

    private queryCache: { [cacheKey: string]: object[] };
    private heartbeatQueues: {
        [bucketId: string]: {
            isProcessing: boolean;
            data: IHeartbeatQueueItem[];
        };
    } = {};

    constructor(clientname: string, options: AWReqOptions = {}) {
        this.clientname = clientname;
        this.testing = options.testing ?? false;
        this.timeout = options.timeout ?? 30000;
        if (typeof options.baseURL === "undefined") {
            const port = !options.testing ? 5600 : 5666;
            // Note: had to switch to 127.0.0.1 over localhost as otherwise there's
            // a possibility it tries to connect to IPv6's `::1`, which will be refused.
            this.baseURL = `http://127.0.0.1:${port}`;
        } else {
            this.baseURL = options.baseURL;
        }
        this.apiURL = this.baseURL + "/api";
        this.controller = options.controller || new AbortController();

        // Cache for queries, by timeperiod
        // TODO: persist cache and add cache expiry/invalidation
        this.queryCache = {};
    }

    /// Fetching logic
    /** Makes a GET request, assuming the response is JSON and parsing it */
    private async _get<T>(endpoint: string, params: RequestInit = {}) {
        return fetchWithFailure(
            `${this.apiURL}${endpoint}`,
            {
                ...params,
                signal: this.controller.signal,
            },
            this.timeout,
        ).then((res) => res.json() as Promise<T>);
    }

    private async _post(endpoint: string, data: Record<string, any>) {
        return fetchWithFailure(
            `${this.apiURL}${endpoint}`,
            {
                method: "POST",
                signal: this.controller.signal,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            },
            this.timeout,
        );
    }

    private async _delete(endpoint: string) {
        return fetchWithFailure(
            `${this.apiURL}${endpoint}`,
            {
                method: "DELETE",
                signal: this.controller.signal,
            },
            this.timeout,
        );
    }

    public async getInfo(): Promise<IInfo> {
        return this._get<IInfo>("/0/info");
    }

    public async abort(msg?: string) {
        console.info(msg || "Requests cancelled");
        this.controller.abort();
        this.controller = new AbortController();
    }

    /// Buckets
    private processRawBucket(bucket: IBucketRaw): IBucket {
        return {
            ...bucket,
            created: new Date(bucket.created),
            last_update:
                bucket.last_update !== undefined
                    ? new Date(bucket.last_update)
                    : undefined,
        };
    }

    public async ensureBucket(
        bucketId: string,
        type: string,
        hostname: string,
    ): Promise<{ alreadyExist: boolean }> {
        return this._post(`/0/buckets/${bucketId}`, {
            client: this.clientname,
            type,
            hostname,
        })
            .then(() => ({ alreadyExist: false }))
            .catch((err) => {
                // Will return 304 if bucket already exists
                if (err instanceof FetchError && err.response.status === 304) {
                    return { alreadyExist: true };
                }
                throw err;
            });
    }

    public async createBucket(
        bucketId: string,
        type: string,
        hostname: string,
    ): Promise<void> {
        await this._post(`/0/buckets/${bucketId}`, {
            client: this.clientname,
            type,
            hostname,
        });
    }

    public async deleteBucket(bucketId: string): Promise<void> {
        await this._delete(`/0/buckets/${bucketId}?force=1`);
    }

    public async getBuckets(): Promise<{ [bucketId: string]: IBucket }> {
        const rawBuckets = await this._get<{ [bucketId: string]: IBucketRaw }>(
            "/0/buckets/",
        );
        const buckets: { [bucketId: string]: IBucket } = {};
        for (const bucketId of Object.keys(rawBuckets)) {
            buckets[bucketId] = this.processRawBucket(rawBuckets[bucketId]);
        }
        return buckets;
    }

    public async getBucketInfo(bucketId: string): Promise<IBucket> {
        const bucket = await this._get<IBucketRaw>(`/0/buckets/${bucketId}`);
        if (bucket.data === undefined) {
            console.warn(
                "Received bucket had undefined data, likely due to data field unsupported by server. Try updating your ActivityWatch server to get rid of this message.",
            );
            bucket.data = {};
        }
        return this.processRawBucket(bucket);
    }

    /// Events
    private processRawEvent(event: IEventRaw): IEvent {
        return { ...event, timestamp: new Date(event.timestamp) };
    }

    /** Get a single event by ID */
    public async getEvent(bucketId: string, eventId: number): Promise<IEvent> {
        return this._get<IEventRaw>(
            `/0/buckets/${bucketId}/events/${eventId}`,
        ).then(this.processRawEvent);
    }

    /** Get events, with optional date ranges and limit */
    public async getEvents(
        bucketId: string,
        params: GetEventsOptions = {},
    ): Promise<IEvent[]> {
        const searchParams = new URLSearchParams();
        if (params.start) searchParams.set("start", params.start.toISOString());
        if (params.end) searchParams.set("end", params.end.toISOString());
        if (params.limit) searchParams.set("limit", params.limit.toString());
        const url = `/0/buckets/${bucketId}/events?${searchParams.toString()}`;
        return this._get<IEventRaw[]>(url).then((events) =>
            events.map(this.processRawEvent),
        );
    }

    /** Count the number of events, with optional date ranges */
    public async countEvents(
        bucketId: string,
        startTime?: Date,
        endTime?: Date,
    ) {
        const params = new URLSearchParams();
        if (startTime) params.set("start", startTime.toISOString());
        if (endTime) params.set("end", endTime.toISOString());
        const url = `/0/buckets/${bucketId}/events/count?${params.toString()}`;
        return this._get<number>(url);
    }

    /** Insert a single event, requires the event to not have an ID assigned */
    public async insertEvent(bucketId: string, event: IEvent): Promise<void> {
        await this.insertEvents(bucketId, [event]);
    }

    /** Insert multiple events, requires the events to not have IDs assigned */
    public async insertEvents(
        bucketId: string,
        events: IEvent[],
    ): Promise<void> {
        // Check that events don't have IDs
        // To replace an event, use `replaceEvent`, which does the opposite check (requires ID)
        for (const event of events) {
            if (event.id !== undefined) {
                throw Error(`Can't insert event with ID assigned: ${event}`);
            }
        }
        await this._post("/0/buckets/" + bucketId + "/events", events);
    }

    /** Replace an event, requires the event to have an ID assigned */
    public async replaceEvent(bucketId: string, event: IEvent): Promise<void> {
        await this.replaceEvents(bucketId, [event]);
    }

    /** Replace multiple events, requires the events to have IDs assigned */
    public async replaceEvents(
        bucketId: string,
        events: IEvent[],
    ): Promise<void> {
        for (const event of events) {
            if (event.id === undefined) {
                throw Error("Can't replace event without ID assigned");
            }
        }
        await this._post("/0/buckets/" + bucketId + "/events", events);
    }

    /** Delete an event by ID */
    public async deleteEvent(bucketId: string, eventId: number): Promise<void> {
        await this._delete("/0/buckets/" + bucketId + "/events/" + eventId);
    }

    /**
     * @param bucketId The id of the bucket to send the heartbeat to
     * @param pulsetime The maximum amount of time in seconds since the last heartbeat to be merged
     *                  with the previous heartbeat in aw-server
     * @param heartbeat The actual heartbeat event
     */
    public heartbeat(
        bucketId: string,
        pulsetime: number,
        heartbeat: IEvent,
    ): Promise<void> {
        // Create heartbeat queue for bucket if not already existing
        this.heartbeatQueues[bucketId] ??= {
            isProcessing: false,
            data: [],
        };

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
    /**
     * Queries the aw-server for data
     *
     * If cache is enabled, for each {query, timeperiod} it will return cached data if available,
     * if a timeperiod spans the future it will not cache it.
     */
    public async query(
        timeperiods: (string | { start: Date; end: Date })[],
        query: string[],
        params: {
            cache?: boolean;
            cacheEmpty?: boolean;
            verbose?: boolean;
            name?: string;
        } = {},
    ): Promise<any[]> {
        params.cache = params.cache ?? true;
        params.cacheEmpty = params.cacheEmpty ?? false;
        params.verbose = params.verbose ?? false;
        params.name = params.name ?? "query";

        function isEmpty(obj: any) {
            // obj can be an array or an object, this works for both
            return Object.keys(obj).length === 0;
        }

        const data = {
            query,
            timeperiods: timeperiods.map((tp) =>
                typeof tp !== "string"
                    ? `${tp.start.toISOString()}/${tp.end.toISOString()}`
                    : tp,
            ),
        };

        const cacheResults: any[] = [];
        if (params.cache) {
            // Check cache for each {timeperiod, query} pair
            for (const timeperiod of data.timeperiods) {
                // check if timeperiod spans the future
                const stop = new Date(timeperiod.split("/")[1]);
                const now = new Date();
                if (now < stop) {
                    cacheResults.push(null);
                    continue;
                }

                // check cache
                const cacheKey = JSON.stringify({ timeperiod, query });
                if (
                    this.queryCache[cacheKey] &&
                    (params.cacheEmpty || !isEmpty(this.queryCache[cacheKey]))
                ) {
                    cacheResults.push(this.queryCache[cacheKey]);
                } else {
                    cacheResults.push(null);
                }
            }

            // If all results were cached, return them
            if (cacheResults.every((r) => r !== null)) {
                if (params.verbose)
                    console.debug(
                        `Returning fully cached query results for ${params.name}`,
                    );
                return cacheResults;
            }
        }

        const timeperiodsNotCached = data.timeperiods.filter(
            (_, i) => cacheResults[i] === null,
        );

        // Otherwise, query with remaining timeperiods
        const queryResults =
            timeperiodsNotCached.length > 0
                ? await this._post("/0/query/", {
                      ...data,
                      timeperiods: timeperiodsNotCached,
                  }).then((res) => res.json() as Promise<any[]>)
                : [];

        if (!params.cache) return queryResults;

        if (params.verbose) {
            if (cacheResults.every((r) => r === null)) {
                console.debug(
                    `Returning uncached query results for ${params.name}`,
                );
            } else if (
                cacheResults.some((r) => r === null) &&
                cacheResults.some((r) => r !== null)
            ) {
                console.debug(
                    `Returning partially cached query results for ${params.name}`,
                );
            }
        }

        // Cache results
        // NOTE: this also caches timeperiods that span the future,
        //       but this is ok since we check that when first checking the cache,
        //       and makes it easier to return all results from cache.
        for (const [i, result] of queryResults.entries()) {
            const cacheKey = JSON.stringify({
                timeperiod: timeperiodsNotCached[i],
                query,
            });
            this.queryCache[cacheKey] = result;
        }

        // Return all results from cache
        return data.timeperiods.map((tp) => {
            const cacheKey = JSON.stringify({
                timeperiod: tp,
                query,
            });
            return this.queryCache[cacheKey];
        });
    }

    private async send_heartbeat(
        bucketId: string,
        pulsetime: number,
        data: IEvent,
    ): Promise<IEvent> {
        const url =
            "/0/buckets/" + bucketId + "/heartbeat?pulsetime=" + pulsetime;
        const heartbeat = await this._post(url, data).then(
            (res) => res.json() as Promise<any>,
        );
        heartbeat.timestamp = new Date(heartbeat.timestamp);
        return heartbeat;
    }

    /** Start heartbeat queue processing if not currently processing */
    private updateHeartbeatQueue(bucketId: string) {
        const queue = this.heartbeatQueues[bucketId];

        if (queue.isProcessing || !queue.data.length) return;
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

    // Get all settings
    public async get_settings(): Promise<object> {
        return await this._get("/0/settings");
    }

    // Get a setting
    public async get_setting(key: string): Promise<JSONObject> {
        return await this._get("/0/settings/" + key);
    }

    // Set a setting
    public async set_setting(key: string, value: JSONObject): Promise<void> {
        await this._post("/0/settings/" + key, value);
    }
}
