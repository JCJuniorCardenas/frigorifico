import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'El email no es válido' })
  @MaxLength(200)
  email: string;

  @IsString({ message: 'La contraseña es obligatoria' })
  @MinLength(1, { message: 'La contraseña es obligatoria' })
  @MaxLength(200)
  password: string;
}
