import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ListCatalogDto } from './dto/list-catalog.dto.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { type ProductView, ProductsService } from './products.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  findAll(@Query() query: ListCatalogDto): Promise<ProductView[]> {
    return this.products.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductView> {
    return this.products.create(dto);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateProductDto): Promise<ProductView> {
    return this.products.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string): Promise<void> {
    return this.products.remove(id);
  }
}
