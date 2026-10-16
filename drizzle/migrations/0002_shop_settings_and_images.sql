ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{T-Shirts,Hoodies,Shirts,Bottoms,Accessories}',
  ADD COLUMN IF NOT EXISTS colours jsonb NOT NULL DEFAULT '[{"name":"Black","hex":"#111111"},{"name":"Off-White","hex":"#F2EEE6"},{"name":"Brown","hex":"#6B4A34"},{"name":"Olive Green","hex":"#5B6142"},{"name":"Grey","hex":"#8C8C8C"},{"name":"Purple","hex":"#5E4B7A"}]',
  ADD COLUMN IF NOT EXISTS sizes text[] NOT NULL DEFAULT '{S,M,L,XL,XXL}',
  ADD COLUMN IF NOT EXISTS price_min integer NOT NULL DEFAULT 249,
  ADD COLUMN IF NOT EXISTS price_max integer NOT NULL DEFAULT 1499,
  ADD COLUMN IF NOT EXISTS filters text[] NOT NULL DEFAULT '{Category,Size,Color,Price}';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images text[] NOT NULL DEFAULT '{}';
DROP POLICY IF EXISTS "Public reads product images" ON storage.objects;
DROP POLICY IF EXISTS "Admins upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Admins change product images" ON storage.objects;
DROP POLICY IF EXISTS "Admins remove product images" ON storage.objects;
CREATE POLICY "Public reads product images" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'product-images');
CREATE POLICY "Admins upload product images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins change product images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins remove product images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'product-images' AND public.has_role(auth.uid(), 'admin'));