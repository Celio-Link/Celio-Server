// @ts-ignore
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { ErrorType, ControlMessage, SessionCreationMessage, JoinMessage } from "./messages/session";
import { SessionManager } from "./sessionManager";
import { nanoid } from 'nanoid';


const httpServer = createServer();
const sessionManager: SessionManager = new SessionManager();
const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket"], // 🚀 only WebSocket
});



io.on("connection", (socket: Socket) => {
    socket.on("sessionCreate", (msg: JoinMessage, responseHandler) => {
        const sessionId = sessionManager.createSession(socket)
        responseHandler(sessionId);
    });

    socket.on("sessionJoin", (msg: JoinMessage, responseHandler) => {
        const sessionId = sessionManager.enterSession(socket, msg.id)
        return responseHandler(sessionId);
    });

    socket.on("disconnect", () => {
        const session = socketToSession.get(socket);
        if (session === undefined) return;

        socketToSession.delete(socket);

        if (!session.isFull()) {
            const index = sessions.findIndex(sessionTemp => sessionTemp.id() === session.id());
            sessions.splice(index, 1);
        }
        else {
            session.leave(socket);
        }
    });
})
