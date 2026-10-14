# Pendientes para la versión 1.1.0 del contrato

El contrato `contracts/alojamientos-openapi.yaml` (versión 1.0.0) **no se modifica** en este repositorio. Los
autores del contrato respondieron cinco dudas; el backend ya aplica esas respuestas. Esta nota lista lo que
debe revisarse cuando llegue la versión 1.1.0.

## Respuestas oficiales aplicadas en el backend

| # | Tema | Respuesta oficial | Cómo quedó el backend |
|---|---|---|---|
| 1 | `product_id` | El formato `<habitacion-uuid>:<checkin>:<checkout>` es válido; sin espacios y como máximo unos 200 caracteres. `/details` y el detalle de la orden pueden devolver un UUID simple | `/availability` emite unos 58 caracteres sin espacios. `OrderPreviewRequestDto` rechaza más de 200 caracteres o espacios (400) |
| 2 | Campos extra en el cuerpo | Se ignoran; no es 400. Sigue siendo 400 si falta un obligatorio o el tipo es incorrecto | Rutas del contrato: `ValidationPipe` con `whitelist: true` y `forbidNonWhitelisted: false` (`problems/validacion.pipes.ts`). Rutas internas de admin: siguen rechazando campos extra |
| 3 | `customer_details` | Obligatorios `first_name` y `last_name` (no vacíos) y `email` (formato válido). Otros campos, como teléfono, son opcionales | `CustomerDetailsDto`. Errores: 400 `VALIDATION_FAILED` con `invalidParams`, p. ej. `{ "name": "customer_details.email", "reason": "formato inválido" }`. Los campos opcionales se ignoran porque no se usan |
| 4 | 404 | Estado 404 con `code: NOT_FOUND` | `RecursoNoEncontradoException` y `ProblemDetailsFilter` usan `NOT_FOUND` |
| 5 | Códigos de estado | 201 solo en `POST /orders/create` y `POST /webhooks`; 200 en el resto de POST | `@HttpCode(200)` en todas las demás rutas POST del contrato |

## Qué cambiar cuando llegue el contrato 1.1.0

1. **Enum `code` de `ProblemDetails`:** confirmar que incluye `NOT_FOUND`. Hoy el backend ya lo envía, pero un
   cliente que valide las respuestas estrictamente contra la versión 1.0.0 lo rechazaría, porque no está en
   el enum. Al actualizar: quitar los comentarios "llega en la versión 1.1.0" de
   `problems/problem-details.exceptions.ts`, `problems/problem-details.filter.ts`, `dto/problem-details.dto.ts`
   y de la descripción de Swagger en `src/main.ts`.
2. **Respuestas 404:** revisar si el contrato agrega `ProblemDetails404` a `/availability`, `/details`,
   `/orders/preview` y `/orders/{orderId}/cancel` (hoy solo lo declara en `GET /orders/{orderId}`).
3. **`product_id`:** revisar si la versión nueva documenta el formato, el máximo de 200 caracteres y la
   restricción de espacios. Si fija otro límite, ajustar `@MaxLength` en `dto/order-preview.dto.ts`.
4. **`customer_details`:** revisar si marca `required: [first_name, last_name, email]` y `format: email`, y si
   agrega campos opcionales (teléfono). Si los agrega y queremos guardarlos, hace falta una columna nueva en
   `ordenes`.
5. **Campos extra:** revisar si la versión nueva declara `additionalProperties: true` en los cuerpos de
   petición, para que quede escrito lo que ya respondieron.
6. **422 por `Idempotency-Key` reutilizada:** sigue sin código propio; hoy se envía `VALIDATION_FAILED`.
   Conviene preguntar si 1.1.0 agrega un valor para este caso.
7. **`DELETE /webhooks/{id}`:** las respuestas oficiales solo hablan de POST; se dejó en 204, como dice el
   contrato 1.0.0.
8. **Preview reutilizado:** un segundo `POST /orders/create` con **otra** `Idempotency-Key` sobre un
   `order_preview_id` que ya dio una orden responde 409 con `code: ROOM_NO_LONGER_AVAILABLE`, el valor más
   cercano del enum actual. Sugerencia para 1.1.0: un código propio, `PREVIEW_ALREADY_USED`, para que el cliente
   distinga "pide un preview nuevo" de "ya no hay cupo". Al llegar, cambiarlo en `OrdenesService.previewYaUsado`
   y en `problems/errores-base-datos.filter.ts` (caso `UQ_ordenes_previewId`).
9. **`url` de `/search` y `/availability`:** devuelven `/api/v1/alojamientos/{id}`. Desde el paso 7B el CRUD
   interno vive en `/api/v1/admin/alojamientos`, así que ese `url` ya no apunta a ninguna ruta. Se dejó igual
   para no cambiar las respuestas del contrato. Hay que definir con los autores a qué debe apuntar (por ejemplo,
   una ficha pública del alojamiento) y cambiarlo en `urlAlojamiento` de `alojamientos-consulta.utils.ts`.
