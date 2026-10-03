import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JOB_MODEL, JobSchema } from './job.schema';
import { JobsService } from './jobs.service';

@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: JOB_MODEL, schema: JobSchema }])],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
