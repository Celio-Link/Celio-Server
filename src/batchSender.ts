/**
 * Sends queued items in batches with only one batch in flight. Items queued while a batch is in flight are
 * sent together as the next batch once the previous one is done.
 */
export class BatchSender<T> {

    private queue: T[] = [];
    private inFlight: boolean = false;
    private closed: boolean = false;

    /**
     * @param send - Sends a batch. The next batch is sent once the returned promise settles.
     * @param maxBatchSize - Upper limit of items per batch, the rest is sent with the next batch.
     */
    constructor(private send: (batch: T[]) => Promise<unknown>,
                private maxBatchSize: number = 1024) {}

    /**
     * Queue items. Items pushed together are sent in the same batch if nothing is in flight.
     */
    push(items: T[]) {
        if (this.closed) return;
        this.queue.push(...items);
        this.trySend();
    }

    /**
     * Stop sending and drop all queued items.
     */
    close() {
        this.closed = true;
        this.queue = [];
    }

    private trySend() {
        if (this.closed || this.inFlight || this.queue.length === 0) return;

        const batch = this.queue.splice(0, this.maxBatchSize);
        this.inFlight = true;
        this.send(batch)
            .catch(() => {})
            .finally(() => {
                this.inFlight = false;
                this.trySend();
            });
    }
}
