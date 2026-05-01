import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = NestFactory.create(AppModule);
  const nestApp = await app;
  nestApp.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  nestApp.enableCors();
  await nestApp.listen(process.env.PORT ?? 3000);
}
bootstrap();
