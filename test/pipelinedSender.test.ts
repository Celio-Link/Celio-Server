import {beforeEach, describe, expect, test} from "vitest";
import {PipelinedSender} from "../src/pipelinedSender.js";

describe("PipelinedSender", () => {

    let sent: number[];
    let pendingAcks: Map<number, (acked: boolean) => void>;

    // Records each item and settles it only when the test acks or fails it
    function createSender(windowSize?: number) {
        return new PipelinedSender<number>(item => {
            sent.push(item);
            return new Promise<void>((resolve, reject) =>
                pendingAcks.set(item, acked => acked ? resolve() : reject(new Error("failed"))));
        }, windowSize);
    }

    beforeEach(() => {
        sent = [];
        pendingAcks = new Map();
    });

    // Lets the promise callbacks of the sender run
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    async function ack(item: number, acked = true) {
        pendingAcks.get(item)!(acked);
        pendingAcks.delete(item);
        await settle();
    }

    test("sends every item right away without waiting for acks", () => {
        const sender = createSender();
        [1, 2, 3].forEach(i => sender.push(i));
        expect(sent).toEqual([1, 2, 3]);
    });

    test("queues items while the window is full", async () => {
        const sender = createSender(2);
        [1, 2, 3, 4].forEach(i => sender.push(i));
        expect(sent).toEqual([1, 2]);
        await ack(2);
        expect(sent).toEqual([1, 2, 3]);
        await ack(1);
        expect(sent).toEqual([1, 2, 3, 4]);
    });

    test("frees the slot of a failed item", async () => {
        const sender = createSender(1);
        [1, 2].forEach(i => sender.push(i));
        await ack(1, false);
        expect(sent).toEqual([1, 2]);
    });

    test("drops queued items and stops sending when closed", async () => {
        const sender = createSender(1);
        [1, 2].forEach(i => sender.push(i));
        sender.close();
        sender.push(3);
        await ack(1);
        expect(sent).toEqual([1]);
    });
});
