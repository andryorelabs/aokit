import { ApplyError } from "../apply/index.ts";
import { AokitError } from "../cli/envelope.ts";
import type { ErrorCode } from "../cli/exit-codes.ts";
import { FormatError } from "../format/index.ts";
import { RegistryError } from "../registry/index.ts";
import type { ResolveError } from "../resolver/types.ts";

const resolverErrorCodes: Record<ResolveError["code"], ErrorCode> = {
  unknown_module: "REQUIREMENT_UNMET",
  requirement_unmet: "REQUIREMENT_UNMET",
  requirement_ambiguous: "REQUIREMENT_UNMET",
  extension_point_unmet: "REQUIREMENT_UNMET",
  cardinality_exceeded: "CARDINALITY_EXCEEDED",
  module_conflict: "CAPABILITY_CONFLICT",
  dependency_cycle: "CAPABILITY_CONFLICT",
};

/** A Resolver failure as an exit-4 error; the Resolver's own code leads the message. */
export function fromResolveError(error: ResolveError): AokitError {
  return new AokitError(
    resolverErrorCodes[error.code],
    `[${error.code}] ${error.message}`,
    error.fix,
    { resolverCode: error.code },
  );
}

function registryErrorCode(error: RegistryError): ErrorCode {
  if (error.code === "REGISTRY_NOT_FOUND") {
    return "INVALID_INPUT";
  }
  return error.code === "REGISTRY_CLI_TOO_OLD" ? "MIN_CLI_VERSION" : "IO_ERROR";
}

/** Turns the subsystem errors a create run can hit into coded command errors. */
export function toAokitError(thrown: unknown): unknown {
  if (thrown instanceof RegistryError) {
    return new AokitError(
      registryErrorCode(thrown),
      `[${thrown.code}] ${thrown.message}`,
      thrown.fix,
    );
  }
  if (thrown instanceof FormatError) {
    return new AokitError("IO_ERROR", `[${thrown.code}] ${thrown.message}`, thrown.fix);
  }
  if (thrown instanceof ApplyError) {
    return new AokitError(thrown.code, thrown.message, thrown.fix);
  }
  return thrown;
}
