import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../common/auth-user.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CreateSaleDto, ListSalesQueryDto, VoidSaleDto } from './dto/sale.dto.js';
import { type SaleDetail, type SaleListResponse, SalesService } from './sales.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(@Query() query: ListSalesQueryDto): Promise<SaleListResponse> {
    return this.sales.list(query);
  }

  @Post()
  create(@Body() dto: CreateSaleDto, @CurrentUser() user: AuthUser): Promise<SaleDetail> {
    return this.sales.create(dto, user.id);
  }

  @Get(':id')
  findOne(@Param('id', uuid) id: string): Promise<SaleDetail> {
    return this.sales.findOne(id);
  }

  /** Anular es solo para ADMIN (MODULO-STOCK.md §8). */
  @Roles('ADMIN')
  @Post(':id/void')
  @HttpCode(200)
  void(
    @Param('id', uuid) id: string,
    @Body() dto: VoidSaleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SaleDetail> {
    return this.sales.void(id, dto.reason, user.id);
  }
}
