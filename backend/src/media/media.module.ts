import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MediaController } from './media.controller';
import { MEDIA_MODEL, MediaAssetSchema, MediaService } from './media.service';

/** Posters: upload or import from a link → resized WebP variants stored and served by us. */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: MEDIA_MODEL, schema: MediaAssetSchema }])],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
