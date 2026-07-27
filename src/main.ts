import { NestFactory } from '@nestjs/core';
import { json, static as serveStatic, urlencoded } from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.use(
    '/uploads',
    serveStatic(resolve(process.cwd(), 'storage', 'public-uploads'), {
      fallthrough: false,
      immutable: false,
      maxAge: '1h',
    }),
  );
  app.enableCors({
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
