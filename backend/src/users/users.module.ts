import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { AdminInvitesController, PublicInvitesController } from '../invites/invites.controller';
import { INVITE_MODEL, InviteSchema } from '../invites/invite.schema';
import { InvitesService } from '../invites/invites.service';
import { RoleScopes } from './roles';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** People: profile, directory, roles, invites. */
@Module({
  imports: [AuthModule, GlobalEventsModule, MongooseModule.forFeature([{ name: INVITE_MODEL, schema: InviteSchema }])],
  controllers: [UsersController, AdminInvitesController, PublicInvitesController],
  providers: [UsersService, InvitesService, RoleScopes],
})
export class UsersModule {}
