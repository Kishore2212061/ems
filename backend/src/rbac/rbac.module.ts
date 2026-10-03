import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ORGANIZATION_MODEL, OrganizationSchema } from '../seed/organization.schema';
import { USER_MODEL, UserSchema } from '../users/user.schema';
import { RbacService } from './rbac.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: USER_MODEL, schema: UserSchema },
      { name: ORGANIZATION_MODEL, schema: OrganizationSchema },
    ]),
  ],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
