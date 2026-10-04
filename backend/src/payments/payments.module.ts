import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { REGISTRATION_MODEL, RegistrationSchema } from '../registrations/registration.schema';
import { RegistrationsModule } from '../registrations/registrations.module';
import { createGateway, PAYMENT_GATEWAY } from './gateway';
import { ORDER_MODEL, OrderSchema, WEBHOOK_EVENT_MODEL, WebhookEventSchema } from './order.schema';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/** Orders, Razorpay checkout + webhook, desk payments, finance list. Fee settings: FeesModule (global). */
@Module({
  imports: [
    GlobalEventsModule,
    RegistrationsModule,
    MongooseModule.forFeature([
      { name: ORDER_MODEL, schema: OrderSchema },
      { name: WEBHOOK_EVENT_MODEL, schema: WebhookEventSchema },
      { name: REGISTRATION_MODEL, schema: RegistrationSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, { provide: PAYMENT_GATEWAY, useFactory: createGateway }],
  exports: [PaymentsService, PAYMENT_GATEWAY],
})
export class PaymentsModule {}
