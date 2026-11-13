# Fixtures

PDFs de facturas para los tests del parser (`apps/api/src/invoices/parser`).

**Los PDFs no se versionan** porque contienen datos reales (CUIT, razón social, domicilios).
Para correr los tests que los usan, copiá el PDF de ejemplo en esta carpeta con este nombre:

- `27252783119_001_00004_00000115.pdf` — factura A, punto de venta 00004, comprobante 00000115

Si el archivo no está, esos tests se saltean (el resto de la suite corre igual).
