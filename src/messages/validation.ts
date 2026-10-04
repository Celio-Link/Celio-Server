/**
 * Runtime guards for payloads received from clients. Socket.IO delivers whatever the
 * client sent, so every incoming event must be checked before it is used.
 */

export const DATA_ARRAY_LENGTH = 32;
const MAX_DATA_BATCH_SIZE = 1024;

export type AckFn = (response: unknown) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUInt16(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xFFFF;
}

function isSequenceNumber(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isAckFn(value: unknown): value is AckFn {
    return typeof value === "function";
}

export function isSessionId(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}$/.test(value);
}

export function isClientId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Status values are only checked to be uint16, not against LinkStatus: clients send statuses
 * the server does not know (e.g. EmuSessionStarted), which are intentionally ignored later on.
 */
export function isStatusPacket(value: unknown): value is { uuid: string, linkStatus: number } {
    return isRecord(value)
        && typeof value.uuid === "string" && value.uuid.length > 0 && value.uuid.length <= 64
        && isUInt16(value.linkStatus);
}

export function isDataPacket(value: unknown): value is { sequence: number, data: number[] } {
    return isRecord(value)
        && isSequenceNumber(value.sequence)
        && Array.isArray(value.data)
        && value.data.length === DATA_ARRAY_LENGTH
        && value.data.every(isUInt16);
}

export function isDataPacketBatch(value: unknown): value is { sequence: number, data: number[] }[] {
    return Array.isArray(value)
        && value.length > 0
        && value.length <= MAX_DATA_BATCH_SIZE
        && value.every(isDataPacket);
}
