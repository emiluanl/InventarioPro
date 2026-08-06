// =============================================================================
// CategoriesController
// =============================================================================

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

import { CategoriesService, CreateCategoryDto, UpdateCategoryDto } from './categories.service';
import { CurrentUser, AuthUser } from '../auth/decorators/current-user.decorator';

class CreateCategoryBody implements CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nombre!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icono?: string;
}

class UpdateCategoryBody implements UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icono?: string;
}

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Devuelve categorías del sistema + personalizadas del usuario. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.categories.listForUser(user.id);
  }

  /** Crea una categoría personalizada del usuario. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryBody) {
    return this.categories.create(user.id, dto);
  }

  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCategoryBody) {
    return this.categories.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.categories.remove(user.id, id);
  }
}
