import {Socket} from "socket.io";
import {ErrorType, SessionManager} from "./sessionManager.js";
import {BehaviorSubject, concatMap, Observable, Subject, switchMap} from 'rxjs';
import {v4 as uuidv4} from 'uuid';
import {err} from 'true-myth/result';
import {AckFn, isAckFn, isPlayerNumber, isSessionId} from "./messages/validation.js";

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
    // Smoothed ack round trip, from first sends only (Karn): the ack timeout follows the line.
    private srttMs: number | undefined;
    private ackTimeoutMs(floor: number): number {
        if (this.srttMs === undefined) return floor;
        return Math.min(8000, Math.max(floor, Math.round(2 * this.srttMs)));
    }
    private socket$: BehaviorSubject<Socket>;
    private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private sessionEvents$: Subject<string> = new Subject<string>();
    private eventHandlers: Record<string, (...args: unknown[]) => void> = {

        sessionCreate: (playerNumber: unknown, responseHandler: unknown) => {
            if (!isAckFn(responseHandler)) {
                console.warn('Client ' + this.clientId + ' sent sessionCreate without ack callback');
                return;
            }
            if (!isPlayerNumber(playerNumber)) {
                console.warn('Client ' + this.clientId + ' sent sessionCreate with invalid player number');
                responseHandler(err(ErrorType.InvalidRequest));
                return;
            }
            const sessionState = this.sessionManager.createSession(this, playerNumber);
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
        backoff = 100  // ms before resending a copy that failed outright, times the attempt
    } = {}) {
        // A copy that is only slow is sent again when its wait runs out, each wait twice the last (1, 2, 4, 8,
        // 8, 8 s from a 1 s start), and every copy listens for its ack until the last one's time is up: on a line
        // slower than the wait, the first copy's ack still arrives, and counts. Only an ack for the first copy is
        // timed (Karn). A copy that fails outright is sent again after `backoff`, as before.
        const base = this.ackTimeoutMs(timeout);
        const waits = Array.from({length: retries + 1}, (_, i) => Math.min(8000, base * 2 ** i));
        const deadline = Date.now() + waits.reduce((a, b) => a + b, 0);
        return new Promise((resolve, reject) => {
            let attempt = 0, settled = false, timer: ReturnType<typeof setTimeout> | undefined;

            const giveUp = () => {
                settled = true;
                clearTimeout(timer);
                reject(this.socket.connected ? new Error("Max retries reached") : new ClientDisconnectedError());
            };
            const next = (delay: number) => {
                clearTimeout(timer);
                if (attempt > retries) giveUp();
                else timer = setTimeout(tryEmit, delay);
            };

            const tryEmit = () => {
                const copy = attempt++;
                const sentAt = Date.now();
                this.socket.timeout(Math.max(1, deadline - sentAt)).emit(event, data, (err: Error | null, ackValue: R) => {
                    if (settled) return;
                    if (err) {
                        if (copy === attempt - 1) next(backoff * attempt);   // the newest copy failed: resend now
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    if (copy === 0) {
                        const rtt = Date.now() - sentAt;
                        this.srttMs = this.srttMs === undefined ? rtt : (7 * this.srttMs + rtt) / 8;
                    }
                    resolve(true);
                });
                timer = setTimeout(() => { if (!settled) next(0); }, waits[copy]);
            };

            tryEmit();
        });
    }
}