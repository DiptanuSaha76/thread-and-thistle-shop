import {describe,it,expect} from 'vitest';
import {totals,lineKey,stock,products} from './catalogue';
describe('YEARTH commerce',()=>{
 it('charges shipping below the threshold',()=>expect(totals([{productId:'black',colour:'Black',size:'M',quantity:1}])).toEqual({subtotal:649,shipping:79,discount:0,total:728}));
 it('grants free shipping and computes a shared promo',()=>expect(totals([{productId:'black',colour:'Brown',size:'L',quantity:3}],'YEARTH10')).toEqual({subtotal:1947,shipping:0,discount:195,total:1752}));
 it('does not charge shipping for an empty cart',()=>expect(totals([]).total).toBe(0));
 it('identifies different variants separately',()=>expect(lineKey({productId:'black',colour:'Black',size:'M',quantity:1})).not.toBe(lineKey({productId:'black',colour:'Brown',size:'M',quantity:1})));
 it('has an explicit sold-out variant',()=>{const p=products.find(p=>p.id==='purple');expect(p&&stock(p,'Purple','XXL')).toBe(0)});
});
