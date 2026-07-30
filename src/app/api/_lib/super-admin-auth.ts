import "server-only";

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SUPER_ADMIN_SESSION_COOKIE = "ordo_super_admin_session";
export const SUPER_ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

const SESSION_VERSION = 1;
const SESSION_SUBJECT = "super-admin";

type SuperAdminConfig = {
  login: string;
  password: string;
  sessionSecret: string;
};

type SuperAdminSessionPayload = {
  v: number;
  sub: string;
  login: string;
  exp: number;
};

export type SuperAdminSession = {
  login: string;
  expiresAt: string;
};

export class SuperAdminConfigurationError extends Error {
  constructor(missingVariables: string[]) {
    super(`Не настроена авторизация Super Admin. Добавьте в .env.local: ${missingVariables.join(", ")}.`);
    this.name = "SuperAdminConfigurationError";
  }
}

function getSuperAdminConfig(): SuperAdminConfig {
  const config = {
    login: String(process.env.SUPER_ADMIN_LOGIN || "").trim(),
    password: String(process.env.SUPER_ADMIN_PASSWORD || ""),
    sessionSecret: String(process.env.SUPER_ADMIN_SESSION_SECRET || ""),
  };
  const missingVariables = [
    !config.login && "SUPER_ADMIN_LOGIN",
    !config.password && "SUPER_ADMIN_PASSWORD",
    !config.sessionSecret && "SUPER_ADMIN_SESSION_SECRET",
  ].filter((name): name is string => Boolean(name));

  if (missingVariables.length) {
    throw new SuperAdminConfigurationError(missingVariables);
  }

  return config;
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parsePayload(encodedPayload: string): SuperAdminSessionPayload | null {
  try {
    const value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SuperAdminSessionPayload>;
    if (
      value.v !== SESSION_VERSION
      || value.sub !== SESSION_SUBJECT
      || typeof value.login !== "string"
      || !value.login
      || typeof value.exp !== "number"
      || !Number.isSafeInteger(value.exp)
    ) {
      return null;
    }
    return value as SuperAdminSessionPayload;
  } catch {
    return null;
  }
}

export function authenticateSuperAdmin(login: string, password: string) {
  const config = getSuperAdminConfig();
  const loginMatches = constantTimeEqual(login.trim(), config.login);
  const passwordMatches = constantTimeEqual(password, config.password);
  return loginMatches && passwordMatches;
}

export function createSuperAdminSessionToken(now = Date.now()) {
  const config = getSuperAdminConfig();
  const payload: SuperAdminSessionPayload = {
    v: SESSION_VERSION,
    sub: SESSION_SUBJECT,
    login: config.login,
    exp: Math.floor(now / 1000) + SUPER_ADMIN_SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, config.sessionSecret)}`;
}

export function verifySuperAdminSessionToken(token: string | undefined, now = Date.now()): SuperAdminSession | null {
  const config = getSuperAdminConfig();
  if (!token) return null;

  const [encodedPayload, providedSignature, ...extraParts] = token.split(".");
  if (!encodedPayload || !providedSignature || extraParts.length) return null;

  const expectedSignature = sign(encodedPayload, config.sessionSecret);
  if (!constantTimeEqual(providedSignature, expectedSignature)) return null;

  const payload = parsePayload(encodedPayload);
  if (!payload || payload.exp <= Math.floor(now / 1000) || !constantTimeEqual(payload.login, config.login)) {
    return null;
  }

  return {
    login: payload.login,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}
