import * as assert from "assert";
import { AWClient } from "../aw-client";

const periods = [
    "2022-01-01T00:00:00.000Z/2022-01-02T00:00:00.000Z",
    "2022-01-02T00:00:00.000Z/2022-01-03T00:00:00.000Z",
    "2022-01-03T00:00:00.000Z/2022-01-04T00:00:00.000Z",
];

describe("Query result caching", () => {
    const originalFetch = global.fetch;
    let requests: string[][];

    function respondWith(result: unknown) {
        global.fetch = (async (_url, options) => {
            const body = JSON.parse(options?.body as string);
            requests.push(body.timeperiods);
            return new Response(
                JSON.stringify(body.timeperiods.map(() => result)),
                { headers: { "Content-Type": "application/json" } },
            );
        }) as typeof fetch;
    }

    beforeEach(() => {
        requests = [];
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    for (const cacheEmpty of [false, true]) {
        for (const result of [0, 1, -2, 0.5, false, true]) {
            it(`reuses scalar ${result} with cacheEmpty=${cacheEmpty}`, async () => {
                respondWith(result);
                const client = new AWClient("cache-test", { testing: true });
                const query = [`RETURN = ${result};`];
                for (let i = 0; i < 2; i++) {
                    assert.deepStrictEqual(
                        await client.query([periods[0]], query, { cacheEmpty }),
                        [result],
                    );
                }
                assert.deepStrictEqual(requests, [[periods[0]]]);
            });
        }

        for (const result of [[], {}]) {
            it(`preserves empty ${JSON.stringify(result)} policy with cacheEmpty=${cacheEmpty}`, async () => {
                respondWith(result);
                const client = new AWClient("cache-test", { testing: true });
                const query = ["RETURN = empty;"];
                for (let i = 0; i < 2; i++) {
                    assert.deepStrictEqual(
                        await client.query([periods[0]], query, { cacheEmpty }),
                        [result],
                    );
                }
                assert.strictEqual(requests.length, cacheEmpty ? 1 : 2);
            });
        }
    }

    for (const result of [[1], { count: 1 }]) {
        it(`reuses nonempty ${JSON.stringify(result)} by default`, async () => {
            respondWith(result);
            const client = new AWClient("cache-test", { testing: true });
            for (let i = 0; i < 2; i++) {
                assert.deepStrictEqual(
                    await client.query([periods[0]], ["RETURN = nonempty;"]),
                    [result],
                );
            }
            assert.strictEqual(requests.length, 1);
        });
    }

    it("preserves caller order when mixing cached zero and uncached periods", async () => {
        const results = [0, 3, 7];
        global.fetch = (async (_url, options) => {
            const body = JSON.parse(options?.body as string);
            requests.push(body.timeperiods);
            return new Response(
                JSON.stringify(
                    body.timeperiods.map(
                        (period: string) => results[periods.indexOf(period)],
                    ),
                ),
                { headers: { "Content-Type": "application/json" } },
            );
        }) as typeof fetch;
        const client = new AWClient("cache-test", { testing: true });
        const query = ["RETURN = count;"];
        assert.deepStrictEqual(await client.query([periods[0]], query), [0]);
        assert.deepStrictEqual(
            await client.query([periods[2], periods[0], periods[1]], query),
            [7, 0, 3],
        );
        assert.deepStrictEqual(
            await client.query([periods[1], periods[2], periods[0]], query),
            [3, 7, 0],
        );
        assert.deepStrictEqual(requests, [
            [periods[0]],
            [periods[2], periods[1]],
        ]);
    });

    it("does not reuse numeric results for a period spanning the future", async () => {
        respondWith(0);
        const client = new AWClient("cache-test", { testing: true });
        const futurePeriod = `${new Date(0).toISOString()}/${new Date(Date.now() + 86400000).toISOString()}`;
        const query = ["RETURN = 0;"];
        assert.deepStrictEqual(await client.query([futurePeriod], query), [0]);
        respondWith(1);
        assert.deepStrictEqual(await client.query([futurePeriod], query), [1]);
        assert.strictEqual(requests.length, 2);
    });
});
