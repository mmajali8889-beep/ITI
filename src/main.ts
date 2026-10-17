import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Don't advertise the framework, and stop browsers MIME-sniffing API responses.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: unknown, response: { setHeader(name: string, value: string): void }, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 4000);

  console.log('Hospital API running on http://localhost:4000');
}

bootstrap();
