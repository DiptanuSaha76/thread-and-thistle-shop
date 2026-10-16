-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon, authenticated;

CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id OR public.has_role((SELECT auth.uid()), 'admin'));

CREATE OR REPLACE FUNCTION public.assign_store_admin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(NEW.email) = 'adminyearthstore76@gmail.com' AND NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.assign_store_admin() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER store_admin_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_store_admin();
CREATE TRIGGER store_admin_on_confirm AFTER UPDATE OF email_confirmed_at, email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_store_admin();
INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'admin' FROM auth.users WHERE lower(email) = 'adminyearthstore76@gmail.com' AND email_confirmed_at IS NOT NULL
  ON CONFLICT DO NOTHING;

-- Admins can see customer profiles
CREATE POLICY "Admins read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Store settings
CREATE TABLE public.store_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name text NOT NULL DEFAULT 'THE YEARTH STORE' CHECK (char_length(store_name) <= 80),
  announcement text NOT NULL DEFAULT '' CHECK (char_length(announcement) <= 160),
  free_shipping_threshold int NOT NULL DEFAULT 999 CHECK (free_shipping_threshold >= 0),
  shipping_fee int NOT NULL DEFAULT 79 CHECK (shipping_fee >= 0),
  support_email text NOT NULL DEFAULT '' CHECK (char_length(support_email) <= 255),
  hero_eyebrow text NOT NULL DEFAULT 'PREMIUM OVERSIZED' CHECK (char_length(hero_eyebrow) <= 60),
  hero_title text NOT NULL DEFAULT 'T-SHIRTS' CHECK (char_length(hero_title) <= 30),
  hero_text text NOT NULL DEFAULT '240 GSM premium cotton. Oversized fit. Everyday comfort.' CHECK (char_length(hero_text) <= 200),
  cod_enabled boolean NOT NULL DEFAULT true,
  razorpay_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.store_settings TO anon, authenticated;
GRANT UPDATE ON public.store_settings TO authenticated;
GRANT ALL ON public.store_settings TO service_role;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads settings" ON public.store_settings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins update settings" ON public.store_settings FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
INSERT INTO public.store_settings (id, announcement, support_email) VALUES (1, 'FREE SHIPPING ON ALL ORDERS ABOVE ₹999', 'adminyearthstore76@gmail.com');

-- Promo codes (private; validated by function)
CREATE TABLE public.promo_codes (
  code text PRIMARY KEY CHECK (code = upper(code) AND char_length(code) BETWEEN 3 AND 30),
  percent int NOT NULL CHECK (percent BETWEEN 1 AND 90),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_codes TO authenticated;
GRANT ALL ON public.promo_codes TO service_role;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage promos" ON public.promo_codes FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
INSERT INTO public.promo_codes (code, percent) VALUES ('YEARTH10', 10);

CREATE OR REPLACE FUNCTION public.validate_promo(p_code text) RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT percent FROM public.promo_codes WHERE code = upper(trim(p_code)) AND active), 0)
$$;
GRANT EXECUTE ON FUNCTION public.validate_promo(text) TO anon, authenticated;

-- Products
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  details text NOT NULL DEFAULT '' CHECK (char_length(details) <= 2000),
  price int NOT NULL CHECK (price >= 0),
  compare_at_price int CHECK (compare_at_price IS NULL OR compare_at_price >= 0),
  cost_price int NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  category text NOT NULL DEFAULT 'T-Shirts' CHECK (char_length(category) <= 60),
  badge text CHECK (badge IS NULL OR char_length(badge) <= 30),
  primary_colour text NOT NULL DEFAULT 'Black' CHECK (char_length(primary_colour) <= 40),
  image_url text CHECK (image_url IS NULL OR char_length(image_url) <= 1000),
  image_key text CHECK (image_key IS NULL OR char_length(image_key) <= 60),
  rating numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  review_count int NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read active products" ON public.products FOR SELECT TO anon, authenticated USING (active OR public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins insert products" ON public.products FOR INSERT TO authenticated WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins update products" ON public.products FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins delete products" ON public.products FOR DELETE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  colour text NOT NULL CHECK (char_length(colour) BETWEEN 1 AND 40),
  colour_hex text NOT NULL DEFAULT '#000000' CHECK (colour_hex ~ '^#[0-9a-fA-F]{6}$'),
  size text NOT NULL CHECK (char_length(size) BETWEEN 1 AND 10),
  stock int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url text CHECK (image_url IS NULL OR char_length(image_url) <= 1000),
  UNIQUE (product_id, colour, size)
);
CREATE INDEX product_variants_product_idx ON public.product_variants(product_id);
GRANT SELECT ON public.product_variants TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read variants of visible products" ON public.product_variants FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.products p WHERE p.id = product_id AND (p.active OR public.has_role((SELECT auth.uid()), 'admin'))));
CREATE POLICY "Admins insert variants" ON public.product_variants FOR INSERT TO authenticated WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins update variants" ON public.product_variants FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins delete variants" ON public.product_variants FOR DELETE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Orders
CREATE SEQUENCE public.order_number_seq START 1001;
GRANT USAGE ON SEQUENCE public.order_number_seq TO service_role;
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE DEFAULT ('YRT' || nextval('public.order_number_seq')::text),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'Processing' CHECK (status IN ('Processing','Shipped','Delivered','Cancelled')),
  payment_method text NOT NULL CHECK (payment_method IN ('cod','razorpay')),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','refunded','failed')),
  subtotal int NOT NULL CHECK (subtotal >= 0),
  shipping int NOT NULL DEFAULT 0 CHECK (shipping >= 0),
  discount int NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total int NOT NULL CHECK (total >= 0),
  cost_total int NOT NULL DEFAULT 0 CHECK (cost_total >= 0),
  promo_code text,
  ship_name text NOT NULL CHECK (char_length(ship_name) <= 120),
  ship_phone text NOT NULL CHECK (char_length(ship_phone) <= 20),
  ship_address text NOT NULL CHECK (char_length(ship_address) <= 300),
  ship_city text NOT NULL CHECK (char_length(ship_city) <= 80),
  ship_state text NOT NULL CHECK (char_length(ship_state) <= 80),
  ship_pincode text NOT NULL CHECK (ship_pincode ~ '^[1-9][0-9]{5}$'),
  tracking_number text CHECK (tracking_number IS NULL OR char_length(tracking_number) <= 60),
  admin_note text CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON public.orders(user_id, created_at DESC);
CREATE INDEX orders_created_idx ON public.orders(created_at DESC);
GRANT SELECT, UPDATE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own or admin orders" ON public.orders FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id OR public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins update orders" ON public.orders FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_slug text NOT NULL DEFAULT '',
  colour text NOT NULL,
  size text NOT NULL,
  quantity int NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  unit_price int NOT NULL CHECK (unit_price >= 0),
  unit_cost int NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  image_url text,
  image_key text
);
CREATE INDEX order_items_order_idx ON public.order_items(order_id);
GRANT SELECT ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own or admin order items" ON public.order_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND (o.user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'))));

-- Restore stock when an order is cancelled
CREATE OR REPLACE FUNCTION public.restore_cancelled_stock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' THEN
    UPDATE public.product_variants v SET stock = v.stock + i.quantity
      FROM public.order_items i WHERE i.order_id = NEW.id AND i.variant_id = v.id;
    IF NEW.payment_status = 'paid' THEN NEW.payment_status := 'refunded'; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.restore_cancelled_stock() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER orders_status_change BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.restore_cancelled_stock();

-- Place order with server-side pricing and stock checks
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_shipping jsonb, p_payment text, p_promo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid();
  s public.store_settings%ROWTYPE;
  item jsonb;
  v record;
  qty int;
  sub int := 0;
  cost int := 0;
  pct int := 0;
  disc int := 0;
  ship int := 0;
  oid uuid;
  onum text;
  phone text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Please sign in to place an order'; END IF;
  IF p_payment NOT IN ('cod','razorpay') THEN RAISE EXCEPTION 'Invalid payment method'; END IF;
  SELECT * INTO s FROM public.store_settings WHERE id = 1;
  IF (p_payment = 'cod' AND NOT s.cod_enabled) OR (p_payment = 'razorpay' AND NOT s.razorpay_enabled) THEN RAISE EXCEPTION 'This payment method is unavailable'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 30 THEN RAISE EXCEPTION 'Your bag is empty'; END IF;
  phone := regexp_replace(coalesce(p_shipping->>'phone',''), '[^0-9+]', '', 'g');
  IF char_length(trim(coalesce(p_shipping->>'fullName',''))) NOT BETWEEN 1 AND 120
    OR char_length(phone) NOT BETWEEN 10 AND 15
    OR char_length(trim(coalesce(p_shipping->>'address',''))) NOT BETWEEN 1 AND 300
    OR char_length(trim(coalesce(p_shipping->>'city',''))) NOT BETWEEN 1 AND 80
    OR char_length(trim(coalesce(p_shipping->>'state',''))) NOT BETWEEN 1 AND 80
    OR coalesce(p_shipping->>'pincode','') !~ '^[1-9][0-9]{5}$' THEN
    RAISE EXCEPTION 'Please check your delivery details';
  END IF;

  INSERT INTO public.orders (user_id, payment_method, payment_status, subtotal, total, ship_name, ship_phone, ship_address, ship_city, ship_state, ship_pincode)
  VALUES (uid, p_payment, CASE WHEN p_payment = 'razorpay' THEN 'paid' ELSE 'pending' END, 0, 0,
    trim(p_shipping->>'fullName'), phone, trim(p_shipping->>'address'), trim(p_shipping->>'city'), trim(p_shipping->>'state'), p_shipping->>'pincode')
  RETURNING id, order_number INTO oid, onum;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    qty := coalesce((item->>'quantity')::int, 0);
    IF qty < 1 OR qty > 10 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    SELECT pv.id, pv.stock, pv.colour, pv.size, pv.image_url AS vimg, p.id AS pid, p.name, p.slug, p.price, p.cost_price, p.image_url, p.image_key
      INTO v
      FROM public.product_variants pv JOIN public.products p ON p.id = pv.product_id
      WHERE pv.product_id = (item->>'productId')::uuid AND pv.colour = item->>'colour' AND pv.size = item->>'size' AND p.active
      FOR UPDATE OF pv;
    IF NOT FOUND THEN RAISE EXCEPTION 'An item in your bag is no longer available'; END IF;
    IF v.stock < qty THEN RAISE EXCEPTION '% (%, %) has only % left', v.name, v.colour, v.size, v.stock; END IF;
    UPDATE public.product_variants SET stock = stock - qty WHERE id = v.id;
    INSERT INTO public.order_items (order_id, product_id, variant_id, product_name, product_slug, colour, size, quantity, unit_price, unit_cost, image_url, image_key)
      VALUES (oid, v.pid, v.id, v.name, v.slug, v.colour, v.size, qty, v.price, v.cost_price, coalesce(v.vimg, v.image_url), v.image_key);
    sub := sub + v.price * qty;
    cost := cost + v.cost_price * qty;
  END LOOP;

  IF p_promo IS NOT NULL AND trim(p_promo) <> '' THEN
    SELECT percent INTO pct FROM public.promo_codes WHERE code = upper(trim(p_promo)) AND active;
    pct := coalesce(pct, 0);
  END IF;
  disc := round(sub * pct / 100.0);
  ship := CASE WHEN sub > s.free_shipping_threshold THEN 0 ELSE s.shipping_fee END;
  UPDATE public.orders SET subtotal = sub, discount = disc, shipping = ship, total = sub + ship - disc, cost_total = cost,
    promo_code = CASE WHEN pct > 0 THEN upper(trim(p_promo)) END
    WHERE id = oid;
  RETURN jsonb_build_object('id', oid, 'order_number', onum, 'total', sub + ship - disc);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_order(jsonb, jsonb, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_my_order(p_order uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.orders SET status = 'Cancelled' WHERE id = p_order AND user_id = auth.uid() AND status = 'Processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'This order can no longer be cancelled'; END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cancel_my_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_my_order(uuid) TO authenticated;

-- Support messages
CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 255 AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic text NOT NULL CHECK (char_length(topic) <= 60),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 3000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.support_messages TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone sends support message" ON public.support_messages FOR INSERT TO anon, authenticated
  WITH CHECK (status = 'open' AND (user_id IS NULL OR user_id = (SELECT auth.uid())));
CREATE POLICY "Admins read support" ON public.support_messages FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins update support" ON public.support_messages FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin')) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'));
CREATE POLICY "Admins delete support" ON public.support_messages FOR DELETE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Traffic
CREATE TABLE public.page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL CHECK (char_length(path) BETWEEN 1 AND 300),
  session_id text NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 64),
  referrer text CHECK (referrer IS NULL OR char_length(referrer) <= 300),
  device text CHECK (device IS NULL OR device IN ('mobile','tablet','desktop')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_views_created_idx ON public.page_views(created_at DESC);
GRANT INSERT ON public.page_views TO anon, authenticated;
GRANT SELECT ON public.page_views TO authenticated;
GRANT ALL ON public.page_views TO service_role;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone records a view" ON public.page_views FOR INSERT TO anon, authenticated WITH CHECK (path LIKE '/%' AND path NOT LIKE '/admin%');
CREATE POLICY "Admins read views" ON public.page_views FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'));

-- Seed catalogue
INSERT INTO public.products (slug, name, description, details, price, cost_price, badge, primary_colour, image_key, rating, review_count, sort_order) VALUES
 ('black','Oversized Black Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,'BEST SELLER','Black','black',4.8,24,1),
 ('off-white','Oversized Off-White Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,NULL,'Off-White','off-white',4.7,18,2),
 ('brown','Oversized Brown Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,NULL,'Brown','brown',4.7,15,3),
 ('olive-green','Oversized Olive Green Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,NULL,'Olive Green','olive-green',4.8,21,4),
 ('back-black','Back Print Black Tee','Oversized 240 GSM cotton tee with a minimal sun graphic printed on the back.','100% premium cotton. 240 GSM heavyweight fabric. Screen-printed back graphic.',699,310,'BEST SELLER','Black','back-black',4.9,32,5),
 ('purple','Oversized Purple Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,NULL,'Purple','purple',4.6,12,6),
 ('grey','Oversized Grey Tee','Premium oversized t-shirt made with 240 GSM cotton. Designed for everyday comfort with a relaxed fit.','100% premium cotton. 240 GSM heavyweight fabric with a clean crew neck and dropped shoulders.',649,280,NULL,'Grey','grey',4.7,16,7),
 ('back-off-white','Back Print Off-White Tee','Oversized 240 GSM cotton tee with a minimal sun graphic printed on the back.','100% premium cotton. 240 GSM heavyweight fabric. Screen-printed back graphic.',699,310,NULL,'Off-White','back-off-white',4.7,14,8);

INSERT INTO public.product_variants (product_id, colour, colour_hex, size, stock)
SELECT p.id, c.colour, c.hex, sz.size,
  CASE WHEN p.slug = 'purple' AND c.colour = 'Purple' AND sz.size = 'XXL' THEN 0 ELSE 25 END
FROM public.products p
CROSS JOIN (VALUES ('S',1),('M',2),('L',3),('XL',4),('XXL',5)) AS sz(size, ord)
JOIN (VALUES ('Black','#1c1c1c'),('Off-White','#ebe6dc'),('Brown','#5a4232'),('Olive Green','#5a5e3c'),('Grey','#9a9a9a'),('Purple','#8f7488')) AS c(colour, hex)
  ON c.colour IN ('Black','Off-White','Brown','Olive Green') OR c.colour = p.primary_colour;