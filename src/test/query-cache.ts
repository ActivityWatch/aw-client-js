import * as assert from "assert";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { AWClient } from "../aw-client";

const periods = [
    "2020-01-01T00:00:00.000Z/2020-01-02T00:00:00.000Z",
    "2020-01-02T00:00:00.000Z/2020-01-03T00:00:00.000Z",
    "2020-01-03T00:00:00.000Z/2020-01-04T00:00:00.000Z",
];
const query = ['RETURN = query_bucket("test");'];

interface QueryRequest {
    timeperiods: string[];
    query: string[];
}

describe("Query cache requests", () => {
    let server: Server;
    let client: AWClient;
    let requests: QueryRequest[];

    beforeEach(async () => {
        requests = [];
        server = createServer((req, res) => {
            if (req.method !== "POST" || req.url !== "/api/0/query/") {
                res.writeHead(404).end();
                return;
            }
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
                const request: QueryRequest = JSON.parse(body);
                requests.push(request);
                res.setHeader("Content-Type", "application/json");
                res.end(
                    JSON.stringify(
                        request.timeperiods.map((period) => ({
                            period,
                            revision: requests.length,
                        })),
                    ),
                );
            });
        });
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = server.address() as AddressInfo;
        client = new AWClient("query-cache-test", {
            baseURL: `http://127.0.0.1:${port}`,
        });
    });

    afterEach(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
        });
    });

    it("fetches every period and fresh results on repeated uncached calls", async () => {
        const timeperiods = [
            periods[0],
            {
                start: new Date("2020-01-02T00:00:00Z"),
                end: new Date("2020-01-03T00:00:00Z"),
            },
        ];
        for (const revision of [1, 2]) {
            const result = await client.query(timeperiods, query, {
                cache: false,
            });
            assert.deepStrictEqual(
                result,
                periods.slice(0, 2).map((period) => ({ period, revision })),
            );
        }
        assert.deepStrictEqual(requests, [
            { timeperiods: periods.slice(0, 2), query },
            { timeperiods: periods.slice(0, 2), query },
        ]);
    });

    it("bypasses populated cache without overwriting or populating it", async () => {
        const cached = await client.query([periods[0]], query);
        const fresh = await client.query(periods.slice(0, 2), query, {
            cache: false,
        });
        assert.deepStrictEqual(fresh, [
            { period: periods[0], revision: 2 },
            { period: periods[1], revision: 2 },
        ]);
        assert.deepStrictEqual(await client.query([periods[0]], query), cached);
        assert.strictEqual(requests.length, 2);
        assert.deepStrictEqual(await client.query([periods[1]], query), [
            { period: periods[1], revision: 3 },
        ]);
        assert.deepStrictEqual(requests[2], {
            timeperiods: [periods[1]],
            query,
        });
    });

    it("keeps enabled cache hits in order while requesting only missing periods", async () => {
        await client.query([periods[0]], query);
        const requested = [periods[1], periods[0], periods[2]];
        assert.deepStrictEqual(await client.query(requested, query), [
            { period: periods[1], revision: 2 },
            { period: periods[0], revision: 1 },
            { period: periods[2], revision: 2 },
        ]);
        assert.deepStrictEqual(requests, [
            { timeperiods: [periods[0]], query },
            { timeperiods: [periods[1], periods[2]], query },
        ]);
        await client.query(requested, query);
        assert.strictEqual(requests.length, 2);
    });

    it("returns no results without a request for empty periods in either mode", async () => {
        assert.deepStrictEqual(
            await client.query([], query, { cache: false }),
            [],
        );
        assert.deepStrictEqual(await client.query([], query), []);
        assert.deepStrictEqual(requests, []);
    });
});
