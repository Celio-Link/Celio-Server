export type CreateSessionMessage = {
    clientId: string;
};

export type JoinSessionMessage = {
    clientId: string;
    sessionId: string;
};

export type LeaveSessionMessage = {
    clientId: string
};