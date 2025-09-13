// @ts-ignore
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { JoinMessage } from "./messages/session.js";
import { SessionManager } from "./sessionManager.js";


const httpServer = createServer();
const sessionManager: SessionManager = new SessionManager();
const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"], // 🚀 only WebSocket
});

io.on("connection", (socket: Socket) => {
    console.log(socket.id + ` Client connected`);
    socket.removeAllListeners("sessionCreate");
    socket.on("sessionCreate", (msg: JoinMessage, responseHandler) => {
        const sessionId = sessionManager.createSession(socket);
        console.log(socket.id + ` Client created session with id ` + sessionId);
        responseHandler(sessionId);
    });

    socket.on("sessionJoin", (msg: JoinMessage, responseHandler) => {
        console.log(socket.id + ` Client wants to join session ` + msg.id);
        const sessionId = sessionManager.enterSession(socket, msg.id)

        return responseHandler(sessionId);
    });

    socket.on("sessionLeft", (msg: JoinMessage, responseHandler) => {
        sessionManager.leaveSession(socket);
        console.log(socket.id + ` Client left session`);
    });

    socket.on("disconnect", () => {
        console.log(socket.id + ` Client disconnected`);
        sessionManager.leaveSession(socket);
    });
})

httpServer.listen(8080, () => {
    console.log(`Server listening on http://localhost:${8080}`);
});
