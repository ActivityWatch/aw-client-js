import type { AWClient, IEvent } from "./aw-client";

interface HeartbeatBufferOptions {
    /** Maximum buffering time, in seconds. Defaults to 10. */
    commitInterval?: number;
    /** Receives background send failures. Defaults to console.error. */
    onError?: (error: unknown) => void;
}

/** Opt-in pre-merging for one bucket; AWClient.heartbeat remains immediate. */
export class HeartbeatBuffer {
    private pending?: IEvent;
    private timer?: ReturnType<typeof setTimeout>;
    private inFlight = new Set<Promise<void>>();
    private commitInterval: number;
    private onError: (error: unknown) => void;

    constructor(
        private client: AWClient,
        private bucketId: string,
        private pulsetime: number,
        options: HeartbeatBufferOptions = {},
    ) {
        this.commitInterval = options.commitInterval ?? 10;
        if (!Number.isFinite(this.commitInterval) || this.commitInterval <= 0) {
            throw new Error(
                "commitInterval must be a positive number of seconds",
            );
        }
        this.onError = options.onError ?? console.error;
    }

    /** Buffer a snapshot of a sample, merging equal data within pulsetime. */
    public heartbeat(event: IEvent): void {
        const sample = {
            ...event,
            timestamp: new Date(event.timestamp),
            duration: event.duration ?? 0,
            data: { ...event.data },
        };
        if (this.pending) {
            const previous = this.pending;
            const gap =
                (sample.timestamp.getTime() - previous.timestamp.getTime()) /
                1000;
            const duration = previous.duration ?? 0;
            const keys = Object.keys(previous.data);
            const sameData =
                keys.length === Object.keys(sample.data).length &&
                keys.every((key) => previous.data[key] === sample.data[key]);
            if (
                sameData &&
                duration >= 0 &&
                gap >= 0 &&
                gap <= duration + this.pulsetime
            ) {
                previous.duration = Math.max(duration, gap + sample.duration);
                return;
            }
            this.sendPending();
        }
        this.pending = sample;
        // Start once per batch, so frequent samples cannot postpone delivery.
        this.timer = setTimeout(
            () => this.sendPending(),
            this.commitInterval * 1000,
        );
    }

    /** Send pending data and wait for all currently outstanding sends. */
    public async flush(): Promise<void> {
        this.sendPending();
        await Promise.all(this.inFlight);
    }

    private sendPending(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.pending) return;
        const event = this.pending;
        this.pending = undefined;
        // AWClient's existing per-bucket queue preserves transport order.
        const request = this.client.heartbeat(
            this.bucketId,
            this.pulsetime,
            event,
        );
        this.inFlight.add(request);
        request.then(
            () => this.inFlight.delete(request),
            (error) => {
                this.inFlight.delete(request);
                this.onError(error);
            },
        );
    }
}
