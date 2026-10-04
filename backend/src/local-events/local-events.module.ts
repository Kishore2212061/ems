import { Module } from '@nestjs/common';
import { GlobalEventsModule } from '../global-events/global-events.module';
import { EventSeedService } from './event-seed.service';
import { AdminLocalEventsController, PublicLocalEventsController } from './local-events.controller';
import { LocalEventsService } from './local-events.service';

/** Department events inside a fest. The model is registered by GlobalEventsModule (fests need it too: publish, clone). */
@Module({
  imports: [GlobalEventsModule],
  controllers: [PublicLocalEventsController, AdminLocalEventsController],
  providers: [LocalEventsService, EventSeedService],
  exports: [LocalEventsService, EventSeedService],
})
export class LocalEventsModule {}
