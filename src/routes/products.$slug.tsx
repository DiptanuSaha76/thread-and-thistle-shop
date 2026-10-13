import {createFileRoute,notFound} from '@tanstack/react-router';
import {ProductDetail} from '@/components/store/product-detail';
import {products,pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/products/$slug')({loader:({params})=>{const p=products.find(p=>p.slug===params.slug);if(!p)throw notFound();return p},head:({loaderData})=>pageHead(loaderData?.name??'Product unavailable',loaderData?`${loaderData.name}: premium 240 GSM oversized cotton, ₹${loaderData.price}. Choose your colour and fit at THE YEARTH STORE.`:'This YEARTH product is unavailable.'),component:Product});
function Product(){const p=Route.useLoaderData();return <ProductDetail key={p.id} product={p}/>}
