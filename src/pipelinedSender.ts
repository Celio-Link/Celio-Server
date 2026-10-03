/**
 * Sends items right away without waiting for earlier sends to finish, with at most `windowSize` sends in flight.
 * Further items wait until a send settles. Retries are up to the send function, so items can arrive out of order.
 */
export class PipelinedSender<T> {

    private queue: T[] = [];
    private inFlight: number = 0;
    private closed: boolean = false;

    /**
     * @param send - Sends an item. The item occupies a slot of the window until the returned promise settles.
     * @param windowSize - Maximum number of sends in flight.
     */
    constructor(private send: (item: T) => Promise<unknown>,
                private windowSize: number = 64) {}

    push(item: T) {
        if (this.closed) return;
        this.queue.push(item);
        this.fill();
    }

    /**
     * Stop sending and drop all queued items.
     */
    close() {
        this.closed = true;
        this.queue = [];
    }

    private fill() {
        while (!this.closed && this.inFlight < this.windowSize && this.queue.length > 0) {
            const item = this.queue.shift()!;
            this.inFlight++;
            this.send(item)
                .catch(() => {})
                .finally(() => {
                    this.inFlight--;
                    this.fill();
                });
        }
    }
}
