import { Schema, Types } from 'mongoose';

export interface Department {
  _id: Types.ObjectId;
  code: string;
  name: string;
  association_name?: string | null;
  active: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

export const DEPARTMENT_MODEL = 'Department';

export const DepartmentSchema = new Schema<Department>(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    association_name: { type: String, default: null },
    active: { type: Boolean, default: true },
    sort_order: { type: Number, default: 100 },
  },
  { collection: 'department_masters', versionKey: false, timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

DepartmentSchema.index({ code: 1 }, { unique: true });
DepartmentSchema.index({ active: 1, sort_order: 1 });

export const DEPARTMENT_FIELDS = '_id code name association_name active sort_order';

export const toPublicDepartment = (d: Pick<Department, '_id' | 'code' | 'name' | 'association_name' | 'active' | 'sort_order'>) => ({
  id: String(d._id),
  code: d.code,
  name: d.name,
  associationName: d.association_name ?? null,
  active: d.active,
  sortOrder: d.sort_order,
});

/** NEC Tech Fest '25 associations (system docs §13.1). Seeded once; editable afterwards. */
export const SEED_DEPARTMENTS: [code: string, name: string, association: string][] = [
  ['CSE', 'Computer Science & Engineering', 'Computer Science & Engineering Association'],
  ['IT', 'Information Technology', 'Information Technology Association'],
  ['ECE', 'Electronics & Communication Engineering', 'Electronics & Communication Engineering Association'],
  ['EEE', 'Electrical & Electronics Engineering', 'Electrical & Electronics Engineering Association'],
  ['MECH', 'Mechanical Engineering', 'Mechanical Engineering Association'],
  ['CIVIL', 'Civil Engineering', 'Civil Engineering Association'],
  ['AIDS', 'Artificial Intelligence & Data Science', 'Artificial Intelligence & Data Science Association'],
  ['MBA', 'Management Studies', 'Management Studies Association'],
  ['SH', 'Science & Humanities', 'Science & Humanities Association'],
];
