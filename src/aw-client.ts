export class FetchError extends Error {
    response: Response;
    constructor(res: Response) {
        super(`Failed fetch with status code ${res.status}`);
        this.response = res;
    }
}

function toISODateString(d: any): string {
    if (typeof d === "string") {
        return d;
    }
    if (d && typeof d.toISOString === "function") {
        return d.toISOString();
    }
    if (d && typeof d.toDate === "function") {
        return d.toDate().toISOString();
    }
    if (d) {
        return new Date(d).toISOString();
    }
    return "";
}

// Bump when the persisted cache layout changes, to invalidate old entries.
const CACHE_SCHEMA_VERSION = "v1";

// `localStorage` and friends aren't in the es6 lib; declare them so we can
// feature-detect with `typeof` without pulling in the whole DOM lib.
declare const localStorage: CacheStorageAdapter | undefined;

/** Returns true if the "start/end" timeperiod ends in the future. */
function timeperiodSpansFuture(timeperiod: string): boolean {
    const stop = new Date(timeperiod.split("/")[1]);
    return new Date() < stop;
}

/** FNV-1a 32-bit hash, used to keep storage keys short and bounded. */
function hashString(str: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

function isQuotaError(e: unknown): boolean {
    if (!e || typeof e !== "object") return false;
    const err = e as { name?: string; code?: number };
    return (
        err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        err.code === 22 ||
        err.code === 1014
    );
}

/**
 * Returns `window.localStorage` if it exists and is writable, otherwise
 * undefined. Never throws (private-mode/SSR/Node all return undefined).
 */
function getDefaultCacheStorage(): CacheStorageAdapter | undefined {
    try {
        if (typeof localStorage === "undefined" || !localStorage)
            return undefined;
        const probe = `awc:${CACHE_SCHEMA_VERSION}:__probe__`;
        localStorage.setItem(probe, "1");
        localStorage.removeItem(probe);
        return localStorage;
    } catch {
        // Storage present but unusable (e.g. Safari private mode throws).
        return undefined;
    }
}

/**
 * Persists query results to a storage adapter, namespaced per
 * schema-version/server/client. Maintains its own LRU index so it never has to
 * enumerate the underlying storage, and degrades gracefully (in-memory only)
 * when writes fail.
 */
class PersistentQueryCache {
    private storage: CacheStorageAdapter;
    private prefix: string;
    private indexKey: string;
    private maxEntries?: number;
    // Hashes of stored entries, oldest first (LRU order).
    private index: string[];

    constructor(
        storage: CacheStorageAdapter,
        namespace: string,
        maxEntries?: number,
    ) {
        this.storage = storage;
        this.prefix = namespace;
        this.indexKey = `${namespace}index`;
        this.maxEntries = maxEntries;
        this.index = this.loadIndex();
    }

    private loadIndex(): string[] {
        try {
            const raw = this.storage.getItem(this.indexKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    private saveIndex(): void {
        this.storage.setItem(this.indexKey, JSON.stringify(this.index));
    }

    private entryKey(hash: string): string {
        return `${this.prefix}e:${hash}`;
    }

    // Move a hash to the most-recently-used end of the index.
    private touch(hash: string): void {
        const i = this.index.indexOf(hash);
        if (i !== -1) this.index.splice(i, 1);
        this.index.push(hash);
    }

    // Drop the oldest entry (other than `exceptHash`); returns false if none.
    private evictOldest(exceptHash?: string): boolean {
        let idx = 0;
        if (exceptHash !== undefined && this.index[idx] === exceptHash) idx = 1;
        if (idx >= this.index.length) return false;
        const hash = this.index.splice(idx, 1)[0];
        try {
            this.storage.removeItem(this.entryKey(hash));
        } catch {
            // ignore
        }
        return true;
    }

    get(cacheKey: string): object[] | undefined {
        const hash = hashString(cacheKey);
        let raw: string | null;
        try {
            raw = this.storage.getItem(this.entryKey(hash));
        } catch {
            return undefined;
        }
        if (!raw) return undefined;
        try {
            const entry = JSON.parse(raw) as { k: string; v: object[] };
            if (entry.k !== cacheKey) return undefined; // hash collision
            this.touch(hash);
            try {
                this.saveIndex();
            } catch {
                // LRU ordering is best-effort; ignore failures on read.
            }
            return entry.v;
        } catch {
            return undefined;
        }
    }

    set(cacheKey: string, value: object[]): void {
        const hash = hashString(cacheKey);
        const payload = JSON.stringify({ k: cacheKey, v: value });

        // Enforce the LRU cap before writing a new entry.
        if (this.maxEntries !== undefined) {
            while (
                this.index.length >= this.maxEntries &&
                this.index.indexOf(hash) === -1 &&
                this.evictOldest(hash)
            ) {
                // keep evicting until under cap
            }
        }

        for (;;) {
            try {
                this.storage.setItem(this.entryKey(hash), payload);
                this.touch(hash);
                this.saveIndex();
                return;
            } catch (e) {
                // On quota errors, evict the oldest entry and retry; otherwise
                // give up and rely on the in-memory cache.
                if (isQuotaError(e) && this.evictOldest(hash)) continue;
                return;
            }
        }
    }

    clear(): void {
        for (const hash of this.index) {
            try {
                this.storage.removeItem(this.entryKey(hash));
            } catch {
                // ignore
            }
        }
        this.index = [];
        try {
            this.storage.removeItem(this.indexKey);
        } catch {
            // ignore
        }
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

/**
 * Minimal storage interface used to persist the query cache.
 * `window.localStorage` satisfies this, as can a custom (e.g. IndexedDB-backed)
 * adapter for larger payloads.
 */
export interface CacheStorageAdapter {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface AWReqOptions {
    controller?: AbortController;
    testing?: boolean;
    baseURL?: string;
    timeout?: number;
    token?: string;
    /** Persist the query cache across reloads (browser only). Default: false. */
    persistCache?: boolean;
    /**
     * Storage backend for the persisted cache.
     * Defaults to `window.localStorage` when available; ignored unless
     * `persistCache` is enabled.
     */
    cacheStorage?: CacheStorageAdapter;
    /** Optional LRU cap on the number of persisted cache entries. */
    maxCacheEntries?: number;
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

type TimeoutSignalResult = {
    signal?: AbortSignal;
    cleanup: () => void;
};

function makeTimeoutSignal(
    timeout?: number,
    existingSignal?: AbortSignal,
): TimeoutSignalResult {
    // Create a per-request AbortController and explicitly clean up both the timeout
    // and the propagated abort listener when the request finishes.
    //
    // The old code leaked because it added an "abort" listener to the long-lived
    // AWClient.controller.signal on every request but never removed it. In consumers
    // like aw-watcher-web (heartbeat every ~5 s), that accumulated hundreds of
    // thousands of AbortController instances over days of browsing.
    // See: https://github.com/ActivityWatch/aw-watcher-web/issues/222
    if (timeout === undefined && existingSignal === undefined) {
        return { signal: undefined, cleanup: () => undefined };
    }

    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const cleanup = () => {
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        if (existingSignal !== undefined && abortListener !== undefined) {
            existingSignal.removeEventListener("abort", abortListener);
            abortListener = undefined;
        }
    };

    if (timeout !== undefined) {
        timeoutId = setTimeout(() => {
            controller.abort();
            cleanup();
        }, timeout);
    }

    if (existingSignal !== undefined) {
        if (existingSignal.aborted) {
            controller.abort();
            cleanup();
            return { signal: controller.signal, cleanup };
        }

        abortListener = () => {
            controller.abort();
            cleanup();
        };
        existingSignal.addEventListener("abort", abortListener, { once: true });
    }

    return { signal: controller.signal, cleanup };
}

async function fetchWithFailure(
    input: string,
    init: RequestInit,
    timeout?: number,
): Promise<Response> {
    const { signal, cleanup } = makeTimeoutSignal(
        timeout,
        init.signal || undefined,
    );
    return fetch(input, { ...init, signal })
        .then((res) => {
            if (res.status >= 300) throw new FetchError(res);
            return res;
        })
        .finally(cleanup);
}

// Some servers (observed with aw-server and aw-server-rust, Firefox only) have
// returned a JSON-encoded string instead of the expected array/object despite a
// correct content-type, which then crashes callers with an opaque
// `TypeError: n.forEach is not a function`. Re-parse the string and fail with a
// message that names the endpoint instead. See: ActivityWatch/aw-client-js#45
function normalizeJsonResponse<T>(data: unknown, endpoint: string): T {
    if (typeof data !== "string") return data as T;
    try {
        return JSON.parse(data) as T;
    } catch {
        throw new Error(
            `Received invalid JSON from ${endpoint}: ${data.slice(0, 200)}`,
        );
    }
}

export class AWClient {
    public clientname: string;
    public baseURL: string;
    public apiURL: string;
    public timeout: number;
    public testing: boolean;
    public token: string | undefined;

    public controller: AbortController;

    private queryCache: { [cacheKey: string]: object[] };
    private persistentCache?: PersistentQueryCache;
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
        this.token = options.token;
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

        // In-memory cache for queries, by {timeperiod, query}.
        this.queryCache = {};

        // Optional persistent layer (browser localStorage by default).
        if (options.persistCache) {
            const storage = options.cacheStorage ?? getDefaultCacheStorage();
            if (storage) {
                // Namespace by schema version, server origin and client name so
                // switching servers never reads another server's results.
                const namespace = `awc:${CACHE_SCHEMA_VERSION}:${this.baseURL}:${this.clientname}:`;
                this.persistentCache = new PersistentQueryCache(
                    storage,
                    namespace,
                    options.maxCacheEntries,
                );
            }
        }
    }

    /** Clears both the in-memory and (if enabled) persisted query caches. */
    public clearCache(): void {
        this.queryCache = {};
        this.persistentCache?.clear();
    }

    private _authHeaders(): Record<string, string> {
        return this.token ? { Authorization: `Bearer ${this.token}` } : {};
    }

    /// Fetching logic
    /** Makes a GET request, assuming the response is JSON and parsing it */
    private async _get<T>(endpoint: string, params: RequestInit = {}) {
        return fetchWithFailure(
            `${this.apiURL}${endpoint}`,
            {
                ...params,
                headers: { ...this._authHeaders(), ...(params.headers ?? {}) },
                signal: this.controller.signal,
            },
            this.timeout,
        ).then((res) => res.json() as Promise<T>);
    }

    /**
     * Like {@link _get}, but also normalizes a double-encoded (string) JSON
     * response. Only safe for endpoints that never legitimately return a bare
     * string (arrays, objects, numbers) — NOT for endpoints like settings that
     * may legitimately return a string.
     */
    private async _getStructured<T>(
        endpoint: string,
        params: RequestInit = {},
    ) {
        return this._get<unknown>(endpoint, params).then((data) =>
            normalizeJsonResponse<T>(data, endpoint),
        );
    }

    private async _post(endpoint: string, data: Record<string, any>) {
        return fetchWithFailure(
            `${this.apiURL}${endpoint}`,
            {
                method: "POST",
                signal: this.controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    ...this._authHeaders(),
                },
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
                headers: { ...this._authHeaders() },
            },
            this.timeout,
        );
    }

    public async getInfo(): Promise<IInfo> {
        return this._getStructured<IInfo>("/0/info");
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
        const rawBuckets = await this._getStructured<{
            [bucketId: string]: IBucketRaw;
        }>("/0/buckets/");
        const buckets: { [bucketId: string]: IBucket } = {};
        for (const bucketId of Object.keys(rawBuckets)) {
            buckets[bucketId] = this.processRawBucket(rawBuckets[bucketId]);
        }
        return buckets;
    }

    public async getBucketInfo(bucketId: string): Promise<IBucket> {
        const bucket = await this._getStructured<IBucketRaw>(
            `/0/buckets/${bucketId}`,
        );
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
        return this._getStructured<IEventRaw>(
            `/0/buckets/${bucketId}/events/${eventId}`,
        ).then(this.processRawEvent);
    }

    /** Get events, with optional date ranges and limit */
    public async getEvents(
        bucketId: string,
        params: GetEventsOptions = {},
    ): Promise<IEvent[]> {
        const searchParams = new URLSearchParams();
        if (params.start)
            searchParams.set("start", toISODateString(params.start));
        if (params.end) searchParams.set("end", toISODateString(params.end));
        if (params.limit) searchParams.set("limit", params.limit.toString());
        const url = `/0/buckets/${bucketId}/events?${searchParams.toString()}`;
        return this._getStructured<IEventRaw[]>(url).then((events) =>
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
        if (startTime) params.set("start", toISODateString(startTime));
        if (endTime) params.set("end", toISODateString(endTime));
        const url = `/0/buckets/${bucketId}/events/count?${params.toString()}`;
        return this._getStructured<number>(url);
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
                    ? `${toISODateString(tp.start)}/${toISODateString(tp.end)}`
                    : tp,
            ),
        };

        const cacheResults: any[] = [];
        if (params.cache) {
            // Check cache for each {timeperiod, query} pair
            for (const timeperiod of data.timeperiods) {
                // never serve in-progress periods from cache
                if (timeperiodSpansFuture(timeperiod)) {
                    cacheResults.push(null);
                    continue;
                }

                // check in-memory cache, falling back to the persisted layer
                const cacheKey = JSON.stringify({ timeperiod, query });
                let cached = this.queryCache[cacheKey];
                if (cached === undefined && this.persistentCache) {
                    const persisted = this.persistentCache.get(cacheKey);
                    if (persisted !== undefined) {
                        cached = persisted;
                        this.queryCache[cacheKey] = persisted;
                    }
                }
                if (cached && (params.cacheEmpty || !isEmpty(cached))) {
                    cacheResults.push(cached);
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
                  })
                      .then((res) => res.json())
                      .then((d) => normalizeJsonResponse<any[]>(d, "/0/query/"))
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
        // NOTE: this also caches timeperiods that span the future in-memory,
        //       but this is ok since we check that when first checking the cache,
        //       and makes it easier to return all results from cache.
        //       In-progress periods are never written to the persistent layer.
        for (const [i, result] of queryResults.entries()) {
            const timeperiod = timeperiodsNotCached[i];
            const cacheKey = JSON.stringify({ timeperiod, query });
            this.queryCache[cacheKey] = result;
            if (this.persistentCache && !timeperiodSpansFuture(timeperiod)) {
                this.persistentCache.set(cacheKey, result);
            }
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
