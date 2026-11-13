import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../common/auth-user.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';

/** Campos públicos de un usuario: nunca exponer passwordHash ni tokenVersion. */
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

const EMAIL_TAKEN = 'Ya existe un usuario con ese email';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateUserDto): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          role: dto.role ?? 'USER',
          passwordHash: await argon2.hash(dto.password),
        },
        select: publicUserSelect,
      });
    } catch (error) {
      throw mapUniqueEmailError(error);
    }
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser): Promise<PublicUser> {
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Usuario no encontrado');

    // Evita que un ADMIN se deje afuera del sistema a sí mismo.
    if (id === actor.id) {
      if (dto.active === false) {
        throw new BadRequestException('No podés desactivar tu propio usuario');
      }
      if (dto.role && dto.role !== 'ADMIN') {
        throw new BadRequestException('No podés quitarte el rol de administrador');
      }
    }

    const data: Prisma.UserUpdateInput = {
      name: dto.name,
      email: dto.email,
      role: dto.role,
      active: dto.active,
    };
    // Resetear la clave, desactivar o cambiar el rol cierra las sesiones abiertas del usuario.
    const revokeSessions =
      dto.password !== undefined ||
      (dto.active === false && current.active) ||
      (dto.role !== undefined && dto.role !== current.role);
    if (dto.password !== undefined) {
      data.passwordHash = await argon2.hash(dto.password);
    }
    if (revokeSessions) {
      data.tokenVersion = { increment: 1 };
    }

    try {
      return await this.prisma.user.update({ where: { id }, data, select: publicUserSelect });
    } catch (error) {
      throw mapUniqueEmailError(error);
    }
  }
}

function mapUniqueEmailError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException(EMAIL_TAKEN);
  }
  return error;
}
