import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';
import { SuppliersController } from './suppliers.controller.js';
import { SuppliersService } from './suppliers.service.js';

/** Catálogo del módulo de stock: productos (cortes) y proveedores. */
@Module({
  controllers: [ProductsController, SuppliersController],
  providers: [ProductsService, SuppliersService],
  exports: [ProductsService, SuppliersService],
})
export class CatalogModule {}
