export enum LinkStatus {
    Empty = 0xFFFF,
    AwaitModeEmulator = 0xFF01,
    AwaitMode = 0xFF02,
    HandshakeReceived = 0xFF03,
    HandshakeFinished = 0xFF04,
    LinkConnected = 0xFF05,
    LinkReconnecting = 0xFF06,
    LinkClosed = 0xFF07
}

export enum CommandType {
    SetMode = 0x00,
    PlayerSettings = 0x10,
    SetModeSlave = 0x11,
    StartHandshake = 0x12,
    ConnectLink = 0x13
}

export interface PlayerSettingsArgs {
    playerCount: number;
    // Number of players that sent AwaitMode before this player, so it knows its place
    playerIndex: number;
}

/**
 * Args of each command the server sends. Converting them for the device is up to the client.
 */
export interface CommandArgs {
    [CommandType.PlayerSettings]: PlayerSettingsArgs;
    [CommandType.SetModeSlave]: undefined;
    [CommandType.StartHandshake]: undefined;
    [CommandType.ConnectLink]: undefined;
}

export type SendableCommand = keyof CommandArgs;

export type CommandPacket = {
    [C in SendableCommand]: { uuid: string, command: C, args: CommandArgs[C] }
}[SendableCommand];