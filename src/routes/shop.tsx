import {createFileRoute} from '@tanstack/react-router';
import {Listing} from '@/components/store/listing';
import {pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/shop')({head:()=>pageHead('Shop','Shop the full YEARTH collection of premium oversized cotton t-shirts.'),component:Listing});
