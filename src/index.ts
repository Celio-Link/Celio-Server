// @ts-ignore
import WebSocket, {WebSocketServer} from 'ws';
import {Client} from "./client";
import {ErrorType, ControlMessage, SessionCreationMessage, JoinMessage} from "./messages/session";
import {Session} from "./session";
import { nanoid } from 'nanoid';


const wss = new WebSocketServer({ port: 8080 });
let idClientsMap = new Map<String, Client>
let sessions: Session[] = []

function handleSessionCreation(client: Client, data: WebSocket.RawData, isBinary: boolean) {
    console.log('Client creation creation');
    if (isBinary) {
        console.log("Send binary without joining")
        return;
    }

    let msg: Partial<ControlMessage>;

    try {
        msg = JSON.parse(data.toString());
    } catch {
        console.log("Couldn't parse Create message");
        return;
    }

    if (msg.type !== 'sessionCreate' || typeof msg.otherId !== 'string') {
        console.log('Create message malformed');
    }

    const message = msg as SessionCreationMessage
    const otherClient = idClientsMap.get(message.otherId)

    if (otherClient === undefined) {
        client.sendError(ErrorType.ClientNotFound)
        return
    }
    if (otherClient.inSession)
    {
        client.sendError(ErrorType.ClientAlreadyInSession)
        return
    }

    const clientJoinedMessage: SessionCreationMessage = { type: 'sessionCreate', otherId: otherClient.id };
    client.sendControlMessage(clientJoinedMessage)

    const otherClientJoinedMessage: SessionCreationMessage = { type: 'sessionCreate', otherId: client.id };
    otherClient.sendControlMessage(otherClientJoinedMessage)

    let session: Session = new Session([client, otherClient]);
    console.log("Session created");
    sessions.push(session)
}


wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

    let client = new Client(ws, nanoid())
    idClientsMap.set(client.id, client)
    client.setHandler(handleSessionCreation)

    setTimeout(() => {
        const message: JoinMessage = { type: 'join', id: client.id };
        client.sendControlMessage(message)
        console.log("Send Id to client")
    }, 1000);

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (err) => {
        console.error('Client error:', err);
    });
});