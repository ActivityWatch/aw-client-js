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
const { AWClient } = require("aw-client");
const client = new AWClient("test-client");

// Get server info
client.getInfo().then(console.log);

// List buckets
client.getBuckets().then(console.log);

// Create bucket, send a heartbeat, then read it back once both writes finish
const bucketId = "test";
client
    .ensureBucket(bucketId, "bucket-type", "your-hostname")
    .then(() => {
        const nowStr = new Date().toISOString();
        const heartbeat = {
            timestamp: nowStr,
            duration: 0,
            data: { label: "just testing!" },
        };
        return client.heartbeat(bucketId, 5, heartbeat);
    })
    .then(() => {
        // Get events in a bucket, optionally bounded by time range and/or limited in count
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000); // last 24 hours
        client
            .getEvents(bucketId, { start, end, limit: 100 })
            .then(console.log);

        // Run a query over one or more timeperiods
        const timeperiods = [{ start, end }];
        const query = [
            `events = query_bucket("${bucketId}");`,
            "RETURN = events;",
        ];
        client.query(timeperiods, query).then(console.log);
    });
```

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
## Opt-in heartbeat pre-merging

State watchers that repeatedly send the same data can use `HeartbeatBuffer` to
combine consecutive samples before sending them. Ordinary `client.heartbeat()`
calls keep their existing immediate behavior.

```javascript
const { AWClient, HeartbeatBuffer } = require('aw-client');
const client = new AWClient('my-watcher');
const buffer = new HeartbeatBuffer(client, 'my-bucket', 5, {
    commitInterval: 10, // maximum buffering time in seconds
    onError: console.error,
});

// Call for each observed sample; this snapshots and buffers without blocking.
buffer.heartbeat({ timestamp: new Date(), duration: 0, data: { app: 'Editor' } });
// ...more samples from the same watcher...

// Await delivery of pending and outstanding requests before stopping the watcher.
await buffer.flush();
```

Use one buffer per bucket. Data must match exactly (property order does not
matter), and a new timestamp must fall between the pending sample's start and
its end plus `pulsetime`. Merging extends duration without shortening overlapping
samples. A data change, a gap beyond pulsetime, or an older timestamp sends the
pending sample first. The commit timer starts with the first sample of each
batch and is not postponed by later samples.

Samples are held in memory until sent. Background failures go to `onError`
(`console.error` by default); `flush()` also rejects if an outstanding request
fails. This does not add persistent queuing or retries. Use the buffer for
state/duration heartbeats, not for accumulating counters that need to be summed.
