import { createFileRoute } from '@tanstack/react-router';
import { AdminSignIn } from '@/components/admin/sign-in';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/admin/login')({head:()=>pageHead('Admin sign-in','Secure administrator access to THE YEARTH STORE.'),component:AdminSignIn});
