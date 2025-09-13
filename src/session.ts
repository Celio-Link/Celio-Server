import { Socket } from "socket.io";
// @ts-ignore
import {CommandType, LinkStatus, StatusMessage} from "./messages/gameboy";

export class Session {

    private clientStatus: Map<Socket, LinkStatus> = new Map();
    private masterSelected: boolean = false;

    private sockets: Socket[] = [];

    private socketEventHandlers = {

        deviceStatus: (socket: Socket, statusMessage: StatusMessage) => {
            this.handleStatusMessage(socket, statusMessage);
        },

        deviceData: (socket: Socket, blob: Blob) => {
            socket.to(this.sessionId).emit("deviceData", blob);
        }
    };

    constructor(private sessionId: string) {}


    handleStatusMessage(socket: Socket, statusMessage: StatusMessage): void {
        console.log("Received status: " + LinkStatus[statusMessage.statusType]);

        const partnerSocket: Socket | undefined = this.oppositeSocket(socket);
        if (!partnerSocket) return;

        switch (statusMessage.statusType) {
            case LinkStatus.HandshakeWaiting:
                if (!this.masterSelected) {
                    socket.emit("deviceCommand", CommandType.SetModeMaster)
                    this.masterSelected = true;
                }
                else {
                    socket.emit("deviceCommand", CommandType.SetModeSlave)
                }
                break

            case LinkStatus.HandshakeReceived:
                this.clientStatus.set(socket, LinkStatus.HandshakeReceived);
                if (this.clientStatus.get(partnerSocket) === LinkStatus.HandshakeReceived) {
                    socket.emit("deviceCommand", CommandType.StartHandshake)
                    partnerSocket.emit("deviceCommand", CommandType.StartHandshake);
                }
                break

            case LinkStatus.HandshakeFinished:
                this.clientStatus.set(socket, LinkStatus.HandshakeFinished);
                break

            case LinkStatus.LinkConnected:
                this.clientStatus.set(socket, LinkStatus.LinkConnected);
                partnerSocket.emit("deviceCommand", CommandType.ConnectLink)
                break;

            case LinkStatus.LinkReconnecting:
                this.clientStatus.set(socket, LinkStatus.LinkReconnecting);
                break;
        }

    }

    id(): string {
        return this.sessionId;
    }

    isFull(): boolean {
        return this.sockets.length >= 2;
    }

    isEmpty(): boolean {
        return this.sockets.length === 0;
    }

    enter(socket: Socket) : boolean{
        if (this.isFull()) return false;
        this.sockets.push(socket);
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            socket.on(event, (data) => handler(socket, data));
        });
        socket.join(this.sessionId);
        socket.to(this.sessionId).emit("partnerJoined")
        return true;
    }

    leave(socket: Socket) {
        const index = this.sockets.findIndex(socket => socket === socket);
        if (index < 0) return;
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            socket.off(event, handler);
        });
        socket.to(this.sessionId).emit("partnerLeft")
        socket.leave(this.sessionId)
        this.sockets.splice(index, 1);
    }

    oppositeSocket(socket: Socket): Socket | undefined {
        if (this.sockets.length != 2) return undefined;
        if (socket.id === this.sockets[0].id) {
            return this.sockets[1]
        }
        return this.sockets[0]

    }
}