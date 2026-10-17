import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Save, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/store/shared';
import { assetByKey, colourImages, money, allFilters } from '@/lib/store/catalogue';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { getAdminData, saveProduct, saveOrder, saveSupport, saveSettings, saveVariants } from '@/lib/admin/functions';
import type { Database } from '@/integrations/supabase/types';
type Product = Database['public']['Tables']['products']['Row'];
type VariantRow = Database['public']['Tables']['product_variants']['Row'];
type Settings = Database['public']['Tables']['store_settings']['Row'];
type Colour = { name: string; hex: string };
const sections = ['Dashboard', 'Products', 'Orders', 'Users', 'Support', 'Settings'] as const;
const defaults = { categories: ['T-Shirts'], colours: [{ name: 'Black', hex: '#111111' }] as Colour[], sizes: ['S', 'M', 'L', 'XL', 'XXL'] };
const shopColours = (s: Settings | null) => (Array.isArray(s?.colours) ? (s.colours as Colour[]) : defaults.colours);
const thumb = (p: Product) => p.image_url || p.images?.[0] || (p.image_key && assetByKey[p.image_key]) || colourImages[p.primary_colour];

export function AdminPanel() {
  const { user, ready, signOut } = useAuth();
  const [section, setSection] = useState<typeof sections[number]>('Dashboard');
  const [editor, setEditor] = useState<Product | 'new' | null>(null);
  const queryClient = useQueryClient();
  const fetchData = useServerFn(getAdminData), productSave = useServerFn(saveProduct), orderSave = useServerFn(saveOrder), messageSave = useServerFn(saveSupport), settingsSave = useServerFn(saveSettings), variantsSave = useServerFn(saveVariants);
  const query = useQuery({ queryKey: ['admin', user?.id], queryFn: () => fetchData(), enabled: ready && !!user, retry: false });
  const [saving, setSaving] = useState(false);
  async function change(action: () => Promise<unknown>) {
    setSaving(true);
    try { await action(); await queryClient.invalidateQueries({ queryKey: ['admin'] }); toast.success('Saved'); return true; }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save'); return false; }
    finally { setSaving(false); }
  }
  if (!ready) return <section className="container py-16">Loading…</section>;
  if (!user) return <section className="container py-16 space-y-4"><h1>Store administration</h1><Button asChild><Link to="/admin/login">Admin sign-in</Link></Button></section>;
  if (query.isPending) return <section className="container py-16">Checking admin access…</section>;
  if (query.isError || !query.data) return <section className="container py-16 space-y-4"><h1>Admin access required</h1><p>This account cannot access store administration.</p><Button onClick={() => void signOut()}>Sign out</Button><Button variant="outline" asChild><Link to="/admin/login">Admin sign-in</Link></Button></section>;
  const data = query.data;
  const live = data.orders.filter(o => o.status !== 'Cancelled');
  const revenue = live.reduce((n, o) => n + o.total, 0);
  const lowStock = data.variants.filter(v => v.stock <= 3);
  return <section className="container py-10 space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-muted-foreground flex items-center gap-2"><ShieldCheck size={16}/> {data.settings?.store_name ?? 'THE YEARTH STORE'}</p><h1>Store administration</h1></div><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Refresh records" title="Refresh records" onClick={() => void query.refetch()}><RefreshCw/></Button><Button variant="outline" onClick={() => void signOut()}>Sign out</Button></div></header>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2 border-b border-border pb-4">{sections.map(name => <Button key={name} variant={section === name ? 'default' : 'ghost'} onClick={() => setSection(name)}>{name}</Button>)}</nav>
    {section === 'Dashboard' && <div className="space-y-8">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">{[['Revenue', money(revenue)], ['Profit', money(live.reduce((n, o) => n + o.total - o.cost_total, 0))], ['Orders', data.orders.length], ['To ship', data.orders.filter(o => o.status === 'Processing').length], ['Customers', data.users.length], ['Products', data.products.length], ['Units in stock', data.variants.reduce((n, v) => n + v.stock, 0)], ['Open messages', data.messages.filter(m => m.status === 'open').length]].map(([label, value]) => <div key={label} className="border border-border p-4"><p className="text-muted-foreground text-sm">{label}</p><strong className="text-2xl">{value}</strong></div>)}</div>
      <div className="grid gap-8 lg:grid-cols-2">
        <div><h2>Recent orders</h2>{!data.orders.length && <p className="text-muted-foreground">No orders yet.</p>}{data.orders.slice(0, 5).map(o => <p key={o.id} className="flex justify-between border-b border-border py-3"><span>{o.order_number} · {o.ship_name} · {o.status}</span><b>{money(o.total)}</b></p>)}</div>
        <div><h2>Low stock (3 or fewer)</h2>{!lowStock.length && <p className="text-muted-foreground">All sizes are well stocked.</p>}{lowStock.slice(0, 10).map(v => <p key={v.id} className="flex justify-between border-b border-border py-3"><span>{data.products.find(p => p.id === v.product_id)?.name} · {v.colour} / {v.size}</span><b className={v.stock ? '' : 'text-destructive'}>{v.stock}</b></p>)}</div>
      </div>
    </div>}
    {section === 'Products' && <><div className="flex justify-between items-center"><h2>Products ({data.products.length})</h2><Button onClick={() => setEditor('new')}><Plus/> Add product</Button></div>
      {!data.products.length && <p className="text-muted-foreground">No products yet.</p>}
      <div className="divide-y divide-border">{data.products.map(product => { const vs = data.variants.filter(v => v.product_id === product.id); return <div key={product.id} className="py-4 flex flex-wrap items-center gap-4">
        {thumb(product) && <img src={thumb(product)} alt={product.name} className="h-20 w-16 object-cover"/>}
        <div className="min-w-0 flex-1"><h3>{product.name}</h3><p className="text-muted-foreground">{money(product.price)} · {product.category} · {product.active ? 'Active' : 'Hidden'} · {vs.reduce((n, v) => n + v.stock, 0)} in stock</p></div>
        <Button variant="outline" size="icon" aria-label={`Edit ${product.name}`} title="Edit product" onClick={() => setEditor(product)}><Pencil/></Button>
      </div>; })}</div></>}
    {section === 'Orders' && <><h2>Orders ({data.orders.length})</h2>{!data.orders.length && <p>No orders yet.</p>}{data.orders.map(order => <form key={order.id} onSubmit={e => {e.preventDefault(); const f = new FormData(e.currentTarget); void change(() => orderSave({data:{id:order.id,status:f.get('status') as 'Processing',tracking_number:String(f.get('tracking') ?? ''),admin_note:String(f.get('note') ?? '')}}));}} className="border-b border-border py-6 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3>{order.order_number} · {order.ship_name}</h3><strong>{money(order.total)}</strong></div><p>{order.ship_address}, {order.ship_city}, {order.ship_state} {order.ship_pincode} · {order.ship_phone}</p><p>{order.payment_method} · {order.payment_status}</p>{order.order_items.map(item => <p key={item.id}>{item.quantity} × {item.product_name} · {item.colour} / {item.size}</p>)}<div className="grid gap-3 sm:grid-cols-3"><label>Status<select name="status" className="field" defaultValue={order.status}>{['Processing','Shipped','Delivered','Cancelled'].map(s=><option key={s}>{s}</option>)}</select></label><label>Tracking number<input name="tracking" className="field" defaultValue={order.tracking_number ?? ''}/></label><label>Internal note<input name="note" className="field" defaultValue={order.admin_note ?? ''}/></label></div><Button type="submit" disabled={saving}><Save/>Save order</Button></form>)}</>}
    {section === 'Users' && <><h2>Customers ({data.users.length})</h2><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-3">Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>{data.users.map(person=><tr key={person.id} className="border-t border-border"><td className="py-3 pr-4">{person.name || '—'}</td><td className="pr-4">{person.email}</td><td>{new Date(person.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>{!data.users.length && <p>No customers yet.</p>}</>}
    {section === 'Support' && <><h2>Support ({data.messages.length})</h2>{!data.messages.length && <p>No support messages yet.</p>}{data.messages.map(message=><article key={message.id} className="border-b border-border py-6 space-y-2"><h3>{message.topic} · {message.name}</h3><p className="text-muted-foreground">{message.email}</p><p className="whitespace-pre-wrap">{message.message}</p><label>Status<select className="field max-w-xs" value={message.status} disabled={saving} onChange={e=>void change(()=>messageSave({data:{id:message.id,status:e.target.value as 'open'|'resolved'}}))}><option value="open">Open</option><option value="resolved">Resolved</option></select></label></article>)}</>}
    {section === 'Settings' && <SettingsForm settings={data.settings} busy={saving} onSave={values=>change(()=>settingsSave({data:values}))}/>}
    <Modal open={editor !== null} onOpenChange={open=>{if(!open)setEditor(null);}} title={editor==='new'?'Add product':'Edit product'}>{editor && <ProductForm key={editor==='new'?'new':editor.id} product={editor==='new'?null:editor} settings={data.settings} existing={editor==='new'?[]:data.variants.filter(v=>v.product_id===editor.id)} busy={saving} onSave={async (values, variants)=>{ const ok = await change(async()=>{ const saved = await productSave({data:values}); await variantsSave({data:{product_id:saved.id,variants}}); }); if (ok) setEditor(null); }}/>}</Modal>
  </section>;
}

type VariantInput = { colour: string; colour_hex: string; size: string; stock: number };
function ProductForm({product,settings,existing,busy,onSave}:{product:Product|null;settings:Settings|null;existing:VariantRow[];busy:boolean;onSave:(values:Parameters<typeof saveProduct>[0]['data'],variants:VariantInput[])=>Promise<void>}) {
  const palette = shopColours(settings), sizeList = settings?.sizes ?? defaults.sizes;
  const [images, setImages] = useState<string[]>(product?.images?.length ? product.images : product?.image_url ? [product.image_url] : []);
  const [uploading, setUploading] = useState(false);
  const [picked, setPicked] = useState<string[]>(existing.length ? [...new Set(existing.filter(v=>v.stock>0).map(v=>v.colour))] : [product?.primary_colour ?? palette[0]?.name ?? 'Black']);
  const [pickedSizes, setPickedSizes] = useState<string[]>(existing.length ? [...new Set(existing.filter(v=>v.stock>0).map(v=>v.size))] : sizeList);
  const [stock, setStock] = useState<Record<string, number>>(Object.fromEntries(existing.map(v=>[`${v.colour}|${v.size}`, v.stock])));
  const toggle = (list: string[], set: (v: string[]) => void, value: string) => set(list.includes(value) ? list.filter(x=>x!==value) : [...list, value]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 10 - images.length)) {
        if (!file.type.startsWith('image/') || file.size > 5_000_000) { toast.error(`${file.name}: use an image under 5 MB`); continue; }
        const path = `${crypto.randomUUID()}.${file.name.split('.').pop() ?? 'jpg'}`;
        const up = await supabase.storage.from('product-images').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        const signed = await supabase.storage.from('product-images').createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
        if (signed.error) throw signed.error;
        setImages(prev => [...prev, signed.data.signedUrl]);
      }
    } catch { toast.error('Image upload failed'); } finally { setUploading(false); }
  }
  function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const f=new FormData(e.currentTarget);
    const compare = Number(f.get('compare') || 0);
    const variants: VariantInput[] = [];
    const keys = new Set([...existing.map(v=>`${v.colour}|${v.size}`), ...picked.flatMap(c=>pickedSizes.map(s=>`${c}|${s}`))]);
    for (const key of keys) { const [colour='', size=''] = key.split('|'); const active = picked.includes(colour) && pickedSizes.includes(size); variants.push({ colour, size, colour_hex: palette.find(c=>c.name===colour)?.hex ?? existing.find(v=>v.colour===colour)?.colour_hex ?? '#000000', stock: active ? Math.max(0, Math.floor(stock[key] ?? 0)) : 0 }); }
    void onSave({id:product?.id,name:String(f.get('name')),slug:String(f.get('slug')).trim().toLowerCase(),price:Number(f.get('price')),compare_at_price:compare>0?compare:null,cost_price:Number(f.get('cost')||0),badge:String(f.get('badge')||'')||null,description:String(f.get('description')),category:String(f.get('category')),primary_colour:String(f.get('colour')),active:f.get('active')==='on',image_key:product?.image_key ?? null,image_url:images[0] ?? null,images}, variants);
  }
  return <form onSubmit={submit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
    <div className="grid gap-3 sm:grid-cols-2">{[['name','Name',product?.name??'','text'],['slug','Link name (e.g. black-tee)',product?.slug??'','text'],['price','Price (₹)',product?.price??'','number'],['compare','Original price (optional, shows sale)',product?.compare_at_price??'','number'],['cost','Cost price (₹, for profit)',product?.cost_price??0,'number'],['badge','Badge (optional)',product?.badge??'','text']].map(([name,label,value,type])=><label key={name} className="block">{label}<input className="field" name={String(name)} defaultValue={value} type={String(type)} min="0" required={['name','slug','price'].includes(String(name))}/></label>)}
      <label className="block">Category<select className="field" name="category" defaultValue={product?.category ?? settings?.categories?.[0]}>{[...new Set([...(settings?.categories ?? defaults.categories), ...(product ? [product.category] : [])])].map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="block">Main colour<select className="field" name="colour" defaultValue={product?.primary_colour ?? palette[0]?.name}>{palette.map(c=><option key={c.name}>{c.name}</option>)}</select></label></div>
    <label className="block">Description<textarea className="field" name="description" defaultValue={product?.description}/></label>
    <fieldset className="space-y-2"><legend className="font-semibold">Images</legend>
      <div className="flex flex-wrap gap-2">{images.map((src,i)=><div key={src} className="relative"><img src={src} alt={`Product image ${i+1}`} className="h-24 w-20 object-cover border border-border"/><Button type="button" size="icon" variant="outline" className="absolute right-0 top-0 h-7 w-7" aria-label="Remove image" onClick={()=>setImages(images.filter(x=>x!==src))}><Trash2/></Button></div>)}</div>
      <label className="inline-flex cursor-pointer items-center gap-2 border border-border px-3 py-2"><Upload size={16}/>{uploading ? 'Uploading…' : 'Add images'}<input type="file" accept="image/*" multiple className="sr-only" disabled={uploading || images.length >= 10} onChange={e=>{void upload(e.target.files); e.target.value='';}}/></label>
      <p className="text-sm text-muted-foreground">First image is the main photo. Up to 10.</p>
    </fieldset>
    <fieldset className="space-y-2"><legend className="font-semibold">Colours</legend><div className="flex flex-wrap gap-3">{palette.map(c=><label key={c.name} className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(c.name)} onChange={()=>toggle(picked,setPicked,c.name)}/><span className="colour-dot" style={{backgroundColor:c.hex}}/>{c.name}</label>)}</div></fieldset>
    <fieldset className="space-y-2"><legend className="font-semibold">Sizes</legend><div className="flex flex-wrap gap-3">{sizeList.map(s=><label key={s} className="flex items-center gap-2"><input type="checkbox" checked={pickedSizes.includes(s)} onChange={()=>toggle(pickedSizes,setPickedSizes,s)}/>{s}</label>)}</div></fieldset>
    {picked.length > 0 && pickedSizes.length > 0 && <fieldset className="space-y-2"><legend className="font-semibold">In-stock quantity</legend><div className="overflow-x-auto"><table className="text-sm"><thead><tr><th className="pr-3 text-left">Colour</th>{pickedSizes.map(s=><th key={s} className="px-1">{s}</th>)}</tr></thead><tbody>{picked.map(c=><tr key={c}><td className="pr-3">{c}</td>{pickedSizes.map(s=>{const key=`${c}|${s}`; return <td key={s} className="px-1 py-1"><input type="number" min="0" aria-label={`Stock ${c} ${s}`} className="field w-20" value={stock[key] ?? 0} onChange={e=>setStock({...stock,[key]:Number(e.target.value)})}/></td>;})}</tr>)}</tbody></table></div></fieldset>}
    <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={product?.active??true}/>Show in shop</label>
    <Button type="submit" disabled={busy || uploading}><Save/>Save product</Button></form>;
}

function ListEditor({label,items,onChange}:{label:string;items:string[];onChange:(v:string[])=>void}) {
  const [draft, setDraft] = useState('');
  return <fieldset className="space-y-2"><legend className="font-semibold">{label}</legend>
    {items.map((item,i)=><div key={i} className="flex gap-2"><input className="field" aria-label={`${label} ${i+1}`} value={item} onChange={e=>onChange(items.map((x,j)=>j===i?e.target.value:x))}/><Button type="button" variant="outline" size="icon" aria-label={`Remove ${item}`} onClick={()=>onChange(items.filter((_,j)=>j!==i))}><Trash2/></Button></div>)}
    <div className="flex gap-2"><input className="field" placeholder={`Add ${label.toLowerCase()}`} value={draft} onChange={e=>setDraft(e.target.value)}/><Button type="button" variant="outline" onClick={()=>{ if(draft.trim() && !items.includes(draft.trim())) onChange([...items, draft.trim()]); setDraft(''); }}><Plus/>Add</Button></div>
  </fieldset>;
}

function SettingsForm({settings,busy,onSave}:{settings:Settings|null;busy:boolean;onSave:(values:Parameters<typeof saveSettings>[0]['data'])=>Promise<unknown>}) {
  const [categories, setCategories] = useState(settings?.categories ?? defaults.categories);
  const [sizes, setSizes] = useState(settings?.sizes ?? defaults.sizes);
  const [colours, setColours] = useState<Colour[]>(shopColours(settings));
  const [filters, setFilters] = useState<string[]>(settings?.filters ?? ['Category','Size','Color','Price']);
  return <form className="max-w-2xl space-y-6" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void onSave({store_name:String(f.get('store_name')),announcement:String(f.get('announcement')),support_email:String(f.get('support_email')),free_shipping_threshold:Number(f.get('free_shipping_threshold')),shipping_fee:Number(f.get('shipping_fee')),cod_enabled:f.get('cod_enabled')==='on',razorpay_enabled:f.get('razorpay_enabled')==='on',categories:categories.map(c=>c.trim()).filter(Boolean),sizes:sizes.map(s=>s.trim()).filter(Boolean),colours:colours.filter(c=>c.name.trim()),price_min:Number(f.get('price_min')),price_max:Number(f.get('price_max')),filters:filters as ('Category')[]});}}>
    <h2>Store settings</h2>
    {[['store_name','Store name',settings?.store_name??'THE YEARTH STORE'],['announcement','Announcement',settings?.announcement??''],['support_email','Support email',settings?.support_email??''],['free_shipping_threshold','Free shipping above (₹)',settings?.free_shipping_threshold??999],['shipping_fee','Shipping fee (₹)',settings?.shipping_fee??79]].map(([name,label,value])=><label key={name} className="block">{label}<input name={String(name)} className="field" type={name==='support_email'?'email':typeof value==='number'?'number':'text'} min="0" defaultValue={value}/></label>)}
    {[['cod_enabled','Cash on delivery',settings?.cod_enabled??true],['razorpay_enabled','Online payments',settings?.razorpay_enabled??false]].map(([name,label,value])=><label key={String(name)} className="flex items-center gap-2"><input type="checkbox" name={String(name)} defaultChecked={Boolean(value)}/>{label}</label>)}
    <h2>Shop page</h2>
    <ListEditor label="Categories" items={categories} onChange={setCategories}/>
    <ListEditor label="Sizes" items={sizes} onChange={setSizes}/>
    <fieldset className="space-y-2"><legend className="font-semibold">Colours</legend>
      {colours.map((c,i)=><div key={i} className="flex gap-2 items-center"><input type="color" aria-label={`Colour shade ${i+1}`} value={c.hex} onChange={e=>setColours(colours.map((x,j)=>j===i?{...x,hex:e.target.value}:x))} className="h-10 w-12"/><input className="field" aria-label={`Colour name ${i+1}`} value={c.name} onChange={e=>setColours(colours.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/><Button type="button" variant="outline" size="icon" aria-label={`Remove ${c.name}`} onClick={()=>setColours(colours.filter((_,j)=>j!==i))}><Trash2/></Button></div>)}
      <Button type="button" variant="outline" onClick={()=>setColours([...colours,{name:'New colour',hex:'#777777'}])}><Plus/>Add colour</Button>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2"><label className="block">Price filter minimum (₹)<input name="price_min" className="field" type="number" min="0" defaultValue={settings?.price_min ?? 249}/></label><label className="block">Price filter maximum (₹)<input name="price_max" className="field" type="number" min="1" defaultValue={settings?.price_max ?? 1499}/></label></div>
    <fieldset className="space-y-2"><legend className="font-semibold">Filters shown on shop page</legend><div className="flex flex-wrap gap-4">{allFilters.map(name=><label key={name} className="flex items-center gap-2"><input type="checkbox" checked={filters.includes(name)} onChange={()=>setFilters(filters.includes(name)?filters.filter(x=>x!==name):[...filters,name])}/>{name === 'Availability' ? 'In stock only' : name === 'Rating' ? 'Top rated' : name}</label>)}</div></fieldset>
    <Button type="submit" disabled={busy}><Save/>Save settings</Button></form>;
}
