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
            const otherSocket: Socket | undefined = this.oppositeSocket(socket);
            if (!otherSocket) return;
            otherSocket.emit("deviceData", blob);
        }
    };

    constructor(private sessionId: string) {}


    handleStatusMessage(socket: Socket, statusMessage: StatusMessage): void {
        console.log("Received status: " + LinkStatus[statusMessage.statusType]);

        const otherSocket: Socket | undefined = this.oppositeSocket(socket);
        if (!otherSocket) return;

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
                if (this.clientStatus.get(otherSocket) === LinkStatus.HandshakeReceived) {
                    socket.emit("deviceCommand", CommandType.StartHandshake)
                    otherSocket.emit("deviceCommand", CommandType.StartHandshake);
                }
                break

            case LinkStatus.HandshakeFinished:
                this.clientStatus.set(socket, LinkStatus.HandshakeFinished);
                break

            case LinkStatus.LinkConnected:
                this.clientStatus.set(socket, LinkStatus.LinkConnected);
                otherSocket.emit("deviceCommand", CommandType.ConnectLink)
                break;

            case LinkStatus.LinkReconnecting:
                this.clientStatus.set(socket, LinkStatus.LinkReconnecting);
                break;
        }

    }

    id(): String {
        return this.sessionId;
    }

    isFull(): boolean {
        return this.sockets.length >= 2;
    }

    enter(socket: Socket) : boolean{
        if (this.isFull()) return false;
        this.sockets.push(socket);
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            socket.on(event, (data) => handler(socket, data));
        });

        return true;
    }

    leave(socket: Socket) {
        const index = this.sockets.findIndex(socket => socket === socket);
        if (index < 0) return;
        Object.entries(this.socketEventHandlers).forEach(([event, handler]) => {
            socket.off(event, handler);
        });
        this.sockets.splice(index, 1);
    }

    oppositeSocket(socket: Socket): Socket | undefined {
        if (this.sockets.length < 2) return undefined;
        if (socket.id === this.sockets[0].id) {
            return this.sockets[1]
        }
        return this.sockets[0]

    }
}