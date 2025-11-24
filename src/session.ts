import {CommandType, LinkStatus} from "./messages/gameboy.js";
import {Client} from "./client.js";
import {concatMap, Subject, Subscription} from "rxjs";

type UInt16 = number & { __uint16: true };
type DataArray = [UInt16, UInt16, UInt16, UInt16, UInt16, UInt16, UInt16, UInt16];

interface DataPacket {
    sequence: number;
    data: DataArray;
}

interface CommandPacket {
    uuid: string;
    command: CommandType;
}

interface StatusPacket {
    uuid: string;
    linkStatus: LinkStatus;
}

interface OutgoingAckablePacket {
    client: Client;
    event: string;
    args: [...any[]];
}

export class Session {

    private clientStatus: Map<Client, LinkStatus> = new Map();
    private masterSelected: boolean = false;

    private receivedStati: Set<string> = new Set();
    private receivedDataPackets: Map<Client, Map<number, DataPacket>> = new Map();
    private clients: Client[] = [];

    private subs: Subscription = new Subscription()

    private send$: Subject<OutgoingAckablePacket> = new Subject<OutgoingAckablePacket>();

    private socketEventHandlers = {

        deviceStatus: (client: Client, statusPacket: StatusPacket) => {
            if (this.receivedStati.has(statusPacket.uuid)) return;
            this.receivedStati.add(statusPacket.uuid);
            this.handleStatusMessage(client, statusPacket);
        },

        deviceData: (client: Client, dataPacket: DataPacket) => {
            let receivedPacketMap = this.receivedDataPackets.get(client)
            if (!receivedPacketMap) {
                console.log("Received data packet for unknown client");
                return;
            }
            receivedPacketMap.set(dataPacket.sequence, dataPacket);
            this.queueAckablePacket(client, "deviceData", dataPacket);
        },

        requestData: (client: Client, missingSequenceNumbers: [number]) => {
            let receivedPacketMap = this.receivedDataPackets.get(client)
            if (!receivedPacketMap) {
                console.log("Received data packet for unknown client");
                return;
            }
            missingSequenceNumbers.forEach(seqNum => {
                let packet = receivedPacketMap.get(seqNum)
                if (packet) client.emit("deviceData", packet)
                else console.log("Requested data packet " + seqNum + " not found")
            })
        }
    };

    constructor(private sessionId: string) {
        this.send$.pipe(
            concatMap((packet: OutgoingAckablePacket) =>
                packet.client.emitWithRetry(packet.event, packet.args)
                    .catch(err => {
                        console.error("Ack failed after retries:", err);
                        return Promise.resolve();
                    })
            )
        ).subscribe();
    }

    handleStatusMessage(client: Client, statusPacket: StatusPacket): void {
        console.log("Received status: " + LinkStatus[statusPacket.linkStatus]);

        switch (statusPacket.linkStatus) {
            case LinkStatus.HandshakeWaiting:
                if (!this.masterSelected) {
                    this.emitToOppositeSocket(client, "deviceCommand", CommandType.SetModeMaster)
                    this.masterSelected = true;
                }
                else {
                    this.emitToOppositeSocket(client,"deviceCommand", CommandType.SetModeSlave)
                }
                break

            case LinkStatus.HandshakeReceived:
                this.clientStatus.set(client, LinkStatus.HandshakeReceived);
                if (this.clientStatus.get(client) === LinkStatus.HandshakeReceived) {
                    client.emit("deviceCommand", CommandType.StartHandshake)
                    this.emitToOppositeSocket(client,"deviceCommand", CommandType.StartHandshake);
                }
                break

            case LinkStatus.HandshakeFinished:
                this.clientStatus.set(client, LinkStatus.HandshakeFinished);
                break

            case LinkStatus.LinkConnected:
                this.clientStatus.set(client, LinkStatus.LinkConnected);
                this.emitToOppositeSocket(client, "deviceCommand", CommandType.ConnectLink)
                break;

            case LinkStatus.LinkReconnecting:
                this.clientStatus.set(client, LinkStatus.LinkReconnecting);
                break;
        }
    }

    id(): string {
        return this.sessionId;
    }

    isFull(): boolean {
        return this.clients.length >= 2;
    }

    isEmpty(): boolean {
        return this.clients.length === 0;
    }

    enter(client: Client) : boolean{
        if (this.isFull()) return false;
        this.clients.push(client);
        this.clientStatus.set(client, LinkStatus.Empty);
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            this.subs.add(client.fromEvent<any>(event).subscribe((data: any) => handler(client, data)));
        });
        this.emitToOppositeSocket(client, "partnerJoined");
        this.receivedDataPackets.set(client, new Map());
        return true;
    }

    leave(client: Client) {
        const index = this.clients.findIndex(socket => socket === socket);
        if (index < 0) return;
        this.emitToOppositeSocket(client, "partnerLeft");
        this.subs.unsubscribe();
        this.clients.splice(index, 1);
    }

    emitToOppositeSocket(client: Client, event: string, ...args: any[]) {
        if (this.clients.length != 2) return;
        if (client.id() === this.clients[0].id()) {
            this.clients[1].emit(event, args);
        }
        this.clients[0].emit(event, args);
    }

    emitAckedToOppositeSocket(client: Client, event: string, ...args: any[]) {
        if (this.clients.length != 2) return;
        let receiverClient = this.clients[0] === client ? this.clients[1] : this.clients[0];
        this.queueAckablePacket(receiverClient, event, args);
    }

    queueAckablePacket(client: Client, event: string, ...args: any[]) {
        this.send$.next({client: client, event: event, args: args});
    }
}