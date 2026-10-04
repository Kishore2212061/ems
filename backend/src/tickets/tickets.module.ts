import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { TICKET_MODEL, TicketSchema } from './ticket.schema';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/** One ticket per team member with a signed QR. Used by registrations and payments (issue/activate/void). */
@Module({
  imports: [
    GlobalEventsModule,
    MongooseModule.forFeature([
      { name: TICKET_MODEL, schema: TicketSchema },
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
    ]),
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
