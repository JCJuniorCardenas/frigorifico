# CLAUDE.md — Sistema de control de facturas de faena

## 1. Contexto del proyecto

Sistema web para un frigorífico (servicio de faena) que factura a distintos clientes (supermercados, carnicerías, etc.). El dueño necesita **arrastrar PDFs de facturas** a la web y ver, en una tabla de control, los datos principales **sin abrir cada PDF**.

- **Un solo emisor** (el frigorífico), por lo tanto **un solo formato de factura** (factura electrónica ARCA, tipo A, generada digitalmente con texto seleccionable).
- Los clientes son un dato más de cada factura (el receptor del comprobante).
- Usuarios: el dueño (ADMIN) crea y gestiona usuarios; los usuarios autorizados suben y consultan facturas.

Idioma de la interfaz, mensajes y comentarios de dominio: **español (Argentina)**. Nombres de código (variables, clases, endpoints): **inglés**, salvo términos de dominio como `tropa` y `faena`.

## 2. Alcance del MVP

Incluye:

1. Login con usuarios y roles (ADMIN / USER). Sin registro público: el ADMIN crea los usuarios.
2. Carga de PDFs por drag & drop (uno o varios a la vez).
3. Extracción automática de datos con reglas fijas (sin IA).
4. Pantalla de revisión/edición antes de confirmar el guardado.
5. Tabla de control con búsqueda, filtros, orden y paginación.
6. Descarga/visualización del PDF original desde la tabla.
7. **Control de pagos:** marcar facturas como pagadas (y revertir), con fecha de pago.
8. **Control de vencimientos:** alerta visual de facturas próximas a vencer o vencidas (solo las pendientes).

No incluye (por ahora): OCR de escaneos, facturación, notas de crédito, múltiples emisores, app móvil.

## 3. Stack

| Capa            | Tecnología                                           |
| --------------- | ---------------------------------------------------- |
| Backend         | Node.js + NestJS + TypeScript                        |
| Base de datos   | PostgreSQL + Prisma                                  |
| Frontend        | Next.js (App Router) + React + TypeScript + Tailwind |
| Auth            | JWT en cookie httpOnly + refresh, hash con argon2    |
| Extracción PDF  | `pdfjs-dist` (texto con coordenadas)                 |
| Upload          | Multer (backend) + `react-dropzone` (frontend)       |
| Validación      | `class-validator` / `zod`                            |
| Tests           | Jest (backend), Vitest/Playwright (frontend)         |
| Deploy sugerido | Railway (API + Postgres) y Vercel o Railway (web)    |

Storage de PDFs: abstraer detrás de una interfaz `StorageService`. En desarrollo, disco local; en producción, volumen persistente o bucket S3-compatible (Cloudflare R2). **Nunca** guardar PDFs dentro del repositorio.

## 4. Modelo de datos (Prisma, referencia)

```prisma
enum Role {
  ADMIN
  USER
}

enum InvoiceStatus {
  PENDING
  PAID
}

model User {
  id           String    @id @default(uuid())
  name         String
  email        String    @unique
  passwordHash String
  role         Role      @default(USER)
  active       Boolean   @default(true)
  createdAt    DateTime  @default(now())
  invoices     Invoice[] @relation("UploadedBy")
  paidInvoices Invoice[] @relation("PaidBy")
}

model Invoice {
  id                 String        @id @default(uuid())
  salesPoint         String        // "00004"
  voucherNumber      String        // "00000115"
  issueDate          DateTime      @db.Date
  paymentDueDate     DateTime      @db.Date
  clientName         String        // Razón social del receptor
  clientCuit         String        // 11 dígitos, sin guiones
  herdNumber         String        // número de tropa, ej "15005"
  slaughterKg        Decimal       @db.Decimal(12, 2)
  totalAmount        Decimal       @db.Decimal(14, 2)
  netTaxedAmount     Decimal       @db.Decimal(14, 2)
  vat21Amount        Decimal       @db.Decimal(14, 2)
  exemptAmount       Decimal       @db.Decimal(14, 2)
  cae                String
  caeDueDate         DateTime      @db.Date
  status             InvoiceStatus @default(PENDING)
  paidAt             DateTime?     @db.Date // fecha en que se cobró (editable)
  paidById           String?       // usuario que la marcó como pagada
  paidBy             User?         @relation("PaidBy", fields: [paidById], references: [id])
  pdfKey             String        // clave en el storage
  pdfHash            String        @unique // sha256 del archivo
  needsReview        Boolean       @default(false)
  uploadedById       String
  uploadedBy         User          @relation("UploadedBy", fields: [uploadedById], references: [id])
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@unique([salesPoint, voucherNumber])
  @@index([herdNumber])
  @@index([clientName])
  @@index([paymentDueDate])
  @@index([status])
}
```

Registro de cambios de estado (auditoría):

```prisma
model InvoiceStatusLog {
  id         String        @id @default(uuid())
  invoiceId  String
  invoice    Invoice       @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  fromStatus InvoiceStatus
  toStatus   InvoiceStatus
  changedById String
  changedAt  DateTime      @default(now())
}
```

(Agregar `statusLogs InvoiceStatusLog[]` en `Invoice`.)

Reglas:

- **Pagos:** al marcar `PAID` se guarda `paidAt` (por defecto hoy, editable) y `paidById`. Al revertir a `PENDING` se limpian ambos. Cada cambio de estado genera un `InvoiceStatusLog`.
- Dinero y kg siempre como `Decimal`. **Prohibido usar `number`/float para importes.**
- `herdNumber` es único por factura en la práctica, pero se indexa y se **avisa** si hay duplicado (no se bloquea, para no trabar casos reales).
- Duplicados bloqueados por `pdfHash` y por `(salesPoint, voucherNumber)`.

## 5. Formato del PDF y mapeo de campos

El PDF de ejemplo (`27252783119_001_00004_00000115.pdf`) trae **3 páginas con la misma factura**: `ORIGINAL`, `DUPLICADO` y `TRIPLICADO`. Reglas:

- **Procesar solo la página 1** (`ORIGINAL`).
- Verificar que las páginas 2 y 3 tengan el mismo `Comp. Nro` y el mismo `Importe Total`; si no coinciden, marcar `needsReview = true`.
- Rechazar PDFs que no sean `FACTURA` tipo `A` (código 01) con error claro.

### Campos a extraer (ejemplo real)

| Campo del sistema | Dónde está en el PDF                           | Valor del ejemplo |
| ----------------- | ---------------------------------------------- | ----------------- |
| `salesPoint`      | `Punto de Venta:`                              | `00004`           |
| `voucherNumber`   | `Comp. Nro:`                                   | `00000115`        |
| `issueDate`       | `Fecha de Emisión:`                            | `12/11/2026`      |
| `paymentDueDate`  | `Fecha de Vto. para el pago:`                  | `12/11/2026`      |
| `clientCuit`      | `CUIT:` del bloque **receptor** (segundo CUIT) | `30714542431`     |
| `clientName`      | `Apellido y Nombre / Razón Social:`            | `LA BELGRANO SRL` |
| `herdNumber`      | línea de ítem `Servicio faena tropa NNNNN`     | `15005`           |
| `slaughterKg`     | `Cantidad` de la línea de faena (unidad `kg`)  | `811,00`          |
| `totalAmount`     | `Importe Total: $`                             | `439211,86`       |
| `netTaxedAmount`  | `Importe Neto Gravado: $`                      | `348730,00`       |
| `vat21Amount`     | `IVA 21%: $`                                   | `73233,30`        |
| `exemptAmount`    | `Importe Exento: $`                            | `17248,56`        |
| `cae`             | `CAE N°:`                                      | `86462412597429`  |
| `caeDueDate`      | `Fecha de Vto. de CAE:`                        | `22/11/2026`      |

Atención a las trampas:

- **El primer CUIT es del emisor** (el frigorífico, `27252783119`). El cliente es el **segundo** bloque CUIT/razón social. No confundirlos.
- `Fecha de Vto. para el pago` **no** es `Fecha de Vto. de CAE`. La que se muestra en la tabla como vencimiento es la de **pago**.
- Formato numérico argentino: coma decimal y **sin separador de miles** en este PDF (`439211,86`). El parser debe aceptar también `1.234.567,89`.
- Fechas `dd/mm/yyyy` → parsear manualmente, nunca con `new Date(string)`.
- Si hay más de una línea de faena en una misma factura, sumar kg y marcar `needsReview = true`, porque la regla "una tropa por factura" no se cumple.

### Estrategia de extracción

1. Extraer los items de texto con coordenadas (`pdfjs-dist`, `getTextContent`) solo de la página 1.
2. Reconstruir líneas agrupando por coordenada Y y ordenando por X.
3. Aplicar parsers por campo, cada uno con su regex y su test.
4. Ejecutar validaciones cruzadas (sección 6).
5. Devolver un objeto `ParsedInvoice` con los valores y una lista `warnings[]`.

Referencia de regex (ajustar contra el PDF real):

```ts
const HERD_LINE = /Servicio\s+faena\s+tropa\s+(\d+)\s+([\d.,]+)\s+kg/i;
const TOTAL = /Importe\s+Total:\s*\$\s*([\d.,]+)/i;
const VOUCHER = /Punto\s+de\s+Venta:\s*(\d{5})\s+Comp\.\s*Nro:\s*(\d{8})/i;
const CAE = /CAE\s+N°:\s*(\d{14})/i;
```

Funciones utilitarias obligatorias (con tests unitarios):

```ts
parseArgentineDecimal('439211,86'); // -> "439211.86"
parseArgentineDecimal('1.234.567,89'); // -> "1234567.89"
parseArgentineDate('12/11/2026'); // -> 2026-11-12 (Date, sin corrimiento de zona horaria)
```

## 6. Validaciones cruzadas (anti-errores)

Si alguna falla, no se descarta: se marca `needsReview = true` y se muestra la advertencia en la pantalla de revisión.

- `netTaxedAmount + vat21Amount + exemptAmount + otrosTributos == totalAmount` (ejemplo: 348730,00 + 73233,30 + 17248,56 = 439211,86).
- `slaughterKg × precio unitario == subtotal` de la línea de faena (ejemplo: 811 × 430 = 348730).
- CUIT del cliente con 11 dígitos y dígito verificador válido.
- CUIT del emisor igual al configurado en `ISSUER_CUIT` (variable de entorno); si no coincide, advertencia.
- `paymentDueDate >= issueDate`.
- `herdNumber` ya existente en otra factura → advertencia de posible duplicado.

## 7. Flujo de carga

1. El usuario arrastra uno o varios PDFs.
2. Backend valida: tipo MIME `application/pdf`, extensión, **máximo 5 MB por archivo**, firma `%PDF`, y calcula el hash.
3. Si el hash o `(salesPoint, voucherNumber)` ya existen → responde 409 indicando qué factura es.
4. Extrae y valida; devuelve el borrador (`ParsedInvoice` + `warnings`), todavía sin guardar.
5. El frontend muestra la pantalla de revisión con el PDF a un costado y los campos editables.
6. El usuario confirma → se guarda la factura y se sube el PDF al storage.
7. Carga múltiple: cola con estado por archivo (procesando / listo para revisar / error / duplicado).

## 8. Pantalla principal (tabla de control)

Columnas: **Cliente · N° de tropa · Kg de faena · Importe total · Fecha de vencimiento · N° de comprobante · Estado · Acciones**.

- Búsqueda por cliente, tropa o número de comprobante.
- Filtros por rango de fechas, cliente y estado (todas / pendientes / pagadas / vencidas).
- Por defecto la tabla abre mostrando **pendientes**, ordenadas por vencimiento más próximo.
- Orden por cualquier columna; paginación en el servidor.
- Orden de prioridad en el resaltado de **vencimientos** (solo facturas `PENDING`):
  - Vencida (`paymentDueDate < hoy`): rojo, con los días de atraso.
  - Vence en 3 días o menos: amarillo.
  - Pagada: verde/neutro, **sin alertas de vencimiento**, mostrando la fecha de pago.
- "Hoy" se calcula en zona horaria `America/Argentina/Buenos_Aires`.
- Tarjetas de resumen arriba de la tabla: **total pendiente de cobro**, **total vencido**, **vence esta semana** y **cobrado en el mes**, con cantidad de facturas e importe.
- Totales del filtro aplicado (suma de kg y de importes).
- **Marcar como pagada:** botón/checkbox en cada fila que abre un diálogo corto con la fecha de pago (por defecto hoy). Permitir **marcado masivo** seleccionando varias filas. Revertir a pendiente con confirmación.
- Acción para ver el PDF, editar y eliminar (eliminar solo ADMIN, con confirmación).
- Cada cambio de estado se registra (quién y cuándo) para poder auditarlo.
- Importes con formato `es-AR` (`Intl.NumberFormat`), fechas `dd/mm/aaaa`.

## 9. API (referencia)

| Método | Ruta                    | Descripción                                                   | Rol         |
| ------ | ----------------------- | ------------------------------------------------------------- | ----------- |
| POST   | `/auth/login`           | Login                                                         | público     |
| POST   | `/auth/logout`          | Logout                                                        | autenticado |
| GET    | `/users`                | Listar usuarios                                               | ADMIN       |
| POST   | `/users`                | Crear usuario                                                 | ADMIN       |
| PATCH  | `/users/:id`            | Editar/desactivar/resetear clave                              | ADMIN       |
| POST   | `/invoices/parse`       | Sube PDF y devuelve borrador sin guardar                      | USER+       |
| POST   | `/invoices`             | Confirma y guarda factura                                     | USER+       |
| GET    | `/invoices`             | Listado con filtros y paginación                              | USER+       |
| GET    | `/invoices/:id`         | Detalle                                                       | USER+       |
| GET    | `/invoices/:id/pdf`     | Stream del PDF                                                | USER+       |
| PATCH  | `/invoices/:id`         | Editar datos                                                  | USER+       |
| PATCH  | `/invoices/:id/status`  | Marcar pagada/pendiente (`{ status, paidAt? }`)               | USER+       |
| POST   | `/invoices/status/bulk` | Marcado masivo de estado                                      | USER+       |
| GET    | `/invoices/summary`     | Totales: pendiente, vencido, vence en 7 días, cobrado del mes | USER+       |
| DELETE | `/invoices/:id`         | Eliminar                                                      | ADMIN       |

## 10. Seguridad

- Todas las rutas protegidas por guard global; solo `/auth/login` es pública.
- Rate limiting en login y en upload (`@nestjs/throttler`).
- Contraseñas con argon2; nunca loguear contraseñas ni tokens.
- Cookies `httpOnly`, `secure` y `sameSite` en producción; CORS restringido al dominio del frontend.
- El PDF se sirve solo a usuarios autenticados (nada de URLs públicas permanentes).
- Se parsea el PDF como texto: **no ejecutar ni renderizar contenido activo** del archivo.
- Secretos solo por variables de entorno; mantener `.env.example` actualizado y `.env` en `.gitignore`.

## 11. Estructura del repositorio

```
/
├── apps/
│   ├── api/                # NestJS
│   │   └── src/
│   │       ├── auth/
│   │       ├── users/
│   │       ├── invoices/
│   │       │   ├── parser/ # extracción + validaciones + tests con PDFs de muestra
│   │       │   └── ...
│   │       ├── storage/
│   │       └── common/
│   └── web/                # Next.js
├── fixtures/               # PDFs de muestra (anonimizados) para tests
├── CLAUDE.md
└── README.md
```

## 12. Convenciones

- TypeScript en modo `strict`. Sin `any` salvo justificación comentada.
- Módulos NestJS chicos y con una responsabilidad; lógica de negocio en servicios, no en controladores.
- DTOs validados en cada endpoint; nunca confiar en el input del cliente.
- Commits en formato Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`).
- ESLint + Prettier obligatorios; correr lint y tests antes de cada commit.
- Errores de la API con formato consistente y mensajes en español para el usuario final.
- Cada parser de campo tiene su test unitario con el PDF de ejemplo y casos borde.

## 13. Plan de desarrollo (hacer paso por paso)

> Claude Code: ejecutá **una fase por vez**. Al terminar cada una, correr tests y lint, resumir qué se hizo y **esperar confirmación** antes de pasar a la siguiente.

**Fase 0 — Setup.** Monorepo, NestJS, Next.js, Prisma + Postgres local (Docker Compose), ESLint/Prettier, `.env.example`.
_Listo cuando:_ `docker compose up` levanta la DB y ambas apps arrancan.

**Fase 1 — Auth y usuarios.** Modelo `User`, login/logout, guards por rol, seed del primer ADMIN, CRUD de usuarios (solo ADMIN), pantalla de login y de gestión de usuarios.
_Listo cuando:_ un USER no puede acceder a rutas de ADMIN y las contraseñas están hasheadas.

**Fase 2 — Parser de facturas.** Servicio de extracción según las secciones 5 y 6, con el PDF de `fixtures/`. Aún sin UI.
_Listo cuando:_ los 14 campos del ejemplo se extraen exactos, las validaciones cruzadas pasan y hay tests de casos borde (PDF que no es factura, PDF corrupto, número con miles).

**Fase 3 — Subida y guardado.** Endpoints `/invoices/parse` y `/invoices`, `StorageService`, detección de duplicados.
_Listo cuando:_ subir el mismo PDF dos veces devuelve 409.

**Fase 4 — Frontend de carga.** Dropzone, cola de archivos múltiples, pantalla de revisión con PDF al costado y campos editables.
_Listo cuando:_ se puede cargar una factura de punta a punta y corregir un campo antes de guardar.

**Fase 5 — Tabla de control, pagos y vencimientos.** Listado, búsqueda, filtros, orden, paginación, tarjetas de resumen, resaltado de vencimientos, marcar pagada/pendiente (individual y masivo) con fecha de pago, registro de cambios, ver PDF.
_Listo cuando:_ con 500 facturas de prueba la tabla responde fluida, una factura pagada deja de mostrar alerta de vencimiento y las tarjetas de resumen coinciden con la suma real de las filas.

**Fase 6 — Pulido y deploy.** Rate limiting, manejo de errores, estados vacíos y de carga, README, deploy y backups de la base y de los PDFs.
_Listo cuando:_ está en producción con HTTPS y un backup restaurable probado.

## 14. Criterios de aceptación globales

- Subir el PDF de ejemplo carga: cliente `LA BELGRANO SRL`, tropa `15005`, `811,00` kg, total `$439.211,86`, vencimiento `12/11/2026`.
- Ninguna factura se guarda duplicada.
- Ningún importe pasa por tipos de punto flotante.
- Un usuario sin sesión no puede ver datos ni PDFs.
- Todo dato extraído es editable antes de guardar.
- Marcar una factura como pagada guarda fecha y usuario, la saca de "pendientes" y de las alertas de vencimiento; revertirla la devuelve a pendiente.
- Las facturas pendientes vencidas se ven en rojo con los días de atraso, y el total vencido coincide con la suma de esas filas.

## 15. Preguntas abiertas (confirmar con el cliente)

- ¿Las facturas de **más de una tropa** son posibles?
- ¿Cuántas facturas por mes se cargan (para dimensionar el storage)?
- ¿Cuántos usuarios van a usar el sistema?
