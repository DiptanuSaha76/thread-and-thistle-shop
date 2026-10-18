CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_customer_profile();
CREATE TRIGGER on_auth_user_email_sync AFTER UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_customer_email();
CREATE TRIGGER on_auth_user_admin AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_store_admin();
INSERT INTO public.profiles (id, name, email)
SELECT id, left(coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name',''),200), coalesce(email,'') FROM auth.users
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;