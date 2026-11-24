import * as assert from "assert";
import { AWClient } from "../aw-client";

describe("Bucket last_updated", () => {
    const originalFetch = globalThis.fetch;
    const raw = (last_updated: string | null) => ({
        id: "b1",
        name: "b1",
        type: "test",
        client: "test",
        hostname: "host",
        created: "2026-01-01T00:00:00.000Z",
        // Both aw-server (when the bucket has events) and aw-server-rust
        // (always null) name this field last_updated.
        last_updated,
        data: {},
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("parses the last_updated sent by aw-server", async () => {
        const ts = "2026-01-02T03:04:05.000Z";
        globalThis.fetch = async () => new Response(JSON.stringify(raw(ts)));
        const bucket = await new AWClient("test").getBucketInfo("b1");
        assert.ok(bucket.last_updated instanceof Date);
        assert.strictEqual(bucket.last_updated?.toISOString(), ts);
        assert.strictEqual(bucket.last_update?.toISOString(), ts);
    });

    it("maps a null last_updated to undefined", async () => {
        globalThis.fetch = async () =>
            new Response(JSON.stringify({ b1: raw(null) }));
        const buckets = await new AWClient("test").getBuckets();
        assert.strictEqual(buckets.b1.last_updated, undefined);
        assert.strictEqual(buckets.b1.last_update, undefined);
    });
});
