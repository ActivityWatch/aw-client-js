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
    .createBucket(bucketId, "bucket-type", "your-hostname")
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
