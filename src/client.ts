// @ts-ignore
import WebSocket from "ws";
import {CommandMessage, CommandType, StatusMessage, LinkStatus} from "./messages/gameboy";
import {ControlMessage, ErrorMessage, ErrorType} from "./messages/session";

export type ClientHandler = (client: Client, data: WebSocket.RawData, isBinary: boolean) => void;

export class Client {

    private handler?: ClientHandler;

    constructor(public ws: WebSocket, public id: string, public inSession: boolean = false) {
        ws.on("message", this.handleIncomingMessage.bind(this));
    }

    setHandler(handler: ClientHandler) {
        this.handler = handler;
    }

    sendError(errorType: ErrorType) {
        const msg: ErrorMessage = {
            type: 'error',
            errorType,
        };
        this.ws.send(JSON.stringify(msg));
    }

    sendBinary(data: WebSocket.RawData) {
        this.ws.send(data)
    }

    sendCommand(commandType: CommandType) {
        const msg: CommandMessage = {
            type: 'command',
            commandType: commandType,
        };
        this.ws.send(JSON.stringify(msg));
    }

    sendControlMessage(controlMessage: ControlMessage) {
        this.ws.send(JSON.stringify(controlMessage));
    }

    private handleIncomingMessage(data: WebSocket.RawData, isBinary: boolean): void {
        if (this.handler)
        {
            this.handler(this, data, isBinary);
        }
    }
}
