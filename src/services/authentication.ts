import argon2 from "argon2";
import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "ppm_session";
export const CSRF_COOKIE = "ppm_csrf";
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

const production = process.env.NODE_ENV === "production";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatchesHash(
  token: string,
  expectedHash: string,
): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return timingSafeEqual(actual, expected);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("Password must be between 12 and 1024 characters.");
  }

  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  if (
    password.length === 0 ||
    password.length > 1024 ||
    !passwordHash.startsWith("$argon2id$")
  ) {
    return false;
  }

  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function cookieOptions(maxAge: number): string {
  return [
    "Path=/",
    `Max-Age=${maxAge}`,
    "SameSite=Strict",
    ...(production ? ["Secure"] : []),
  ].join("; ");
}

export function sessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    cookieOptions(SESSION_LIFETIME_SECONDS),
  ].join("; ");
}

export function csrfCookie(token: string): string {
  return [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    cookieOptions(SESSION_LIFETIME_SECONDS),
  ].join("; ");
}

export function clearSessionCookies(): string[] {
  const attributes = [
    "Path=/",
    "Max-Age=0",
    "SameSite=Strict",
    ...(production ? ["Secure"] : []),
  ].join("; ");

  return [
    `${SESSION_COOKIE}=; HttpOnly; ${attributes}`,
    `${CSRF_COOKIE}=; ${attributes}`,
  ];
}

export function csrfTokensMatch(
  cookieToken: string | undefined,
  headerToken: string | undefined,
  storedHash: string,
): boolean {
  if (!cookieToken || !headerToken) return false;

  const cookieBytes = Buffer.from(cookieToken, "utf8");
  const headerBytes = Buffer.from(headerToken, "utf8");

  if (
    cookieBytes.length === 0 ||
    cookieBytes.length !== headerBytes.length ||
    !timingSafeEqual(cookieBytes, headerBytes)
  ) {
    return false;
  }

  return tokenMatchesHash(headerToken, storedHash);
}
