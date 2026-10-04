import { Global, Injectable, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NO_FEES, type FeeSettings } from './fees';
import { FEE_SETTINGS_MODEL, FeeSettingsDoc, FeeSettingsSchema } from './order.schema';

const TTL_MS = 60_000;

/** Org-wide fee settings, cached in memory for 60 s (invalidated on save). Defaults: no fees. */
@Injectable()
export class FeeSettingsService {
  private cached?: { at: number; value: FeeSettings };

  constructor(@InjectModel(FEE_SETTINGS_MODEL) private readonly settings: Model<FeeSettingsDoc>) {}

  async get(): Promise<FeeSettings> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    const d = await this.settings.findById('default').lean();
    const value: FeeSettings = d
      ? { platformFeeBps: d.platformFeeBps, platformFeeFlatPaise: d.platformFeeFlatPaise, gstBps: d.gstBps, feeBearer: d.feeBearer }
      : NO_FEES;
    this.cached = { at: Date.now(), value };
    return value;
  }

  async set(v: FeeSettings, userId: string): Promise<FeeSettings> {
    await this.settings.updateOne({ _id: 'default' }, { $set: { ...v, updated_by: new Types.ObjectId(userId), updated_at: new Date() } }, { upsert: true });
    this.cached = undefined;
    return this.get();
  }
}

/** Global: registrations price entries with it, payments charge with it. */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: FEE_SETTINGS_MODEL, schema: FeeSettingsSchema }])],
  providers: [FeeSettingsService],
  exports: [FeeSettingsService],
})
export class FeesModule {}
