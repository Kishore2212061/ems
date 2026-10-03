import { Schema, Types } from 'mongoose';

export interface Organization {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  timezone: string;
  /** Bumped inside role-changing transactions to serialise them (see RbacService). */
  rbac_guard: number;
  created_at: Date;
  updated_at: Date;
}

export const ORGANIZATION_MODEL = 'Organization';

export const OrganizationSchema = new Schema<Organization>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    timezone: { type: String, default: 'Asia/Kolkata' },
    rbac_guard: { type: Number, default: 0 },
  },
  { collection: 'organizations', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

OrganizationSchema.index({ slug: 1 }, { unique: true });
