import { exitCodeForErrorCode, exitCodes, type ErrorCode, type ExitCode } from "./exit-codes.ts";

export interface ErrorPayload {
  code: string;
  message: string;
  fix: string;
}

export type Envelope =
  | { ok: true; data: unknown; error: null }
  | { ok: false; data: unknown; error: ErrorPayload };

/** An error a command raises on purpose; carries a stable code and a fix. */
export class AokitError extends Error {
  readonly code: ErrorCode;
  readonly fix: string;
  readonly data: unknown;

  constructor(code: ErrorCode, message: string, fix: string, data: unknown = null) {
    super(message);
    this.name = "AokitError";
    this.code = code;
    this.fix = fix;
    this.data = data;
  }
}

export function successEnvelope(data: unknown): Envelope {
  return { ok: true, data, error: null };
}

/** A failed outcome; `data` carries the report of an outcome error and is `null` otherwise. */
export function failureEnvelope(error: ErrorPayload, data: unknown = null): Envelope {
  return { ok: false, data, error };
}

/** The report data an error carries; `null` for anything but an `AokitError` with data. */
export function errorDataFrom(thrown: unknown): unknown {
  return thrown instanceof AokitError ? thrown.data : null;
}

/** Converts anything thrown into an error payload; unknown throws become `INTERNAL`. */
export function errorPayloadFrom(thrown: unknown): ErrorPayload {
  if (thrown instanceof AokitError) {
    return { code: thrown.code, message: thrown.message, fix: thrown.fix };
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return {
    code: "INTERNAL",
    message,
    fix: "rerun with --verbose and report the issue",
  };
}

export function exitCodeForEnvelope(envelope: Envelope): ExitCode {
  return envelope.ok ? exitCodes.success : exitCodeForErrorCode(envelope.error.code);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entryValue]) => [key, sortKeysDeep(entryValue)] as const);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

/** Serializes to JSON with keys sorted at every level. */
export function stringifySorted(value: unknown, indent?: number): string {
  return JSON.stringify(sortKeysDeep(value), null, indent);
}
