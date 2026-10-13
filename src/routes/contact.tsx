import {createFileRoute} from '@tanstack/react-router';
import {ContactPage} from '@/components/store/information';
import {pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/contact')({head:()=>pageHead('Contact YEARTH','Get help with sizing, orders, delivery and returns from THE YEARTH STORE.'),component:ContactPage});
