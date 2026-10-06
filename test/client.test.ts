import {describe, expect, test} from "vitest";
import {Client, ClientDisconnectedError} from "../src/client.js";

// Socket whose emits are never acked, the ack callback always reports a timeout
function createUnackedSocket(connected: boolean) {
    return {
        connected,
        on() {},
        timeout() {
            return {
                emit(event: string, data: unknown, ack: (err: Error | null) => void) {
                    setTimeout(() => ack(new Error("operation has timed out")), 0);
                }
            };
        }
    };
}

function createClient(connected: boolean): Client {
    return new Client("client", createUnackedSocket(connected) as any, {} as any, () => {});
}

describe("Client.emitWithRetry", () => {

    test("rejects with max retries reached if the client is still connected", async () => {
        const error = await createClient(true).emitWithRetry("deviceData", [], {retries: 1, backoff: 0}).catch(e => e);
        expect(error).not.toBeInstanceOf(ClientDisconnectedError);
        expect(error.message).toEqual("Max retries reached");
    });

    test("rejects with ClientDisconnectedError if the client is disconnected", async () => {
        const error = await createClient(false).emitWithRetry("deviceData", [], {retries: 1, backoff: 0}).catch(e => e);
        expect(error).toBeInstanceOf(ClientDisconnectedError);
    });
});
