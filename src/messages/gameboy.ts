export enum LinkStatus {
    Empty = 0xFFFF,
    HandshakeWaiting = 0xFF02,
    HandshakeReceived = 0xFF03,
    HandshakeFinished = 0xFF04,
    LinkConnected = 0xFF05,
    LinkReconnecting = 0xFF06,
    LinkClosed = 0xFF07
}

export enum CommandType {
    SetMode = 0x00,
    SetModeMaster = 0x10,
    SetModeSlave = 0x11,
    StartHandshake = 0x12,
    ConnectLink = 0x13
}