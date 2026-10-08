import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Etiquetas en orden: primero las del contrato alojamientos-openapi.yaml y al final las internas.
  const config = new DocumentBuilder()
    .setTitle('Cozy - Alojamientos Core API')
    .setDescription(
      'Microservicio de alojamientos del Booking Prototipo: búsqueda, disponibilidad y precios, detalle de la ficha y ' +
        'reservas (órdenes: preview, create, get y cancel).\n\n' +
        'Las rutas de las secciones del contrato siguen contracts/alojamientos-openapi.yaml (API-first). ' +
        'La sección "Interno - Admin" es el CRUD de administración y NO forma parte del contrato.\n\n' +
        'Estado: /search, /availability, /details y el flujo de órdenes (preview, create, get, cancel) usan datos reales. ' +
        'El resto de rutas del contrato (bulk-availability, details/changes, chains, constants, reviews, modify, webhooks) ' +
        'devuelve datos de relleno. La autenticación OAuth2 está pendiente: ninguna ruta pide token todavía.\n\n' +
        'Errores: application/problem+json (ProblemDetails) en las rutas del contrato implementadas. ' +
        'El prefijo /api/v1 es nuestro; en el contrato las rutas no lo llevan.',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Local (desarrollo)')
    .addTag('Búsqueda y Catálogo', 'Contrato: búsqueda, detalles, cadenas y reseñas')
    .addTag('Disponibilidad y Precios', 'Contrato: disponibilidad y precios por fechas')
    .addTag('Gestión de Órdenes (Reservas)', 'Contrato: preview, create, get, modify y cancel de órdenes')
    .addTag('Componentes Comunes', 'Contrato: constantes del sistema')
    .addTag('Webhooks', 'Contrato: suscripciones a eventos')
    .addTag('Interno - Admin', 'NO es parte del contrato: CRUD de administración de alojamientos y ciudades')
    .addOAuth2(
      {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://auth.booking-hub.com/oauth2/authorize',
            tokenUrl: 'https://auth.booking-hub.com/oauth2/token',
            scopes: {
              'alojamientos:read': 'Leer información de alojamientos, disponibilidades y reservas',
              'alojamientos:book': 'Crear y alterar reservas',
              'alojamientos:cancel': 'Cancelar reservas',
              'alojamientos:webhooks': 'Gestionar webhooks',
            },
          },
        },
      },
      'OAuth2Security',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
