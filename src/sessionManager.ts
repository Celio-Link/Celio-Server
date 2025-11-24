import { Session } from "./session.js";
import { nanoid } from "nanoid";
import { Result } from 'true-myth';
import { ok, err } from 'true-myth/result';
import {Client} from "./client.js";

enum ErrorType {
    NotFound = "Not Found",
    AlreadyExists = "AlreadyExists"
}

interface SessionState {
    sessionId: string;
    full: boolean;
}

export class SessionManager {

    private sessions: Session[] = [];
    private clientToSession: Map<Client, Session> = new Map();

    createSession(client: Client) :  Result<SessionState, ErrorType> {
        if (this.clientToSession.has(client)) return err(ErrorType.AlreadyExists);
        const sessionId: string = nanoid();
        this.sessions.push(new Session(sessionId));
        return this.enterSession(client, sessionId);
    }

    enterSession(client: Client, sessionId: string) : Result<SessionState, ErrorType> {
        const session = this.findSession(sessionId)
        if (!session) return err(ErrorType.NotFound);

        this.clientToSession.set(client, session);
        session.enter(client);
        return ok({sessionId: sessionId, full: session.isFull()});
    }

    leaveSession(client: Client)  {
        if (!this.clientToSession.has(client)) { return; }
        let session = this.clientToSession.get(client)!;
        session.leave(client);
        if (session.isEmpty()) {
            let index = this.sessions.findIndex(tempSession => tempSession.id() === session.id());
            if (index >= 0) {
                console.log('Session deleted with id ' + this.sessions[index].id())
                this.sessions.splice(index, 1);
            }
        }
        this.clientToSession.delete(client);
    }

    private findSession(sessionId: string): Session | undefined {
        const index = this.sessions.findIndex(session => session.id() === sessionId)
        if (index < 0) return undefined;
        return this.sessions[index];
    }


}