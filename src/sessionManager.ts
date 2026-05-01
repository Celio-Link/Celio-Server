import { Session } from "./session.js";
import { nanoid } from "nanoid";
import { Result } from 'true-myth';
import { ok, err } from 'true-myth/result';
import {Client} from "./client.js";
import {take} from "rxjs";

enum ErrorType {
    NotFound = "Session not found",
    AlreadyExists = "Session already exists",
    SessionFull = "Session is full",
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

        session.close$
            .pipe(take(1))
            .subscribe((closingSession: Session) => {
                console.log('Session ' + closingSession.id() + ' emitted closing event');
                this.deleteSession(closingSession);
            });

        this.sessions.set(sessionId, session);
        return this.enterSession(client, sessionId);
    }

    enterSession(client: Client, sessionId: string) : Result<SessionState, ErrorType> {
        const session = this.findSession(sessionId)
        if (!session) {
            console.warn('Client ' + client.id() + ' tried to join session with id ' + sessionId + ' which does not exist');
            return err(ErrorType.NotFound);
        }
        if (session.isFull()) {
            console.warn('Client ' + client.id() + ' tried to join session with id ' + sessionId + ' which is full');
            return err(ErrorType.SessionFull);
        }
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
    }

    private findSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId);
    }

    private deleteSession(session: Session) {
        for (const [client, id] of this.clientToSession) {
            if (id === session.id()) {
                this.clientToSession.delete(client);
            }
        }
        const result = this.sessions.delete(session.id());
        const sessionId = session.id();
        if (result) {
            console.log('Session deleted with id: ' + sessionId)
        }
        else {
            console.warn('Session with id could not be deleted because id ' + sessionId + ' was not found')
        }
    }
}