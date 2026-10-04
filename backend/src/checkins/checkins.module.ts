import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { ORDER_MODEL, OrderSchema } from '../payments/order.schema';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { TICKET_MODEL, TicketSchema } from '../tickets/ticket.schema';
import { CheckinsController } from './checkins.controller';
import { CHECK_IN_MODEL, CheckInSchema, CheckinsService } from './checkins.service';

@Module({
  imports: [
    GlobalEventsModule,
    MongooseModule.forFeature([
      { name: CHECK_IN_MODEL, schema: CheckInSchema },
      { name: TICKET_MODEL, schema: TicketSchema },
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
      { name: ORDER_MODEL, schema: OrderSchema },
    ]),
  ],
  controllers: [CheckinsController],
  providers: [CheckinsService],
})
export class CheckinsModule {}
