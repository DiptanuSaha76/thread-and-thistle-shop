import {createFileRoute,notFound} from '@tanstack/react-router';
import {Listing} from '@/components/store/listing';
import {pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/collections/$slug')({loader:({params})=>{if(params.slug!=='t-shirts')throw notFound();return 'T-Shirts'},head:()=>pageHead('T-Shirts Collection','Explore premium oversized t-shirts at THE YEARTH STORE. Heavyweight cotton, a relaxed fit and considered colours.'),component:()=> <Listing/>});
