import { z } from 'zod';
export const adminEmail = 'diptanusaha54@gmail.com';
export const adminRoleAllowed = (role: unknown) => role === true;
export const productInput = z.object({
  id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), price: z.number().int().nonnegative(),
  description: z.string().max(5000), category: z.string().min(1).max(80),
  primary_colour: z.string().min(1).max(50), active: z.boolean(),
  image_key: z.string().nullable(),
  image_url: z.string().max(1000).nullable().optional(),
  images: z.array(z.string().max(1000)).max(10).optional(),
  compare_at_price: z.number().int().nonnegative().nullable().optional(),
  cost_price: z.number().int().nonnegative().optional(),
  badge: z.string().max(40).nullable().optional(),
});
export const variantsInput = z.object({
  product_id: z.string().uuid(),
  variants: z.array(z.object({ colour: z.string().trim().min(1).max(40), colour_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), size: z.string().trim().min(1).max(10), stock: z.number().int().nonnegative() })).max(200),
});
export const orderInput = z.object({ id: z.string().uuid(), status: z.enum(['Processing','Shipped','Delivered','Cancelled']), tracking_number: z.string().max(150), admin_note: z.string().max(2000) });
export const supportInput = z.object({ id: z.string().uuid(), status: z.enum(['open','resolved']) });
export const settingsInput = z.object({ store_name: z.string().min(1).max(100), announcement: z.string().max(300), support_email: z.union([z.literal(''),z.string().email()]), free_shipping_threshold: z.number().int().nonnegative(), shipping_fee: z.number().int().nonnegative(), cod_enabled: z.boolean(), razorpay_enabled: z.boolean(),
  categories: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
  colours: z.array(z.object({ name: z.string().trim().min(1).max(40), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).min(1).max(40),
  sizes: z.array(z.string().trim().min(1).max(10)).min(1).max(20),
  price_min: z.number().int().nonnegative(), price_max: z.number().int().positive(),
  filters: z.array(z.enum(['Category','Size','Color','Price','Availability','Rating','On Sale'])),
}).refine(v => v.price_max > v.price_min, 'Maximum price must be above minimum');
