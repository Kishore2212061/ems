import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { RegistrationsModule } from '../registrations/registrations.module';
import { TicketsModule } from '../tickets/tickets.module';
import { createGateway, PAYMENT_GATEWAY } from './gateway';
import { TICKET_MODEL, TicketSchema } from '../tickets/ticket.schema';
import { ORDER_MODEL, OrderSchema, WEBHOOK_EVENT_MODEL, WebhookEventSchema } from './order.schema';
import { REFUND_BATCH_MODEL, REFUND_MODEL, RefundBatchSchema, RefundSchema } from './refund.schema';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Orders, Razorpay checkout + webhook, desk payments, finance list. Fee settings: FeesModule (global). */
@Module({
  imports: [
    GlobalEventsModule,
    RegistrationsModule,
    TicketsModule,
    MongooseModule.forFeature([
      { name: ORDER_MODEL, schema: OrderSchema },
      { name: WEBHOOK_EVENT_MODEL, schema: WebhookEventSchema },
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
      { name: REFUND_MODEL, schema: RefundSchema },
      { name: REFUND_BATCH_MODEL, schema: RefundBatchSchema },
      { name: TICKET_MODEL, schema: TicketSchema },
    ]),
  ],
  controllers: [PaymentsController, RefundsController],
  providers: [PaymentsService, RefundsService, { provide: PAYMENT_GATEWAY, useFactory: createGateway }],
  exports: [PaymentsService, PAYMENT_GATEWAY],
})
export class PaymentsModule {}
