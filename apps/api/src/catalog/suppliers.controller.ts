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
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto.js';
import { type SupplierView, SuppliersService } from './suppliers.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  findAll(@Query() query: ListCatalogDto): Promise<SupplierView[]> {
    return this.suppliers.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto): Promise<SupplierView> {
    return this.suppliers.create(dto);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateSupplierDto): Promise<SupplierView> {
    return this.suppliers.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', uuid) id: string): Promise<void> {
    return this.suppliers.remove(id);
  }
}
