import { Session } from "./session.js";
import { nanoid } from "nanoid";
import { Result } from 'true-myth';
import { ok, err } from 'true-myth/result';
import {Client} from "./client.js";

enum ErrorType {
    NotFound = "Session not found",
    AlreadyExists = "Session already exists"
}

interface SessionState {
    id: string;
    full: boolean;
}

export class SessionManager {

    private sessions: Map<string, Session> = new Map();
    private clientToSession: Map<Client, string> = new Map();

    createSession(client: Client) :  Result<SessionState, ErrorType> {
        if (this.clientToSession.has(client)) return err(ErrorType.AlreadyExists);
        const sessionId: string = nanoid();
        const session = new Session(sessionId);
        session.close$.subscribe((closeSession: Session) => {this.renewSession(closeSession)});
        this.sessions.set(sessionId, session);
        return this.enterSession(client, sessionId);
    }

    enterSession(client: Client, sessionId: string) : Result<SessionState, ErrorType> {
        const session = this.findSession(sessionId)
        if (!session) return err(ErrorType.NotFound);

        this.clientToSession.set(client, sessionId);
        session.enter(client);
        return ok({id: sessionId, full: session.isFull()});
    }

    leaveSession(client: Client)  {
        if (!this.clientToSession.has(client)) {
            console.warn('Client ' + client.id() +' tried to leave session but was not in one');
            return;
        }
        let sessionId = this.clientToSession.get(client)!;
        const session = this.findSession(sessionId);
        if (!session) {
            console.warn('Client ' + client.id() + ' tried to leave session but session was not found');
            return;
        }
        session.leave(client);
        if (session.isEmpty()) {
            this.deleteSession(session)
        } else {
            this.renewSession(session)
        }
        this.clientToSession.delete(client);
    }

    private findSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    private deleteSession(session: Session) {
        const result = this.sessions.delete(session.id());
        const sessionId = session.id();
        if (result) {
            console.log('Session deleted with id: ' + sessionId)
        }
        else {
            console.warn('Session with id could not be deleted because id ' + sessionId + ' was not found')
        }
    }

    private renewSession(oldSession: Session) : void {
        const sessionId = oldSession.id()
        let newSession = new Session(sessionId)
        newSession.close$.subscribe((closeSession: Session) => {this.renewSession(closeSession)});
        newSession.moveSession(oldSession)
        this.sessions.set(sessionId, newSession)
        console.log('Session with id ' + sessionId + ' was moved to new session')
    }


}