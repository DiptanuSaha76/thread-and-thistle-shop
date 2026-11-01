import { createServerFn, createMiddleware } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import type { Database } from '@/integrations/supabase/types';
import { adminRoleAllowed, productInput, orderInput, supportInput, settingsInput, variantsInput } from './rules';
import { checkTrackingNumber } from '@/lib/shipping/awb';
import { amountFromDb } from '@/lib/store/orders';
const requireAdmin = createMiddleware({ type: 'function' }).middleware([requireSupabaseAuth]).server(async ({ context, next }) => {
  const { data, error } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
  if (error || !adminRoleAllowed(data)) throw new Error('Admin access required');
  return next();
});
// Database reasons from the order guard (supabase/migrations/..._orders_checkout_payments.sql).
const orderSaveMessages: Record<string, string> = {
  ORDER_NOT_PAID: 'Online orders can only be shipped after the payment is confirmed.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed. Orders move Processing → Shipped → Delivered; only orders that are not delivered can be cancelled.',
  ORDER_FIELDS_LOCKED: 'Only the status, tracking number and note can be changed.',
  ORDER_UPDATE_NOT_ALLOWED: 'Admin access required',
  PAID_ORDER_WITHOUT_PAYMENT_RECORD: 'This order is marked paid but has no captured Razorpay payment on record, so it cannot be cancelled here. Check the payment in Razorpay first.',
};

export const getAdminData = createServerFn({ method: 'POST' }).middleware([requireAdmin]).handler(async () => {
  // Read with the server's service role AFTER the admin check above: cost prices and
  // internal notes are deliberately not readable through browser sessions.
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const results = await Promise.all([
    supabaseAdmin.from('products').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    supabaseAdmin.from('profiles').select('id,name,email,created_at').order('created_at', { ascending: false }),
    supabaseAdmin.from('support_messages').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('store_settings').select('*').eq('id', 1).maybeSingle(),
    supabaseAdmin.from('product_variants').select('*'),
    supabaseAdmin.from('payment_refunds').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('product_reviews').select('id, product_id, rating, title, body, display_name, status, created_at').order('created_at', { ascending: false }).limit(200),
  ]);
  const queryNames = [
    'products',
    'orders',
    'profiles',
    'support_messages',
    'store_settings',
    'product_variants',
    'payment_refunds',
    'product_reviews',
  ] as const;

  for (const [index, result] of results.entries()) {
    if (result.error) {
      console.error(
        `[Admin query failed: ${queryNames[index]}]`,
        result.error
      );

      throw new Error('Unable to load store records');
    }
  }
  // Order amounts and quantities are text on the live database; the panel adds them up.
  const orders = (results[1].data ?? []).map((o) => ({
    ...o,
    subtotal: amountFromDb(o.subtotal),
    shipping: amountFromDb(o.shipping),
    discount: amountFromDb(o.discount),
    total: amountFromDb(o.total),
    cost_total: amountFromDb(o.cost_total),
    order_items: (o.order_items ?? []).map((i) => ({
      ...i,
      quantity: amountFromDb(i.quantity),
      unit_price: amountFromDb(i.unit_price),
      unit_cost: amountFromDb(i.unit_cost),
    })),
  }));
  return { products: results[0].data ?? [], orders, users: results[2].data ?? [], messages: results[3].data ?? [], settings: results[4].data, variants: results[5].data ?? [], refunds: results[6].data ?? [], reviews: results[7].data ?? [] };
});
export const saveProduct = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(productInput).handler(async ({ data, context }) => {
  const { id, ...raw } = data;
  const values = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Database['public']['Tables']['products']['Insert'];
  const result = id ? await context.supabase.from('products').update(values).eq('id', id).select('id').single() : await context.supabase.from('products').insert(values).select('id').single();
  if (result.error) throw new Error('Product could not be saved. Check the unique slug.');
  return result.data;
});
export const saveVariant = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator((value: { id: string; stock: number }) => {
  if (!/^[0-9a-f-]{36}$/i.test(value.id) || !Number.isInteger(value.stock) || value.stock < 0) throw new Error('Invalid stock');
  return value;
}).handler(async ({ data, context }) => {
  const result = await context.supabase.from('product_variants').update({ stock: data.stock }).eq('id', data.id).select('id').single();
  if (result.error) throw new Error('Stock could not be saved');
  return { ok: true };
});
export const saveOrder = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(orderInput).handler(async ({ data, context }) => {
  const { id, tracking_number, ...rest } = data;
  // The tracking number is checked here, on the server; the form's check is only a convenience.
  const checked = checkTrackingNumber(tracking_number);
  let values: { status: typeof rest.status; admin_note: string; tracking_number?: string | null } = rest;
  if (checked.ok) {
    values = { ...rest, tracking_number: checked.value };
  } else {
    // An older number saved before this check may be left as it is (so the status can still
    // be changed); any new or edited value must pass.
    const current = await context.supabase.from('orders').select('tracking_number').eq('id', id).maybeSingle();
    if (current.error || current.data?.tracking_number !== tracking_number) throw new Error(checked.message);
  }
  // Uses the admin's own session so the database's status rules apply to admins too.
  const result = await context.supabase.from('orders').update(values).eq('id', id).select('id').single();
  if (result.error) {
    console.error('[Admin] Order update refused:', result.error.message);
    throw new Error(orderSaveMessages[result.error.message] ?? 'Order could not be saved');
  }
  return { ok: true };
});
export const saveSupport = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(supportInput).handler(async ({ data, context }) => {
  const result = await context.supabase.from('support_messages').update({ status: data.status }).eq('id', data.id).select('id').single();
  if (result.error) throw new Error('Message could not be updated');
  return { ok: true };
});
export const saveSettings = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(settingsInput).handler(async ({ data, context }) => {
  const result = await context.supabase.from('store_settings').upsert({ id: 1, ...data }).select('id').single();
  if (result.error) throw new Error('Settings could not be saved');
  return { ok: true };
});
export const saveVariants = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(variantsInput).handler(async ({ data, context }) => {
  if (!data.variants.length) return { ok: true };
  const rows = data.variants.map(v => ({ ...v, product_id: data.product_id }));
  const result = await context.supabase.from('product_variants').upsert(rows, { onConflict: 'product_id,colour,size' }).select('id');
  if (result.error) throw new Error('Sizes and stock could not be saved');
  return { ok: true };
});

// ---- Refunds (Razorpay). The refund code runs only on the server, after the admin check. ----
const refundSafe = async <T>(work: () => Promise<T>): Promise<T> => {
  const { RefundError } = await import('@/lib/payments/refunds.server');
  try {
    return await work();
  } catch (error) {
    if (error instanceof RefundError) throw new Error(error.message);
    console.error('[Admin] Refund action failed:', error instanceof Error ? error.message : 'unknown');
    throw new Error('The refund action failed. Please check the case and try again.');
  }
};
const refundCase = z.object({ caseId: z.string().uuid() });
export const refundViaRazorpay = createServerFn({ method: 'POST' }).middleware([requireAdmin]).validator(refundCase).handler(async ({ data, context }) =>
  refundSafe(async () => (await import('@/lib/payments/refunds.server')).startRefund(data.caseId, context.userId)));
export const checkRefundStatus = createServerFn({ method: 'POST' }).middleware([requireAdmin]).validator(refundCase).handler(async ({ data, context }) =>
  refundSafe(async () => (await import('@/lib/payments/refunds.server')).checkRefund(data.caseId, context.userId)));
export const recordRazorpayRefund = createServerFn({ method: 'POST' }).middleware([requireAdmin])
  .validator(refundCase.extend({ refundId: z.string().trim().regex(/^rfnd_[A-Za-z0-9]+$/, 'Enter a Razorpay refund ID (rfnd_…)') }))
  .handler(async ({ data, context }) =>
    refundSafe(async () => (await import('@/lib/payments/refunds.server')).recordDashboardRefund(data.caseId, data.refundId, context.userId)));
export const closeRefundManually = createServerFn({ method: 'POST' }).middleware([requireAdmin])
  .validator(refundCase.extend({ note: z.string().trim().min(5).max(500) }))
  .handler(async ({ data, context }) =>
    refundSafe(async () => (await import('@/lib/payments/refunds.server')).resolveRefundManually(data.caseId, data.note, context.userId)));

// ---- Product reviews: admins can hide or show a review (moderation). ----
export const setReviewStatus = createServerFn({ method: 'POST' }).middleware([requireAdmin])
  .validator(z.object({ id: z.string().uuid(), status: z.enum(['published', 'hidden']) }))
  .handler(async ({ data }) => {
    // Service role after the admin check above: review rows are not writable from browsers.
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const result = await supabaseAdmin.from('product_reviews').update({ status: data.status, updated_at: new Date().toISOString() }).eq('id', data.id).select('id').single();
    if (result.error) throw new Error('The review could not be updated');
    return { ok: true };
  });
