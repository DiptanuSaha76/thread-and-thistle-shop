import { createFileRoute } from '@tanstack/react-router';
import { AdminPanel } from '@/components/admin/panel';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/admin/')({ head:()=>pageHead('Store administration','Manage YEARTH products, orders, customers, support and store settings.'), component:AdminPanel });
