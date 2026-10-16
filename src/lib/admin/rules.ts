import { z } from 'zod';
export const adminEmail = 'diptanusaha54@gmail.com';
export const adminRoleAllowed = (role: unknown) => role === true;
export const productInput = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), price: z.number().int().nonnegative(),
  description: z.string().max(5000), category: z.string().min(1).max(80),
  primary_colour: z.string().min(1).max(50), active: z.boolean(),
  image_key: z.string().nullable(),
});
export const orderInput = z.object({ id: z.string().uuid(), status: z.enum(['Processing','Shipped','Delivered','Cancelled']), tracking_number: z.string().max(150), admin_note: z.string().max(2000) });
export const supportInput = z.object({ id: z.string().uuid(), status: z.enum(['open','resolved']) });
export const settingsInput = z.object({ store_name: z.string().min(1).max(100), announcement: z.string().max(300), support_email: z.union([z.literal(''),z.string().email()]), free_shipping_threshold: z.number().int().nonnegative(), shipping_fee: z.number().int().nonnegative(), cod_enabled: z.boolean(), razorpay_enabled: z.boolean() });
