import * as assert from "assert";
import { AWClient } from "../aw-client";

describe("Query period finalization", () => {
    const RealDate = Date;
    const originalFetch = globalThis.fetch;
    const past = "2026-09-30T00:00:00Z/2026-10-01T00:00:00Z";
    const current = "2026-10-01T00:00:00Z/2026-10-02T00:00:00Z";
    const future = "2026-10-02T00:00:00Z/2026-10-03T00:00:00Z";
    const query = ["RETURN = query_bucket('synthetic');"];
    let now: number;
    let calls: string[][];
    let results: Record<string, object[]>;
    let afterRequest: (() => void) | undefined;
    let client: AWClient;

    beforeEach(() => {
        now = new RealDate("2026-10-01T12:00:00Z").getTime();
        globalThis.Date = class extends RealDate {
            constructor(value?: string | number) {
                super(value ?? now);
            }
        } as DateConstructor;
        calls = [];
        results = {
            [past]: [{ label: "past" }],
            [current]: [{ label: "partial" }],
            [future]: [{ label: "future" }],
        };
        afterRequest = undefined;
        globalThis.fetch = async (_input, init) => {
            const body = JSON.parse(init?.body as string);
            calls.push(body.timeperiods);
            const response = body.timeperiods.map((tp: string) => results[tp]);
            afterRequest?.();
            return new Response(JSON.stringify(response));
        };
        client = new AWClient("period-finalization-test");
    });

    afterEach(() => {
        globalThis.Date = RealDate;
        globalThis.fetch = originalFetch;
    });

    it("refetches at the exact period end, then reuses the finalized result", async () => {
        assert.deepStrictEqual(await client.query([current], query), [
            results[current],
        ]);
        results[current] = [{ label: "partial" }, { label: "later event" }];
        assert.deepStrictEqual(await client.query([current], query), [
            results[current],
        ]);
        assert.strictEqual(
            calls.length,
            2,
            "in-progress periods always refresh",
        );

        now = new RealDate("2026-10-02T00:00:00Z").getTime();
        results[current] = [...results[current], { label: "final event" }];
        const completed = results[current];
        assert.deepStrictEqual(await client.query([current], query), [
            completed,
        ]);
        assert.strictEqual(
            calls.length,
            3,
            "first completed query must refresh",
        );
        assert.deepStrictEqual(await client.query([current], query), [
            completed,
        ]);
        assert.strictEqual(
            calls.length,
            3,
            "completed result must remain cached",
        );
    });

    it("keeps fresh and cached periods in caller order", async () => {
        await client.query([past, current], query);
        results[current] = [{ label: "completed" }];
        now = new RealDate("2026-10-02T00:00:00Z").getTime();
        const periods = [future, past, current];
        const expected = periods.map((tp) => results[tp]);
        assert.deepStrictEqual(await client.query(periods, query), expected);
        assert.deepStrictEqual(calls[1], [future, current]);
        assert.deepStrictEqual(await client.query(periods, query), expected);
        assert.deepStrictEqual(calls[2], [future]);
    });

    it("does not finalize a request that started before the period end", async () => {
        afterRequest = () => {
            now = new RealDate("2026-10-02T00:00:01Z").getTime();
        };
        const partial = results[current];
        assert.deepStrictEqual(await client.query([current], query), [partial]);
        results[current] = [{ label: "completed after request" }];
        assert.deepStrictEqual(await client.query([current], query), [
            results[current],
        ]);
        assert.strictEqual(calls.length, 2);
        await client.query([current], query);
        assert.strictEqual(calls.length, 2);
    });

    for (const cacheEmpty of [false, true]) {
        it(`preserves empty-result policy after finalization (cacheEmpty=${cacheEmpty})`, async () => {
            results[current] = [];
            const options = { cacheEmpty };
            assert.deepStrictEqual(
                await client.query([current], query, options),
                [[]],
            );
            now = new RealDate("2026-10-02T00:00:00Z").getTime();
            assert.deepStrictEqual(
                await client.query([current], query, options),
                [[]],
            );
            assert.strictEqual(
                calls.length,
                2,
                "even partial empty results need a final fetch",
            );
            assert.deepStrictEqual(
                await client.query([current], query, options),
                [[]],
            );
            assert.strictEqual(calls.length, cacheEmpty ? 2 : 3);
        });
    }
});
