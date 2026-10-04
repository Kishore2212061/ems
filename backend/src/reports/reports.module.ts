import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CHECK_IN_MODEL, CheckInSchema } from '../checkins/checkins.service';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { ORDER_MODEL, OrderSchema } from '../payments/order.schema';
import { REFUND_MODEL, RefundSchema } from '../payments/refund.schema';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { TICKET_MODEL, TicketSchema } from '../tickets/ticket.schema';
import { ExportsService } from './exports.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/** Dashboards (from daily_stats), CSV exports and live updates. */
@Module({
  imports: [
    GlobalEventsModule,
    MongooseModule.forFeature([
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
      { name: ORDER_MODEL, schema: OrderSchema },
      { name: REFUND_MODEL, schema: RefundSchema },
      { name: CHECK_IN_MODEL, schema: CheckInSchema },
      { name: TICKET_MODEL, schema: TicketSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService, ExportsService],
})
export class ReportsModule {}
