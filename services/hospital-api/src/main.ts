import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import {
  PACS_VIEWER_PATHS,
  pacsViewerProxy,
} from './radiology/pacs-viewer.proxy';
import { PacsStudyAccessService } from './radiology/pacs-study-access.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
