import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { REGISTRATION_LOCK_MODEL, REGISTRATION_MODEL, RegistrationLockSchema, RegistrationSchema } from './registration.schema';
import { AdminRegistrationsController, RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

/** Sign-ups for department events: teams, seat holds, time clashes. Events, fests and users come from GlobalEventsModule. */
@Module({
  imports: [
    GlobalEventsModule,
    MongooseModule.forFeature([
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
      { name: REGISTRATION_LOCK_MODEL, schema: RegistrationLockSchema },
    ]),
  ],
  controllers: [RegistrationsController, AdminRegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
