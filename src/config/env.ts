import dotenv from "dotenv";

dotenv.config();

/** Reads a required environment variable, throwing at boot if missing. */
const required = (key: string): string => {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const optional = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim() !== "" ? value : fallback;
};

const toNumber = (value: string, key: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be a number, received: ${value}`,
    );
  }
  return parsed;
};

/** Like `optional`, but tries several keys in order (new name first, legacy names after). */
const optionalAny = (keys: string[], fallback: string): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim() !== "") return value;
  }
  return fallback;
};

const nodeEnv = optional("NODE_ENV", "development");
const clientUrl = optional("CLIENT_URL", "http://localhost:5173");
const smtpPort = toNumber(optional("SMTP_PORT", "587"), "SMTP_PORT");

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: toNumber(optional("PORT", "4000"), "PORT"),
  apiPrefix: optional("API_PREFIX", "/api/v1"),
  corsOrigins: optional("CORS_ORIGINS", "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  databaseUrl: required("DATABASE_URL"),
  clientUrl,
  /** Public web app origin used in emailed links (e.g. password reset). */
  frontendUrl: optionalAny(["FRONTEND_URL", "CLIENT_URL"], clientUrl).replace(
    /\/+$/,
    "",
  ),
  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessExpiresIn: optional("JWT_ACCESS_EXPIRES_IN", "15m"),
    refreshExpiresIn: optional("JWT_REFRESH_EXPIRES_IN", "7d"),
  },
  bcryptSaltRounds: toNumber(
    optional("BCRYPT_SALT_ROUNDS", "12"),
    "BCRYPT_SALT_ROUNDS",
  ),
  passwordResetTtlMinutes: toNumber(
    optional("PASSWORD_RESET_TTL_MINUTES", "30"),
    "PASSWORD_RESET_TTL_MINUTES",
  ),
  /** Minimum gap between reset emails for the same account. */
  passwordResetCooldownSeconds: toNumber(
    optional("PASSWORD_RESET_COOLDOWN_SECONDS", "60"),
    "PASSWORD_RESET_COOLDOWN_SECONDS",
  ),
  smtp: {
    host: optional("SMTP_HOST", ""),
    port: smtpPort,
    /** Implicit TLS; defaults to true only for port 465 (587/25 use STARTTLS). */
    secure: optional("SMTP_SECURE", smtpPort === 465 ? "true" : "false") === "true",
    user: optional("SMTP_USER", ""),
    pass: optionalAny(["SMTP_PASSWORD", "SMTP_PASS"], ""),
    from: optionalAny(["SMTP_FROM", "MAIL_FROM"], "Lab Unity <no-reply@labunity.com>"),
  },
  upload: {
    dir: optional("UPLOAD_DIR", "uploads"),
    maxSizeMb: toNumber(
      optional("MAX_UPLOAD_SIZE_MB", "50"),
      "MAX_UPLOAD_SIZE_MB",
    ),
    publicUrl: optional("PUBLIC_URL", "http://localhost:4000"),
    /** Most files accepted in one multi-file request. */
    maxFiles: toNumber(optional("MAX_UPLOAD_FILES", "12"), "MAX_UPLOAD_FILES"),
    /** Chat attachments; never served statically, only through signed links. Must be persistent storage. */
    privateDir: optional("PRIVATE_UPLOAD_DIR", "private-uploads"),
    /** HMAC key for chat attachment links; falls back to a key derived from JWT_ACCESS_SECRET. */
    signingSecret: optional("ATTACHMENT_URL_SECRET", ""),
    /** Lifetime of a signed chat attachment link, in seconds (links are re-issued with each fetch). */
    signedUrlTtlSeconds: toNumber(
      optional("ATTACHMENT_URL_TTL_SECONDS", "21600"),
      "ATTACHMENT_URL_TTL_SECONDS",
    ),
  },
  rateLimit: {
    windowMs: toNumber(
      optional("RATE_LIMIT_WINDOW_MS", "900000"),
      "RATE_LIMIT_WINDOW_MS",
    ),
    max: toNumber(optional("RATE_LIMIT_MAX", "300"), "RATE_LIMIT_MAX"),
  },
  stripe: {
    secretKey: optional("STRIPE_SECRET_KEY", ""),
    publishableKey: optional("STRIPE_PUBLISHABLE_KEY", ""),
    webhookSecret: optional("STRIPE_WEBHOOK_SECRET", ""),
    priceMonthly: optional("STRIPE_PRICE_MONTHLY", ""),
    priceYearly: optional("STRIPE_PRICE_YEARLY", ""),
    clientUrl,
  },
} as const;

export type Env = typeof env;
