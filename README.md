# aw-client-js

Client library for [ActivityWatch](http://activitywatch.net) in TypeScript/JavaScript.

[![Build Status](https://github.com/ActivityWatch/aw-client-js/workflows/Build/badge.svg)](https://github.com/ActivityWatch/aw-client-js/actions)
[![npm](https://img.shields.io/npm/v/aw-client)](https://www.npmjs.com/package/aw-client)
[![Known Vulnerabilities](https://snyk.io/test/github/ActivityWatch/aw-client-js/badge.svg)](https://snyk.io/test/github/ActivityWatch/aw-client-js)

## Install

```sh
npm install aw-client
```

## Usage

The library uses Promises for almost everything, so either use `.then()` or async/await syntax.

The example below is written with `.then()` to make it easy to run in the node REPL.

```javascript
const { AWClient } = require('aw-client');
const client = new AWClient('test-client')

// Get server info
client.getInfo().then(console.log);

// List buckets
client.getBuckets().then(console.log);

// Create bucket
const bucketId = "test";
client.createBucket(bucketId, "bucket-type", "your-hostname");

// Send a heartbeat
const nowStr = (new Date()).toISOString();
const heartbeat = {timestamp: nowStr, duration: 0, data: { label: "just testing!" }};
client.heartbeat(bucketId, 5, heartbeat);
```

## Persistent query cache

`AWClient.query()` caches results per `{timeperiod, query}` so repeated queries
are instant. By default this cache is in-memory only and is lost on page reload.

In browsers you can opt in to persisting the cache to `localStorage` so completed
(past) periods are reused across reloads:

```javascript
const client = new AWClient('my-client', {
    baseURL: 'http://127.0.0.1:5600',
    persistCache: true,          // opt-in; default false
    // cacheStorage: window.localStorage,  // default when available
    // maxCacheEntries: 1000,    // optional LRU cap
});
```

Behavior and safety notes:

- **Env-safe:** in Node / SSR / private-mode-throws environments, persistence
  silently falls back to in-memory only. It never throws because storage is
  missing.
- **Namespaced:** persisted keys are prefixed with a schema version, the server
  origin, and the client name, so switching aw-server instances never reads
  another server's results.
- **Never persists in-progress periods:** periods whose end is in the future are
  never persisted (and never served from cache), keeping live data fresh.
- **Quota handling:** on `localStorage` quota errors, the oldest entries are
  evicted (LRU) and the write is retried; otherwise it degrades to in-memory.
- **Storage size:** a year of multi-bucket category data can exceed
  `localStorage`'s ~5 MB limit. For very large payloads consider an
  IndexedDB-backed `cacheStorage` adapter implementing the same
  `getItem`/`setItem`/`removeItem` interface.
- **Stale past data:** completed periods are normally immutable, but a watcher
  backfill or re-import can change historical data. Persisted results survive
  reloads, so call `client.clearCache()` on force-reload and on hostname/server
  change to invalidate both the in-memory and persisted layers. (Folding a
  bucket `last_updated` signal into the cache key is a possible follow-up.)

## Contribute

### Setup your dev environment

```sh
npm install
```

### Build the library

```sh
npm run compile
```

### Run the tests

```sh
npm test
```
