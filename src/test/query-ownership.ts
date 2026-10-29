import * as assert from "assert";
import { AWClient } from "../aw-client";

// JSON-shaped results are intentionally mutable: consumers remap event data.
function eventResult(app = "com.test.app") {
    return {
        events: [
            { data: { app, title: "Test App", nested: { values: [1, 2] } } },
        ],
    };
}

const periods = [
    "2000-01-01T00:00:00Z/2000-01-02T00:00:00Z",
    "2000-01-02T00:00:00Z/2000-01-03T00:00:00Z",
];
const query = ['RETURN = query_bucket("synthetic");'];

describe("Query result ownership", () => {
    const originalFetch = global.fetch;
    let client: AWClient;
    let requests: string[][];
    let resultForPeriod: (period: string) => unknown;
    let doubleEncoded: boolean;

    beforeEach(() => {
        client = new AWClient("query-ownership-test", { testing: true });
        requests = [];
        resultForPeriod = () => eventResult();
        doubleEncoded = false;
        global.fetch = (async (_input, init) => {
            const body = JSON.parse(String(init?.body));
            requests.push(body.timeperiods);
            const results = body.timeperiods.map(resultForPeriod);
            return new Response(
                JSON.stringify(
                    doubleEncoded ? JSON.stringify(results) : results,
                ),
                { headers: { "Content-Type": "application/json" } },
            );
        }) as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it("isolates nested objects and arrays returned by an initial miss", async () => {
        const first = await client.query([periods[0]], query);
        first[0].events[0].data.app = "changed";
        first[0].events[0].data.nested.values[0] = 99;
        first[0].events.push({ data: {} });
        const second = await client.query([periods[0]], query);
        assert.deepStrictEqual(second, [eventResult()]);
        assert.deepStrictEqual(requests, [[periods[0]]]);
    });

    it("isolates a full cache hit from both earlier and later results", async () => {
        const first = await client.query([periods[0]], query);
        const hit = await client.query([periods[0]], query);
        assert.notStrictEqual(hit[0], first[0]);
        assert.notStrictEqual(hit[0].events, first[0].events);
        hit[0].events[0].data.nested.values.push(3);
        hit[0].events[0].data.app = "changed";
        assert.deepStrictEqual(first, [eventResult()]);
        assert.deepStrictEqual(await client.query([periods[0]], query), [
            eventResult(),
        ]);
        assert.equal(requests.length, 1);
    });

    it("isolates both cached and fetched parts of mixed, reordered periods", async () => {
        resultForPeriod = (period) => eventResult(period);
        await client.query([periods[0]], query);
        const mixed = await client.query([periods[1], periods[0]], query);
        assert.deepStrictEqual(mixed, [
            eventResult(periods[1]),
            eventResult(periods[0]),
        ]);
        mixed[0].events[0].data.nested.values.splice(0);
        mixed[1].events[0].data.app = "changed";
        assert.deepStrictEqual(
            await client.query([periods[0], periods[1]], query),
            [eventResult(periods[0]), eventResult(periods[1])],
        );
        assert.deepStrictEqual(requests, [[periods[0]], [periods[1]]]);
    });

    it("keeps the original ScreenTime app identity across repeated remapping", async () => {
        for (let i = 0; i < 3; i++) {
            const results = await client.query([periods[0]], query);
            const data = results[0].events[0].data;
            // ScreenTime's consumer stores the original bundle ID before remapping.
            data.classname = data.app;
            data.app = data.title;
            assert.equal(data.classname, "com.test.app");
            assert.equal(data.app, "Test App");
        }
        assert.equal(requests.length, 1);
    });

    it("preserves normalized double-encoded JSON ownership", async () => {
        doubleEncoded = true;
        const results = await client.query([periods[0]], query);
        results[0].events[0].data.nested.values.push(3);
        assert.deepStrictEqual(await client.query([periods[0]], query), [
            eventResult(),
        ]);
        assert.equal(requests.length, 1);
    });

    it("keeps empty-result cache policy without sharing returned empty arrays", async () => {
        resultForPeriod = () => [];
        await client.query([periods[0]], query);
        await client.query([periods[0]], query);
        assert.equal(
            requests.length,
            2,
            "empty results are refetched by default",
        );
        const hit = await client.query([periods[0]], query, {
            cacheEmpty: true,
        });
        hit[0].push("caller value");
        assert.deepStrictEqual(
            await client.query([periods[0]], query, { cacheEmpty: true }),
            [[]],
        );
        assert.equal(requests.length, 2);
    });

    it("preserves scalar and empty-period return shapes", async () => {
        for (const value of [42, true, "text", null, 0, false]) {
            resultForPeriod = () => value;
            const scalarQuery = [`RETURN = ${JSON.stringify(value)};`];
            assert.deepStrictEqual(
                await client.query([periods[0]], scalarQuery),
                [value],
            );
            assert.deepStrictEqual(
                await client.query([periods[0]], scalarQuery),
                [value],
            );
        }
        // Scalar cache-hit policy is covered by its separate repair, #64.
        assert.deepStrictEqual(await client.query([], query), []);
    });

    it("continues refetching future periods and returning their unmodified values", async () => {
        const future = "2999-01-01T00:00:00Z/2999-01-02T00:00:00Z";
        const first = await client.query([future], query);
        first[0].events[0].data.app = "changed";
        assert.deepStrictEqual(await client.query([future], query), [
            eventResult(),
        ]);
        assert.deepStrictEqual(requests, [[future], [future]]);
    });
});
