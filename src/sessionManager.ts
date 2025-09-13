import { Session } from "./session.js";
import { Socket} from "socket.io";
import { nanoid } from "nanoid";
import { Result } from 'true-myth';
import { ok, err, map, toString } from 'true-myth/result';

enum ErrorType {
    NotFound = "Not Found",
    AlreadyExists = "AlreadyExists"
}

interface SessionState {
    id: string;
    full: boolean;
}

export class SessionManager {

    private sessions: Session[] = [];
    private socketToSession: Map<Socket, Session> = new Map();

    createSession(socket: Socket) :  Result<SessionState, ErrorType> {
        if (this.socketToSession.has(socket)) return err(ErrorType.AlreadyExists);
        const sessionId: string = nanoid();
        this.sessions.push(new Session(sessionId));
        return this.enterSession(socket, sessionId);
    }

    enterSession(socket: Socket, sessionId: string) : Result<SessionState, ErrorType>
    {
        const session = this.findSession(sessionId)
        if (!session) return err(ErrorType.NotFound);

        this.socketToSession.set(socket, session);
        session.enter(socket);
        return ok({id: sessionId, full: session.isFull()});
    }

    leaveSession(socket: Socket)  {
        if (!this.socketToSession.has(socket)) { return; }
        let session = this.socketToSession.get(socket)!;
        session.leave(socket);
        socket.leave(session.id())
        if (session.isEmpty()) {
            let index = this.sessions.findIndex(tempSession => tempSession.id() === session.id());
            if (index >= 0) {
                console.log('Session deleted with id ' + this.sessions[index].id())
                this.sessions.splice(index, 1);
            }
        }
        this.socketToSession.delete(socket);
    }

    private findSession(sessionId: string): Session | undefined {
        const index = this.sessions.findIndex(session => session.id() === sessionId)
        if (index < 0) return undefined;
        return this.sessions[index];
    }

}