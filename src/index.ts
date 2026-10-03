// @ts-ignore
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { SessionManager } from "./sessionManager.js";
import {Client} from "./client.js";
import {isClientId} from "./messages/validation.js";

const httpServer = createServer();
const port = 443;

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
    const clientId: unknown = socket.handshake.auth?.clientId;
    if (!isClientId(clientId)) {
        console.warn("Rejected connection with invalid clientId");
        socket.disconnect(true);
        return;
    }
    console.log("auth received:", clientId);
    if (clients.has(clientId)) clients.get(clientId)!.reconnect(socket);
    else clients.set(clientId, new Client(clientId, socket, sessionManager, removeClient));
})

httpServer.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});
