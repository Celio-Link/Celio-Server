import {CommandArgs, CommandPacket, CommandType, LinkStatus, SendableCommand} from "./messages/gameboy.js";
import {Client, ClientDisconnectedError} from "./client.js";
import {concatMap, Observable, Subject, Subscription} from "rxjs";
import {v4 as uuidv4} from 'uuid';
import {AckFn, isDataPacketBatch, isStatusPacket} from "./messages/validation.js";
import {PipelinedSender} from "./pipelinedSender.js";

export type UInt8 = number & { __uint8: true };
export type DataArray = [
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8, UInt8,
    UInt8, UInt8, UInt8
];

export const DATA_ARRAY_LENGTH = 51;

interface DataPacket {
    sequence: number;
    data: DataArray;
}

interface StatusPacket {
    uuid: string;
    linkStatus: LinkStatus;
}

class ClientState {
    public status: LinkStatus = LinkStatus.Empty;
    public subscription: Subscription = new Subscription();
    // Sequence numbers of data packets received from this client, to drop duplicates from retries
    public receivedSequences: Set<number> = new Set();
    // Commands to this client, sent one by one in order and retried until acked
    public commands$: Subject<CommandPacket> = new Subject<CommandPacket>();
    // Data packets to this client, one emit per item. Each receiver has its own sender, so a slow client only delays itself.
    constructor(public dataSender: PipelinedSender<DataPacket[]>) {}
}

export class Session {

    private clientState: Map<Client, ClientState> = new Map();

    private awaitModeCount: number = 0;

    private receivedStati: Set<string> = new Set();

    private clients: Client[] = [];

    private started: boolean = false;

    private closeSubject: Subject<Session> = new Subject();

    /**
     * Observable that emits when one of the following events occurs:
     * - The Link has successfully ended
     * - The clients are evicted.
     * - The last client leaves the session.
     */
    public close$: Observable<Session> = this.closeSubject.asObservable();

    /**
     * Handlers for client events. Clients that emit with an ack callback retry until they get an answer,
     * so duplicates are acknowledged again but not processed twice. The ack is false for rejected packets.
     */
    private socketEventHandlers: Record<string, (client: Client, payload: unknown, ack?: AckFn) => void> = {

        deviceStatus: (client: Client, statusPacket: unknown, ack?: AckFn) => {
            if (!isStatusPacket(statusPacket)) {
                console.warn("Client " + client.id() + " sent invalid status packet");
                ack?.(false);
                return;
            }
            if (this.receivedStati.has(statusPacket.uuid)) {
                console.warn("Received duplicate status packet");
                ack?.(true);
                return;
            }
            this.receivedStati.add(statusPacket.uuid);
            this.handleStatusMessage(client, statusPacket as StatusPacket);
            ack?.(true);
        },

        deviceData: (client: Client, dataPackets: unknown, ack?: AckFn) => {
            if (!isDataPacketBatch(dataPackets)) {
                console.warn("Client " + client.id() + " sent invalid data packets");
                ack?.(false);
                return;
            }
            let receivedSequences = this.clientState.get(client)?.receivedSequences
            if (!receivedSequences) {
                console.log("Received data packet for unknown client");
                ack?.(false);
                return;
            }
            const newPackets: DataPacket[] = [];
            for (const dataPacket of dataPackets as DataPacket[]) {
                if (receivedSequences.has(dataPacket.sequence)) {
                    console.warn("Client " + client.id() + " sent duplicate data packet " + dataPacket.sequence);
                    continue;
                }
                receivedSequences.add(dataPacket.sequence);
                newPackets.push(dataPacket);
            }
            this.sendDataToOppositeClient(client, newPackets);
            ack?.(true);
        }
    };

    constructor(private sessionId: string, private playerNumber: number) {}

    /**
     * Check if the session has started, meaning the first status packet has been received.
     * @returns {boolean} - true if the session has started, false otherwise.
     */
    hasStarted(): boolean { return this.started; }

    private makeCommand<C extends SendableCommand>(command: C, args: CommandArgs[C]): CommandPacket {
        return {uuid: uuidv4(), command: command, args: args} as CommandPacket;
    }

    private handleStatusMessage(client: Client, statusPacket: StatusPacket): void {
        console.log("Client " + client.id() + " has send status and was received by server. Status: " + LinkStatus[statusPacket.linkStatus]);

        this.started = true;
        let clientState = this.clientState.get(client)!

        switch (statusPacket.linkStatus) {
            case LinkStatus.AwaitMode:
                this.sendCommand(client, CommandType.PlayerSettings, {
                    playerCount: this.playerNumber,
                    playerIndex: this.awaitModeCount
                });
                this.awaitModeCount++;
                break

            case LinkStatus.AwaitModeEmulator:
                this.sendCommand(client, CommandType.SetModeSlave);
                break

            case LinkStatus.HandshakeReceived:
                clientState.status = LinkStatus.HandshakeReceived;

                const allHandshakesReceived = [...this.clientState.values()]
                    .every(state => state.status === LinkStatus.HandshakeReceived);

                if (allHandshakesReceived) {
                    this.sendCommand(client, CommandType.StartHandshake);
                    this.sendCommandToOppositeClient(client, CommandType.StartHandshake);
                }
                break

            case LinkStatus.HandshakeFinished:
                clientState.status = LinkStatus.HandshakeFinished;
                break

            case LinkStatus.LinkConnected:
                clientState.status = LinkStatus.LinkConnected;
                this.sendCommandToOppositeClient(client, CommandType.ConnectLink);
                break;

            case LinkStatus.LinkReconnecting:
                clientState.status = LinkStatus.LinkReconnecting;
                break;

            case LinkStatus.LinkClosed:
                clientState.status = LinkStatus.LinkClosed;
                const allLinksClosed = [...this.clientState.values()]
                    .every(state => state.status === LinkStatus.LinkClosed);

                if (allLinksClosed) {
                    console.log("All links closed. Session will be closed");
                    setTimeout(() => {
                        this.evict();
                    }, 2000);
                }
                break;
        }
    }

    /**
     * Get the ID of the session.
     * @returns {string} - The ID of the session.
     */
    id(): string {
        return this.sessionId;
    }

    /**
     * Check if the session is full.
     * @returns {boolean} - true if the session is full, false otherwise.
     */
    isFull(): boolean {
        return this.clients.length >= this.playerNumber;
    }

    /**
     * Check if the session is empty.
     * @returns {boolean} - true if the session is empty, false otherwise.
     */
    isEmpty(): boolean {
        return this.clients.length === 0;
    }

    /**
     * Add a client to the session. Emits a "partnerJoined" event to the other client.
     * @param client
     */
    enter(client: Client) : boolean {
        if (this.isFull()) {
            console.warn("Session is full");
            return false;
        }
        this.clients.push(client);
        const clientState = new ClientState(new PipelinedSender<DataPacket[]>(dataPackets =>
            client.emitWithRetry<boolean>("deviceData", dataPackets)
                .catch(err => {
                    if (err instanceof ClientDisconnectedError) return;
                    console.error("Ack failed after retries:", err);
                    this.evict();
                })
        ));
        this.clientState.set(client, clientState);
        clientState.subscription.add(() => clientState.dataSender.close());
        clientState.subscription.add(clientState.commands$.pipe(
            concatMap((command: CommandPacket) =>
                client.emitWithRetry<boolean>("deviceCommand", command)
                    .catch(err => {
                        if (err instanceof ClientDisconnectedError) return;
                        console.error("Command ack failed after retries:", err);
                        this.evict();
                    })
            )
        ).subscribe());
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            this.clientState.get(client)?.subscription.add(client.fromEventWithAck(event).subscribe(({data, ack}) => {
                try {
                    handler(client, data, ack);
                } catch (e) {
                    console.error("Session " + this.sessionId + " failed to handle event " + event + ":", e);
                }
            }));
        });
        if (this.isFull()) {
            this.emitToAllSockets("partyReady");
        }
        client.inSession(true)
        return true;
    }

    /**
     * Remove a client from the session. Emits a "partnerLeft" event to the other client.
     * @param client
     */
    leave(client: Client) {
        const index = this.clients.findIndex(clientToRemove => clientToRemove.id() === client.id());
        if (index < 0){
            console.warn("Client " + client.id() + " tried to leave session but was not in one");
            return
        }
        if (this.isFull() && this.hasStarted())
        {
            this.removeClient(client);
            this.evict();
        } else {
            this.emitToOppositeSocket(client, "partyNotReady");
            this.removeClient(client);
        }
    }

    /**
     * Remove a client from the session.
     * @param client
     */
    private removeClient(client: Client) {
        const index = this.clients.findIndex(clientToRemove => clientToRemove.id() === client.id());
        this.clientState.get(client)?.subscription.unsubscribe();
        this.clients.splice(index, 1);
        console.log("Client " + client.id() + " left session");
        client.inSession(false);
        this.clientState.delete(client);
        if (this.isEmpty()) this.closeSubject.next(this);
    }

    /**
     * Remove all clients from the session. Emits a "sessionClose" event to all clients
     */
    private evict() {
        for (let i = this.clients.length - 1; i >= 0; i--) {
            this.clients[i].emitSessionEvent("sessionClose");
            this.removeClient(this.clients[i]);
        }
    }

    /**
     * Send a session event to the opposite client of the given client. Save to call when only one client is in the session.
     * @param client
     * @param event
     */
    private emitToOppositeSocket(client: Client, event: string) {
        if (this.clients.length <= 1) return;
        this.clients.forEach(tempClient => {
            if (tempClient.id() === client.id()) return;
            console.log('Emitting to Client ' + tempClient.id() + ': ' + event);
            tempClient.emitSessionEvent(event);
        });
    }

    /**
     * Send a session event to all clients.
     * @param event
     */
    private emitToAllSockets(event: string) {
        if (this.clients.length <= 1) return;
        this.clients.forEach(tempClient => {
            console.log('Emitting to Client ' + tempClient.id() + ': ' + event);
            tempClient.emitSessionEvent(event);
        });
    }

    /**
     * Queue a command for the given client. Commands with args require them, commands without take none.
     * @param client
     * @param command
     * @param args
     */
    private sendCommand<C extends SendableCommand>(client: Client, command: C,
                                                   ...args: CommandArgs[C] extends undefined ? [] : [CommandArgs[C]]) {
        console.log('Sending command to Client ' + client.id() + ': ' + CommandType[command] + (args.length ? ' ' + JSON.stringify(args[0]) : ''));
        this.clientState.get(client)?.commands$.next(this.makeCommand(command, args[0] as CommandArgs[C]));
    }

    /**
     * Queue a command for the opposite client of the given client.
     * Save to call when only one client is in the session.
     * @param client
     * @param command
     */
    private sendCommandToOppositeClient(client: Client, command: CommandType.StartHandshake | CommandType.ConnectLink) {
        if (this.clients.length <= 1) return;
        this.clients.forEach(tempClient => {
            if (tempClient.id() === client.id()) return;
            this.sendCommand(tempClient, command);
        })
    }

    /**
     * Queue data packets for the opposite client of the given client.
     * Save to call when only one client is in the session.
     * @param client
     * @param dataPackets
     */
    private sendDataToOppositeClient(client: Client, dataPackets: DataPacket[]) {
        if (this.clients.length <= 1 || dataPackets.length === 0) return;
        this.clients.forEach(tempClient => {
            if (tempClient.id() === client.id()) return;
            this.clientState.get(tempClient)?.dataSender.push(dataPackets);
        })
    }
}