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

const nodeEnv = optional("NODE_ENV", "development");

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
  upload: {
    dir: optional("UPLOAD_DIR", "uploads"),
    maxSizeMb: toNumber(
      optional("MAX_UPLOAD_SIZE_MB", "50"),
      "MAX_UPLOAD_SIZE_MB",
    ),
    publicUrl: optional("PUBLIC_URL", "http://localhost:4000"),
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
    clientUrl: optional("CLIENT_URL", "http://localhost:5173"),
  },
} as const;

export type Env = typeof env;
