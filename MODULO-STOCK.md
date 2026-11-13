# MODULO-STOCK.md — Módulo 2: control de stock y ventas de carne

> Claude Code: este archivo **extiende** el proyecto existente. Leé primero `CLAUDE.md` (stack, convenciones, seguridad, estructura). Todo lo de ese archivo sigue vigente. Acá solo se define lo nuevo.

## 1. Contexto

El módulo 1 (control de facturas de faena) ya está terminado y en uso. Este módulo agrega el **control del negocio de la carnicería**: qué carne entra, cuántos kilos hay en stock, qué se vende, qué se pierde y cuánto se gana.

Mismo usuario principal (el dueño), misma autenticación, misma base de datos, mismo deploy. **No se crea una app nueva.**

## 2. Reglas para no romper lo existente

- No modificar el parser de facturas ni el modelo `Invoice`, salvo el vínculo opcional de la Fase 12.
- Todas las migraciones de Prisma son **aditivas** (tablas nuevas). Nada de borrar ni renombrar columnas existentes.
- Los módulos nuevos van en carpetas propias: `apps/api/src/stock/`, `catalog/`, `sales/`, `reports/`, y rutas propias en `apps/web`.
- Antes de cada fase: correr los tests del módulo 1. Si fallan, parar y avisar.

## 3. Alcance del MVP

Incluye:

1. Catálogo de productos (cortes) y proveedores.
2. Registro de **ingresos de mercadería** (kilos, costo, proveedor, fecha, tropa opcional).
3. **Stock actual** por producto, calculado a partir de movimientos.
4. Registro de **ventas** (kilos, precio por kg, forma de pago).
5. Registro de **mermas y ajustes** de stock con motivo.
6. **Reportes**: stock, ventas, ganancia bruta, merma, compras por proveedor.
7. Vínculo opcional entre un ingreso y la factura de faena (por número de tropa).

No incluye (por ahora): facturación electrónica ARCA, integración con balanza, múltiples sucursales, control de caja completo, cuentas corrientes de clientes, app móvil.

## 4. Decisiones de diseño

- **Stock como libro de movimientos.** No se guarda "stock actual" como número editable. Se guarda cada movimiento y el stock es la suma. Así hay auditoría y no se desincroniza.
- **Costo promedio ponderado** por producto para calcular la ganancia (más simple que FIFO). Dejar la lógica aislada en un servicio para poder cambiarla después.
- **Dinero y kilos siempre `Decimal`.** Prohibido `number`/float. Kilos con 3 decimales.
- Los movimientos **no se editan ni se borran**: se corrigen con un movimiento de ajuste. Excepción: anular una venta genera movimientos inversos.
- Venta que dejaría el stock en negativo: **advertir y pedir confirmación**, no bloquear (en la carnicería a veces se vende antes de cargar el ingreso).

## 5. Modelo de datos (Prisma, referencia)

```prisma
enum ProductUnit {
  KG
  UNIT
}

enum MovementType {
  PURCHASE   // ingreso de mercadería (+)
  SALE       // venta (-)
  WASTE      // merma (-)
  ADJUSTMENT // ajuste por conteo (+/-)
  SALE_VOID  // anulación de venta (+)
}

enum PaymentMethod {
  CASH
  TRANSFER
  CARD
  OTHER
}

model Supplier {
  id        String     @id @default(uuid())
  name      String
  cuit      String?
  phone     String?
  active    Boolean    @default(true)
  createdAt DateTime   @default(now())
  purchases Purchase[]
}

model Product {
  id        String      @id @default(uuid())
  name      String      @unique
  category  String?     // vacuno, cerdo, pollo, achuras, etc.
  unit      ProductUnit @default(KG)
  salePrice Decimal?    @db.Decimal(14, 2) // precio sugerido por kg
  active    Boolean     @default(true)
  createdAt DateTime    @default(now())
  movements StockMovement[]
}

model Purchase {
  id           String   @id @default(uuid())
  date         DateTime @db.Date
  supplierId   String
  supplier     Supplier @relation(fields: [supplierId], references: [id])
  herdNumber   String?  // número de tropa, para trazabilidad
  invoiceId    String?  // vínculo opcional a Invoice (módulo 1)
  notes        String?
  createdById  String
  createdAt    DateTime @default(now())
  items        PurchaseItem[]

  @@index([date])
  @@index([herdNumber])
}

model PurchaseItem {
  id         String   @id @default(uuid())
  purchaseId String
  purchase   Purchase @relation(fields: [purchaseId], references: [id], onDelete: Cascade)
  productId  String
  kg         Decimal  @db.Decimal(12, 3)
  costPerKg  Decimal  @db.Decimal(14, 2)
  totalCost  Decimal  @db.Decimal(14, 2)
}

model Sale {
  id            String        @id @default(uuid())
  date          DateTime      @db.Date
  customerName  String?
  paymentMethod PaymentMethod @default(CASH)
  total         Decimal       @db.Decimal(14, 2)
  voided        Boolean       @default(false)
  notes         String?
  createdById   String
  createdAt     DateTime      @default(now())
  items         SaleItem[]

  @@index([date])
}

model SaleItem {
  id          String  @id @default(uuid())
  saleId      String
  sale        Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId   String
  kg          Decimal @db.Decimal(12, 3)
  pricePerKg  Decimal @db.Decimal(14, 2)
  subtotal    Decimal @db.Decimal(14, 2)
  unitCost    Decimal @db.Decimal(14, 2) // costo promedio al momento de la venta (para el margen)
}

model StockMovement {
  id          String       @id @default(uuid())
  productId   String
  product     Product      @relation(fields: [productId], references: [id])
  type        MovementType
  kg          Decimal      @db.Decimal(12, 3) // con signo: + entra, - sale
  unitCost    Decimal?     @db.Decimal(14, 2)
  reason      String?      // obligatorio en WASTE y ADJUSTMENT
  refType     String?      // "Purchase" | "Sale"
  refId       String?
  date        DateTime     @db.Date
  createdById String
  createdAt   DateTime     @default(now())

  @@index([productId, date])
  @@index([refType, refId])
}
```

Reglas:

- Crear una compra genera un `PURCHASE` por ítem y recalcula el costo promedio del producto.
- Crear una venta genera un `SALE` por ítem (kg negativo) y guarda `unitCost` en `SaleItem`.
- Anular una venta marca `voided = true` y genera movimientos `SALE_VOID`. Las ventas anuladas no entran en reportes.
- `WASTE` y `ADJUSTMENT` exigen `reason`.

## 6. Pantallas

1. **Stock actual:** producto, kg disponibles, costo promedio, valor en stock. Alerta de stock bajo (umbral configurable por producto, opcional).
2. **Ingresos:** listado y alta (proveedor, fecha, tropa opcional, ítems con kg y costo por kg). Carga rápida con teclado.
3. **Ventas:** pantalla pensada para uso en mostrador: elegir producto, ingresar kg y precio (precarga el sugerido), agregar varios ítems, forma de pago, confirmar. Listado con filtro por fecha y opción de anular.
4. **Mermas y ajustes:** alta con producto, kg, motivo. Historial.
5. **Reportes:** ver sección 7.
6. **Catálogo:** productos y proveedores (alta, edición, desactivar; no borrar si tienen movimientos).

Formato argentino en toda la interfaz: `Intl.NumberFormat('es-AR')`, fechas `dd/mm/aaaa`, kilos con 3 decimales.

## 7. Reportes

Todos con filtro por rango de fechas (por defecto, mes actual) y **exportación a CSV**.

- **Stock valorizado:** kg y valor por producto.
- **Ventas del período:** total vendido, kg vendidos, cantidad de ventas, desglose por día, por producto y por forma de pago.
- **Ganancia bruta:** ventas menos costo de lo vendido (`kg × unitCost`), en importe y en porcentaje, por producto y total.
- **Mermas:** kg y valor perdido, % sobre lo comprado, por motivo.
- **Compras:** kg y monto por proveedor y por producto.
- **Resumen del dashboard:** ventas de hoy, ventas del mes, ganancia del mes, valor del stock, facturas de faena pendientes de pago (dato del módulo 1).

Todos los cálculos se hacen en el backend con `Decimal` y tienen tests.

## 8. API (referencia)

| Método | Ruta | Descripción |
|---|---|---|
| GET/POST | `/products` | Listar / crear producto |
| PATCH | `/products/:id` | Editar / desactivar |
| GET/POST | `/suppliers` | Listar / crear proveedor |
| PATCH | `/suppliers/:id` | Editar / desactivar |
| GET | `/stock` | Stock actual por producto |
| GET/POST | `/purchases` | Listar / crear ingreso |
| GET | `/purchases/:id` | Detalle |
| GET/POST | `/sales` | Listar / crear venta |
| POST | `/sales/:id/void` | Anular venta |
| GET/POST | `/stock/adjustments` | Listar / crear merma o ajuste |
| GET | `/reports/stock` | Stock valorizado |
| GET | `/reports/sales` | Ventas del período |
| GET | `/reports/profit` | Ganancia bruta |
| GET | `/reports/waste` | Mermas |
| GET | `/reports/purchases` | Compras |
| GET | `/reports/dashboard` | Resumen general |

Todas protegidas por el guard global. Escrituras para `USER` y `ADMIN`; borrados y anulaciones según el rol que se defina (por defecto, solo `ADMIN` anula).

## 9. Plan de desarrollo (continúa el del CLAUDE.md)

> Claude Code: **una fase por vez**. Al terminar, correr tests (incluidos los del módulo 1) y lint, resumir y **esperar confirmación**.

**Fase 7 — Catálogo.** Modelos `Product` y `Supplier`, CRUD y pantallas.
*Listo cuando:* se crean, editan y desactivan productos y proveedores; no se pueden borrar los que tienen movimientos.

**Fase 8 — Ingresos y stock.** `Purchase`, `PurchaseItem`, `StockMovement`, servicio de stock con costo promedio ponderado, pantalla de ingresos y de stock actual.
*Listo cuando:* cargar dos ingresos del mismo producto con distinto costo da el costo promedio correcto (test con valores concretos) y el stock coincide con la suma de movimientos.

**Fase 9 — Ventas.** `Sale`, `SaleItem`, pantalla de mostrador, advertencia de stock negativo, anulación.
*Listo cuando:* una venta descuenta stock y guarda el costo unitario; anularla restituye el stock exacto.

**Fase 10 — Mermas y ajustes.** Alta con motivo obligatorio e historial.
*Listo cuando:* una merma baja el stock y aparece en el reporte de mermas.

**Fase 11 — Reportes y dashboard.** Los reportes de la sección 7, con exportación a CSV.
*Listo cuando:* con datos de prueba, ganancia = ventas − costo vendido coincide con un cálculo manual, y los totales del dashboard coinciden con la suma de los listados.

**Fase 12 — Integración con facturas y pulido.** Vínculo opcional ingreso ↔ factura por número de tropa (sugerir automáticamente al cargar un ingreso con tropa existente), estados vacíos, manejo de errores, README actualizado, backup verificado.
*Listo cuando:* un ingreso con tropa `15005` muestra un acceso directo a la factura correspondiente.

**Fase 13 (opcional, solo si el cliente la pide) — Despostada.** Registrar el desposte de una media res en cortes, con kilos por corte y merma, y calcular el **rendimiento**. Los cortes resultantes entran al stock con el costo repartido.

## 10. Criterios de aceptación globales

- El stock de cualquier producto es igual a la suma de sus movimientos, siempre.
- Ningún importe ni kilo pasa por tipos de punto flotante.
- Anular una venta no deja inconsistencias en stock ni en reportes.
- Los tests del módulo 1 siguen pasando después de cada fase.
- Las migraciones son aditivas y se pueden aplicar sobre la base en producción sin perder datos.

## 11. Preguntas abiertas (confirmar con el cliente antes de la Fase 8)

- ¿Compra **media res** y la desposta en el local, o compra **cortes** ya hechos? (define si hace falta la Fase 13)
- ¿Quiere controlar **merma y rendimiento**?
- ¿Registra solo ventas, o también **gastos y caja** (sueldos, luz, alquiler)?
- ¿Las ventas tienen **cliente** identificado o son todas de mostrador?
- ¿Vende **a cuenta corriente** (fiado) a algunos clientes?
- ¿Cuántas ventas por día aproximadamente? (define cuán rápida debe ser la pantalla de mostrador)
- ¿Qué reportes mira hoy, aunque sea en un cuaderno o una planilla?
