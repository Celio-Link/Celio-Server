import {Socket} from "socket.io";
import {ErrorType, SessionManager} from "./sessionManager.js";
import {BehaviorSubject, concatMap, Observable, Subject, switchMap} from 'rxjs';
import {v4 as uuidv4} from 'uuid';
import {err} from 'true-myth/result';
import {AckFn, isAckFn, isSessionId} from "./messages/validation.js";

/**
 * An emit ran out of retries because the client is disconnected. Removing the client is up to the disconnect
 * handling, so this is no error of its own.
 */
export class ClientDisconnectedError extends Error {
    constructor() {
        super("Client disconnected");
        this.name = "ClientDisconnectedError";
    }
}

export class Client {

    private currentlyInSession: boolean = false;
    private socket$: BehaviorSubject<Socket>;
    private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private sessionEvents$: Subject<string> = new Subject<string>();
    private eventHandlers: Record<string, (...args: unknown[]) => void> = {

        sessionCreate: (_: unknown, responseHandler: unknown) => {
            if (!isAckFn(responseHandler)) {
                console.warn('Client ' + this.clientId + ' sent sessionCreate without ack callback');
                return;
            }
            const sessionState = this.sessionManager.createSession(this);
            if (sessionState.isOk) console.log('Client ' + this.clientId + ` created session with id ` + sessionState.value.id);
            responseHandler(sessionState);
        },

        sessionJoin: (sessionId: unknown, responseHandler: unknown) => {
            if (!isAckFn(responseHandler)) {
                console.warn('Client ' + this.clientId + ' sent sessionJoin without ack callback');
                return;
            }
            if (!isSessionId(sessionId)) {
                console.warn('Client ' + this.clientId + ' sent sessionJoin with invalid session id');
                responseHandler(err(ErrorType.InvalidRequest));
                return;
            }
            console.log(this.clientId + ` Client wants to join session ` + sessionId);
            const sessionState = this.sessionManager.enterSession(this, sessionId);
            responseHandler(sessionState);
        },

        sessionLeft: () => {
            console.log('Client ' + this.clientId + ` tries to leave session`);
            this.sessionManager.leaveSession(this);
        },

        disconnect: () => {
            console.log('Client ' + this.clientId + ` disconnected`);
            // Only the latest disconnect counts, a reconnect cancels the timer
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = setTimeout(() => {
                this.disconnectTimer = undefined;
                this.checkDisconnect();
            }, 5000);
        }
    };

    constructor(private clientId: string, private socket: Socket, private sessionManager: SessionManager,
                private removeCb: (clientId: string) => void) {
        this.registerEventHandlers(socket);
        this.socket$ = new BehaviorSubject(socket);
        this.sessionEvents$.pipe(
            concatMap((event: string) =>
                this.emitWithRetry<boolean>(event, {uuid: uuidv4()})
                    .catch(err => {
                        if (err instanceof ClientDisconnectedError) return;
                        console.error('Client ' + this.clientId + ' did not ack ' + event + ':', err);
                    })
            )
        ).subscribe();
    }

    reconnect(socket: Socket) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = undefined;
        this.socket = socket;
        this.registerEventHandlers(socket);
        this.socket$.next(socket);
        console.warn('Client ' + this.clientId + ` reconnected`);
    }

    private registerEventHandlers(socket: Socket) {
        Object.entries(this.eventHandlers).forEach(([event, handler]) => {
            socket.on(event, (...args: unknown[]) => {
                try {
                    handler(...args);
                } catch (e) {
                    console.error('Client ' + this.clientId + ` failed to handle event ` + event + ':', e);
                }
            });
        });
    }

    id (): string {
        return this.clientId;
    }

    inSession(entered: boolean) {
        return this.currentlyInSession = entered;
    }

    checkDisconnect() {
        if (this.socket.disconnected){
            if (this.currentlyInSession) this.sessionManager.leaveSession(this)
            this.removeCb(this.clientId);
        }
        else console.warn('Client ' + this.clientId + ` recovered from disconnect`);
    }

    /**
     * Create an observable from a socket.io event, including the ack callback if the client requested one.
     * Survives reconnecting by switching to the latest socket.
     * @param event - The name of the event to listen for.
     */
    fromEventWithAck(event: string): Observable<{ data: unknown, ack?: AckFn }> {
        return this.socket$.pipe(
            switchMap((socket: Socket) => new Observable<{ data: unknown, ack?: AckFn }>(observer => {
                const handler = (data: unknown, ack?: unknown) => observer.next({data, ack: isAckFn(ack) ? ack : undefined});
                socket.on(event, handler);
                return () => { socket.off(event, handler); };
            }))
        );
    }

    /**
     * Send a session event to the client, retried until acked. The event carries a uuid to filter duplicates.
     * @param event - The name of the event to emit.
     */
    emitSessionEvent(event: string) {
        this.sessionEvents$.next(event);
    }

    /**
     * Emit an event to the server with retry logic.
     * @param event
     * @param data
     * @param retries
     * @param timeout
     * @param backoff
     */
    emitWithRetry<R>(event: string, data?: any, {
        retries = 5,
        timeout = 1000,
        backoff = 100  // ms added per retry
    } = {}) {
        return new Promise((resolve, reject) => {
            let attempt = 0;

            const tryEmit = () => {
                attempt++;

                this.socket.timeout(timeout).emit(event, data, (err: Error | null, ackValue: R) => {
                    if (!err) {
                        resolve(true);
                        return;
                    }

                    if (attempt > retries) {
                        reject(this.socket.connected ? new Error("Max retries reached") : new ClientDisconnectedError());
                        return;
                    }

                    setTimeout(tryEmit, backoff * attempt);
                });
            };

            tryEmit();
        });
    }
}