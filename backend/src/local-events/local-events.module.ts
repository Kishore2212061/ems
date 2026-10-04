import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { TICKET_MODEL, TicketSchema } from '../tickets/ticket.schema';
import { EventSeedService } from './event-seed.service';
import { AdminLocalEventsController, PublicLocalEventsController } from './local-events.controller';
import { LocalEventsService } from './local-events.service';

/** Department events inside a fest. The model is registered by GlobalEventsModule (fests need it too: publish, clone). */
@Module({
  // Registrations: an event's time change or cancellation updates its registrants' schedules.
  imports: [GlobalEventsModule, MongooseModule.forFeature([
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
      { name: TICKET_MODEL, schema: TicketSchema },
    ])],
  controllers: [PublicLocalEventsController, AdminLocalEventsController],
  providers: [LocalEventsService, EventSeedService],
  exports: [LocalEventsService, EventSeedService],
})
export class LocalEventsModule {}
