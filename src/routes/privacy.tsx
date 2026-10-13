import {createFileRoute} from '@tanstack/react-router';
import {InformationPage} from '@/components/store/information';
import {pageHead} from '@/lib/store/catalogue';
export const Route=createFileRoute('/privacy')({head:()=>pageHead('Privacy Policy','Privacy Policy for THE YEARTH STORE. Find clear information about your shopping experience.'),component:()=> <InformationPage type="privacy"/>});
