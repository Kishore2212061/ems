import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { USER_MODEL, UserSchema } from '../users/user.schema';
import { ORGANIZATION_MODEL, OrganizationSchema } from './organization.schema';
import { SeedService } from './seed.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: USER_MODEL, schema: UserSchema },
      { name: ORGANIZATION_MODEL, schema: OrganizationSchema },
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
