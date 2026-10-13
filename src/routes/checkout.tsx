import {createFileRoute} from '@tanstack/react-router';
import {CheckoutPage} from '@/components/store/checkout';
import {pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/checkout')({head:()=>pageHead('Checkout','Complete your YEARTH demo checkout with delivery information, payment selection and order review.'),component:CheckoutPage});
