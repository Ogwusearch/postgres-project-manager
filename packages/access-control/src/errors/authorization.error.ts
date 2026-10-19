import type {
  AccessDecision,
  AuthorizationDenialReason,
} from "../authorization/access-decision.js";

/**
 * For application layers that need to convert a denied decision into
 * an exception. Keep internal reasons out of public responses by default.
 */
export class AuthorizationError extends Error {
  public readonly code = "AUTHORIZATION_DENIED";

  constructor(
    public readonly reason: AuthorizationDenialReason,
    message = "The requested action is not authorized.",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function throwIfDenied(decision: AccessDecision): void {
  if (!decision.allowed) {
    throw new AuthorizationError(decision.reason);
  }
}
