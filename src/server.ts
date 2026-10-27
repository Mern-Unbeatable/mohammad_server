import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/config/logger";
import { connectDatabase, disconnectDatabase } from "@/infrastructure/prisma";
import { verifyMailer } from "@/infrastructure/mailer";
import { closeRealtime, initRealtime } from "@/realtime/socket";
import { publicUploadRoot } from "@/middleware/upload";

const bootstrap = async (): Promise<void> => {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`Server listening on port ${env.port} (${env.nodeEnv})`);
    logger.info(`API base: ${env.apiPrefix}`);
    logger.info(`Uploads: ${env.upload.publicUrl}/${env.upload.dir} -> ${publicUploadRoot}`);
    if (env.isProduction && !/^https:\/\/(?!localhost|127\.)/.test(env.upload.publicUrl)) {
      logger.warn(
        `PUBLIC_URL is "${env.upload.publicUrl}". Uploaded images will get unreachable or mixed-content links; set it to this API's public https origin.`,
      );
    }
  });
  initRealtime(server);
  void verifyMailer();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received, shutting down gracefully`);
    await closeRealtime();
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Force-exit if graceful shutdown stalls.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

bootstrap().catch((error) => {
  logger.error({ err: error }, "Failed to start server");
  process.exit(1);
});
