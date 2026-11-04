import type { DriftOf } from "../merge/index.ts";
import { hashTrackedFile, volatileHash } from "./hash.ts";

/** Classifies one file against its Lockfile entry; the single drift lookup shared by every command. */
export const lockfileDriftOf: DriftOf = ({ path, entry, user }) => {
  if (entry === undefined) return user === undefined ? "deleted" : "unknown";
  if (entry.mode === "ejected") return "pristine";
  if (user === undefined) return "deleted";
  if (entry.hash === volatileHash) return "volatile";
  const bytes = typeof user === "string" ? new TextEncoder().encode(user) : user;
  return hashTrackedFile(path, bytes) === entry.hash ? "pristine" : "modified";
};
