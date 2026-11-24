import * as assert from "assert";
import { AWClient } from "../aw-client";

describe("Query period finalization without a UTC offset", () => {
    const RealDate = Date;
    const originalFetch = globalThis.fetch;
    const originalTZ = process.env.TZ;
    const query = ["RETURN = query_bucket('synthetic');"];
    let calls: number;

    beforeEach(() => {
        // East of UTC, a local-time parse of the end puts it in the past early.
        process.env.TZ = "Asia/Tokyo";
        const now = new RealDate("2026-10-01T20:00:00Z").getTime();
        globalThis.Date = class extends RealDate {
            constructor(value?: string | number) {
                super(value ?? now);
            }
        } as DateConstructor;
        calls = 0;
        globalThis.fetch = async (_input, init) => {
            calls++;
            const body = JSON.parse(init?.body as string);
            return new Response(
                JSON.stringify(body.timeperiods.map(() => [{ calls }])),
            );
        };
    });

    afterEach(() => {
        globalThis.Date = RealDate;
        globalThis.fetch = originalFetch;
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    });

    it("treats an offset-less end as UTC, like aw-server", async () => {
        // aw-server parses offset-less timestamps as UTC, so at 20:00Z this
        // period still runs for four hours. Caching it would keep the partial
        // result after the period ends.
        const period = "2026-10-01T00:00:00/2026-10-02T00:00:00";
        const client = new AWClient("period-timezone-test");
        await client.query([period], query);
        const second = await client.query([period], query);
        assert.strictEqual(calls, 2, "in-progress period must not be cached");
        assert.deepStrictEqual(second, [[{ calls: 2 }]]);
    });

    it("still caches an offset-less period that ended in UTC", async () => {
        const period = "2026-09-30T00:00:00/2026-10-01T00:00:00";
        const client = new AWClient("period-timezone-test");
        await client.query([period], query);
        await client.query([period], query);
        assert.strictEqual(calls, 1);
    });
});
