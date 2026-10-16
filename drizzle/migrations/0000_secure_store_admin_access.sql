CREATE OR REPLACE FUNCTION public.assign_store_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF lower(NEW.email) = 'diptanusaha54@gmail.com' AND NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER yearth_verified_admin AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_store_admin();
GRANT SELECT ON public.user_roles, public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.product_variants, public.promo_codes TO authenticated;
GRANT SELECT, UPDATE ON public.orders TO authenticated;
GRANT SELECT ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_messages TO authenticated;
GRANT SELECT, UPDATE ON public.store_settings TO authenticated;
GRANT SELECT ON public.products, public.product_variants, public.store_settings TO anon;
GRANT INSERT ON public.support_messages TO anon;
GRANT ALL ON public.products, public.product_variants, public.orders, public.order_items, public.profiles, public.user_roles, public.support_messages, public.store_settings, public.promo_codes TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_store_admin() FROM PUBLIC;