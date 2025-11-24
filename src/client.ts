import {Socket} from "socket.io";
import {CreateSessionMessage, JoinSessionMessage, LeaveSessionMessage} from "./messages/session.js";
import {SessionManager} from "./sessionManager.js";
import {BehaviorSubject, fromEvent, Observable, switchMap} from 'rxjs';

export class Client {

    private socket$: BehaviorSubject<Socket>;
    private eventHandlers = {

        sessionCreate: (msg: CreateSessionMessage, responseHandler: any   ) => {
            const sessionState = this.sessionManager.createSession(this);
            if (sessionState.isOk) console.log(msg.clientId + ` Client created session with id ` + sessionState.value.sessionId);
            responseHandler(sessionState);
        },

        sessionJoin: (msg: JoinSessionMessage, responseHandler: any) => {
            console.log(msg.clientId + ` Client wants to join session ` + msg.sessionId);
            const sessionState = this.sessionManager.enterSession(this, msg.sessionId);
            return responseHandler(sessionState);
        },

        sessionLeft: (msg: LeaveSessionMessage) => {
            this.sessionManager.leaveSession(this);
            console.log(msg.clientId + ` Client left session`);
        }
    };

    constructor(private clientId: string, private socket: Socket, private sessionManager: SessionManager,
                private removeCb: (clientId: string) => void) {
        Object.entries(this.eventHandlers).forEach(([event, handler]) => {
            socket.on(event, handler);
            this.socket$ = new BehaviorSubject(socket);
        });
    }

    reconnect(socket: Socket) {
        this.socket = socket;
        Object.entries(this.eventHandlers).forEach(([event, handler]) => {
            socket.on(event, handler);
        });
        this.socket$.next(socket);
    }

    id (): string {
        return this.clientId;
    }

    /**
     * Create an observable from a socket.io event.
     * @param event - The name of the event to listen for.
     */
    fromEvent<T>(event: string): Observable<T> {
        return this.socket$.pipe(
            switchMap((socket: Socket) => fromEvent<T>(socket, event))
        );
    }

    /**
     * Emit an event to the client.
     * @param event - The name of the event to emit.
     * @param args - Optional arguments to pass to the event handler.
     */
    emit(event: string, ...args: any[]) {
        this.socket.emit(event, args);
    }

    /**
     * Emit an event to the server with retry logic.
     * @param event
     * @param data
     * @param retries
     * @param timeout
     * @param backoff
     */
    emitWithRetry<R>(event: string, data: any, {
        retries = 5,
        timeout = 1000,
        backoff = 500  // ms added per retry
    } = {}) {

        return new Promise((resolve, reject) => {
            let attempt = 0;

            const tryEmit = () => {
                attempt++;

                this.socket.timeout(timeout).emit(event, data , (err: any, response: R) => {
                    if (!err) {
                        resolve(response);
                        return;
                    }

                    if (attempt > retries) {
                        reject(new Error("Max retries reached"));
                        return;
                    }

                    setTimeout(tryEmit, backoff * attempt);
                });
            };

            tryEmit();
        });
    }
}