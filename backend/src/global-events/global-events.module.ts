import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DepartmentsController } from '../departments/departments.controller';
import { DEPARTMENT_MODEL, DepartmentSchema } from '../departments/department.schema';
import { DepartmentsService } from '../departments/departments.service';
import { LOCAL_EVENT_MODEL, LocalEventSchema } from '../local-events/local-event.schema';
import { USER_MODEL, UserSchema } from '../users/user.schema';
import { AdminGlobalEventsController, PublicGlobalEventsController } from './global-events.controller';
import { GLOBAL_EVENT_MODEL, GlobalEventSchema } from './global-event.schema';
import { GlobalEventsService } from './global-events.service';

/** Fests + the department catalogue they embed (one module: they're edited together). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GLOBAL_EVENT_MODEL, schema: GlobalEventSchema },
      { name: DEPARTMENT_MODEL, schema: DepartmentSchema },
      { name: USER_MODEL, schema: UserSchema },
      { name: LOCAL_EVENT_MODEL, schema: LocalEventSchema },
    ]),
  ],
  controllers: [PublicGlobalEventsController, AdminGlobalEventsController, DepartmentsController],
  providers: [GlobalEventsService, DepartmentsService],
  exports: [GlobalEventsService, DepartmentsService, MongooseModule],
})
export class GlobalEventsModule {}
