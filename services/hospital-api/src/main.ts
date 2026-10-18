import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import {
  PACS_VIEWER_PATHS,
  pacsViewerProxy,
} from './radiology/pacs-viewer.proxy';
import { PacsStudyAccessService } from './radiology/pacs-study-access.service';
import {
  loadSecretFiles,
  productionConfigProblems,
} from './config/runtime-config';
import { requestObserver } from './observability/request-metrics';

async function bootstrap() {
  // Secrets may come from files (Docker secrets); then fail fast in production
  // if anything critical is missing or unsafe, before serving any request.
  loadSecretFiles();
  const problems = productionConfigProblems();
  if (problems.length) {
    throw new Error(
      `Refusing to start in production:\n - ${problems.join('\n - ')}`,
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // First, so every response is counted and logged, the PACS proxy's too (28.2).
  app.use(requestObserver());

  // Behind the TLS reverse proxy, take the client address from X-Forwarded-For
  // (audit events record it). Set to the proxy's network, e.g. "uniquelocal".
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  // Don't advertise the framework, and stop browsers MIME-sniffing API responses.
  app.disable('x-powered-by');
  app.use(
    (
      _request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      response.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    },
  );

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  // OHIF viewer and DICOMweb, served through the API with the EHR session so
  // browsers never hold Orthanc credentials (see pacs-viewer.proxy.ts).
  app.use(
    PACS_VIEWER_PATHS,
    pacsViewerProxy(app.get(AuthService), app.get(PacsStudyAccessService)),
  );

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  console.log(`Hospital API running on http://localhost:${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Hospital API failed to start', error);
  process.exit(1);
});
