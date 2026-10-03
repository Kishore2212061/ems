import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { env } from '../config/env';
import { USER_MODEL, UserSchema } from '../users/user.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt.guard';
import { OtpService } from './otp.service';
import { OTP_MODEL, OtpCodeSchema } from './schemas/otp-code.schema';
import { REFRESH_TOKEN_MODEL, RefreshTokenSchema } from './schemas/refresh-token.schema';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_ACCESS_SECRET,
      signOptions: { algorithm: 'HS256', issuer: 'ems' },
      verifyOptions: { algorithms: ['HS256'], issuer: 'ems' },
    }),
    MongooseModule.forFeature([
      { name: USER_MODEL, schema: UserSchema },
      { name: OTP_MODEL, schema: OtpCodeSchema },
      { name: REFRESH_TOKEN_MODEL, schema: RefreshTokenSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [TokenService, MongooseModule],
})
export class AuthModule {}
