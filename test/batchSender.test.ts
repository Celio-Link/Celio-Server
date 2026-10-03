import {beforeEach, describe, expect, test} from "vitest";
import {BatchSender} from "../src/batchSender.js";

describe("BatchSender", () => {

    let sent: number[][];
    let pendingAcks: (() => void)[];
    let sender: BatchSender<number>;

    beforeEach(() => {
        sent = [];
        pendingAcks = [];
        // Records each batch and resolves it only when the test acks it
        sender = new BatchSender<number>(batch => {
            sent.push(batch);
            return new Promise<void>(resolve => pendingAcks.push(resolve));
        });
    });

    // Lets the promise callbacks of the sender run
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    async function ack() {
        pendingAcks.shift()!();
        await settle();
    }

    test("sends a single item immediately", () => {
        sender.push([1]);
        expect(sent).toEqual([[1]]);
    });

    test("waits for the ack, then sends everything queued in between", async () => {
        sender.push([1]);
        [2, 3, 4, 5, 6].forEach(i => sender.push([i]));
        await settle();
        expect(sent).toEqual([[1]]);
        await ack();
        expect(sent).toEqual([[1], [2, 3, 4, 5, 6]]);
    });

    test("sends items pushed together as one batch", () => {
        sender.push([1, 2, 3, 4]);
        expect(sent).toEqual([[1, 2, 3, 4]]);
    });

    test("sends nothing after the ack if nothing was queued", async () => {
        sender.push([1]);
        await ack();
        expect(sent).toEqual([[1]]);
        sender.push([2]);
        expect(sent).toEqual([[1], [2]]);
    });

    test("splits batches larger than the maximum", async () => {
        const limited = new BatchSender<number>(batch => {
            sent.push(batch);
            return new Promise<void>(resolve => pendingAcks.push(resolve));
        }, 2);
        [1, 2, 3, 4, 5].forEach(i => limited.push([i]));
        await ack();
        await ack();
        expect(sent).toEqual([[1], [2, 3], [4, 5]]);
    });

    test("continues after a failed batch", async () => {
        const failing = new BatchSender<number>(batch => {
            sent.push(batch);
            return Promise.reject(new Error("failed"));
        });
        failing.push([1]);
        failing.push([2]);
        await settle();
        expect(sent).toEqual([[1], [2]]);
    });

    test("drops queued items and stops sending when closed", async () => {
        sender.push([1]);
        sender.push([2]);
        sender.close();
        sender.push([3]);
        await ack();
        expect(sent).toEqual([[1]]);
    });
});
