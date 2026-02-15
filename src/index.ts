// @ts-ignore
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { SessionManager } from "./sessionManager.js";
import {Client} from "./client.js";

const httpServer = createServer();

const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"], // 🚀 only WebSocket
    pingInterval: 500,
    pingTimeout: 2000
});

const sessionManager: SessionManager = new SessionManager();
let clients: Map<string, Client> = new Map();


function removeClient(clientId: string) {
    clients.delete(clientId);
}

io.on("connection", (socket: Socket) => {
    let clientId: string = socket.handshake.auth.clientId;
    console.log("auth received:", clientId);
    if (clients.has(clientId)) clients.get(clientId)!.reconnect(socket);
    else clients.set(clientId, new Client(clientId, socket, sessionManager, removeClient));
})

httpServer.listen(8080, () => {
    console.log(`Server listening on http://localhost:${8080}`);
});
