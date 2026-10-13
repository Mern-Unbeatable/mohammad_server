import path from "node:path";
import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { apiRouter } from "@/routes";
import { errorHandler } from "@/middleware/errorHandler";
import { notFoundHandler } from "@/middleware/notFound";
import { globalRateLimiter } from "@/middleware/rateLimit";
import { subscriptionsController } from "@/modules/user/subscriptions/subscriptions.controller";

export const createApp = (): Application => {
  const app = express();

  app.set("trust proxy", 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  app.use(
    cors({
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(compression());

  // Stripe webhooks require the raw body for signature verification.
  app.post(
    `${env.apiPrefix}/subscriptions/webhook`,
    express.raw({ type: "application/json" }),
    subscriptionsController.webhook,
  );

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      data: {
        project: {
          name: "Lab Unity Server",
          version: "1.0.0",
          description:
            "Production-grade backend for the Lab Unity laboratory network, marketplace, and community platform.",
          owner: "Mern-Unbeatable",
          maintainer: "Backend Team",
        },
        stack: {
          language: "TypeScript",
          runtime: "Node.js 18+",
          framework: "Express.js",
          database: "PostgreSQL + Prisma ORM",
          auth: "JWT + bcryptjs",
          architecture:
            "Modular REST API with middleware, services, validators, and route-based modules",
        },
        developer: {
          name: "Nayem Islam",
          image:
            "https://avatars.githubusercontent.com/u/94972992?s=400&u=1c5d1ac5bd7bb0ee288146dce9fdbcb83c30d5d6&v=4",
          nodeVersion: process.version,
          generatedAt: new Date().toISOString(),
        },
      },
    });
  });

  // Serve uploaded files statically.
  app.use(
    `/${env.upload.dir}`,
    express.static(path.resolve(process.cwd(), env.upload.dir)),
  );

  app.use(env.apiPrefix, globalRateLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
