import {Client} from "./client";
// @ts-ignore
import WebSocket from "ws";
import {CommandType, LinkStatus, StatusMessage} from "./messages/gameboy";

export class Session {

    private clientStatus: Map<Client, LinkStatus> = new Map();
    private masterSelected: boolean = false;

    constructor(public clients: [Client, Client]) {
        this.clientStatus.set(clients[0], LinkStatus.Empty)
        this.clientStatus.set(clients[1], LinkStatus.Empty)

        this.clients[0].setHandler(this.handleIncomingMessage.bind(this))
        this.clients[1].setHandler(this.handleIncomingMessage.bind(this))
    }

    handleIncomingMessage(client: Client, data: WebSocket.RawData, isBinary: boolean): void {
        let otherClient: Client = this.oppositeClient(client)

        if (isBinary) {
            //otherClient.sendBinary(data)
            //console.log("Binary received")
            setTimeout(() => { otherClient.sendBinary(data) }, 400)
            return
        }

        const message: any = JSON.parse(data.toString());
        const statusMessage: StatusMessage = message.message as StatusMessage;

        console.log("Received status: " + LinkStatus[statusMessage.statusType]);

        switch (statusMessage.statusType) {
            case LinkStatus.HandshakeWaiting:
                if (!this.masterSelected) {
                    client.sendCommand(CommandType.SetModeMaster)
                    this.masterSelected = true;
                }
                else {
                    client.sendCommand(CommandType.SetModeSlave)
                }
                break

            case LinkStatus.HandshakeReceived:
                this.clientStatus.set(client, LinkStatus.HandshakeReceived);
                if (this.clientStatus.get(otherClient) === LinkStatus.HandshakeReceived) {
                    client.sendCommand(CommandType.StartHandshake)
                    otherClient.sendCommand(CommandType.StartHandshake);
                }
                break

            case LinkStatus.HandshakeFinished:
                this.clientStatus.set(client, LinkStatus.HandshakeFinished);
                break

            case LinkStatus.LinkConnected:
                otherClient.sendCommand(CommandType.ConnectLink)
                break;

            case LinkStatus.LinkReconnecting:
                this.clientStatus.set(client, LinkStatus.LinkReconnecting);
                break;
        }

    }

    oppositeClient(client: Client): Client {
        if (client.id === this.clients[0].id) {
            return this.clients[1]
        }
        return this.clients[0]
    }
}