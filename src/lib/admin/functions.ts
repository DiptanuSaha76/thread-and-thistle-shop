import { createServerFn, createMiddleware } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { adminRoleAllowed, productInput, orderInput, supportInput, settingsInput } from './rules';
const requireAdmin = createMiddleware({ type: 'function' }).middleware([requireSupabaseAuth]).server(async ({ context, next }) => {
  const { data, error } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
  if (error || !adminRoleAllowed(data)) throw new Error('Admin access required');
  return next();
});
export const getAdminData = createServerFn({ method: 'POST' }).middleware([requireAdmin]).handler(async ({ context }) => {
  const results = await Promise.all([
    context.supabase.from('products').select('*').order('created_at', { ascending: false }),
    context.supabase.from('orders').select('*, order_items(*)').order('created_at', { ascending: false }),
    context.supabase.from('profiles').select('id,name,email,created_at').order('created_at', { ascending: false }),
    context.supabase.from('support_messages').select('*').order('created_at', { ascending: false }),
    context.supabase.from('store_settings').select('*').eq('id', 1).maybeSingle(),
    context.supabase.from('product_variants').select('*'),
  ]);
  for (const result of results) if (result.error) throw new Error('Unable to load store records');
  return { products: results[0].data ?? [], orders: results[1].data ?? [], users: results[2].data ?? [], messages: results[3].data ?? [], settings: results[4].data, variants: results[5].data ?? [] };
});
export const saveProduct = createServerFn({ method: 'POST' }).middleware([requireAdmin]).inputValidator(productInput).handler(async ({ data, context }) => {
  const { id, ...values } = data;
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
  const { id, ...values } = data;
  const result = await context.supabase.from('orders').update(values).eq('id', id).select('id').single();
  if (result.error) throw new Error('Order could not be saved');
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
