import { Session } from "./session";
import { Socket } from "socket.io";
import { nanoid } from "nanoid";
import { Result } from 'true-myth/';
import {err, ok} from "true-myth/dist/result";

export enum ErrorType {
    NotFound = "Not Found",
    AlreadyExists = "AlreadyExists"
}

export class SessionManager {

    private sessions: Session[] = [];
    private socketToSession: Map<Socket, Session> = new Map();

    createSession(socket: Socket) :  Result<string, ErrorType> {
        if (this.socketToSession.has(socket)) return err(ErrorType.AlreadyExists);
        const sessionId: string = nanoid();
        this.sessions.push(new Session(sessionId));
        return this.enterSession(socket, sessionId);
    }

    enterSession(socket: Socket, sessionId: string) : Result<string, ErrorType>
    {
        const session = this.findSession(sessionId)
        if (!session) return err(ErrorType.NotFound);

        this.socketToSession.set(socket, session);
        session.enter(socket);
        socket.join(sessionId);
        return ok(sessionId);
    }

    private findSession(sessionId: string): Session | undefined {
        const index = this.sessions.findIndex(session => session.id() === sessionId)
        if (index < 0) return undefined;
        return this.sessions[index];
    }
}