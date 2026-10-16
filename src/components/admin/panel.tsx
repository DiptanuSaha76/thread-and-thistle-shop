import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Save, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/store/shared';
import { colourImages, money } from '@/lib/store/catalogue';
import { useAuth } from '@/lib/auth';
import { getAdminData, saveProduct, saveOrder, saveSupport, saveSettings, saveVariant } from '@/lib/admin/functions';
import type { Database } from '@/integrations/supabase/types';
type Product = Database['public']['Tables']['products']['Row'];
type Settings = Database['public']['Tables']['store_settings']['Row'];
const sections = ['Products','Orders','Users','Support','Settings'] as const;
export function AdminPanel() {
  const { user, ready, signOut } = useAuth();
  const [section, setSection] = useState<typeof sections[number]>('Products');
  const [editor, setEditor] = useState<Product | 'new' | null>(null);
  const queryClient = useQueryClient();
  const fetchData = useServerFn(getAdminData), productSave = useServerFn(saveProduct), orderSave = useServerFn(saveOrder), messageSave = useServerFn(saveSupport), settingsSave = useServerFn(saveSettings), variantSave = useServerFn(saveVariant);
  const query = useQuery({ queryKey: ['admin', user?.id], queryFn: () => fetchData(), enabled: ready && !!user, retry: false });
  const [saving, setSaving] = useState(false);
  async function change(action: () => Promise<unknown>) {
    setSaving(true);
    try { await action(); await queryClient.invalidateQueries({ queryKey: ['admin'] }); toast.success('Saved'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save'); }
    finally { setSaving(false); }
  }
  if (!ready) return <section className="container py-16">Loading…</section>;
  if (!user) return <section className="container py-16 space-y-4"><h1>Store administration</h1><Button asChild><Link to="/admin/login">Admin sign-in</Link></Button></section>;
  if (query.isPending) return <section className="container py-16">Checking admin access…</section>;
  if (query.isError || !query.data) return <section className="container py-16 space-y-4"><h1>Admin access required</h1><p>This account cannot access store administration.</p><Button onClick={() => void signOut()}>Sign out</Button><Button variant="outline" asChild><Link to="/admin/login">Admin sign-in</Link></Button></section>;
  const data = query.data;
  return <section className="container py-10 space-y-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-muted-foreground flex items-center gap-2"><ShieldCheck size={16}/> THE YEARTH STORE</p><h1>Store administration</h1></div><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Refresh records" title="Refresh records" onClick={() => void query.refetch()}><RefreshCw/></Button><Button variant="outline" onClick={() => void signOut()}>Sign out</Button></div></header>
    <nav aria-label="Admin sections" className="flex flex-wrap gap-2 border-b border-border pb-4">{sections.map(name => <Button key={name} variant={section === name ? 'default' : 'ghost'} onClick={() => setSection(name)}>{name}</Button>)}</nav>
    {section === 'Products' && <><div className="flex justify-between items-center"><h2>Products ({data.products.length})</h2><Button onClick={() => setEditor('new')}><Plus/> Add product</Button></div>
      {!data.products.length && <p className="text-muted-foreground">No products yet.</p>}
      <div className="divide-y divide-border">{data.products.map(product => <div key={product.id} className="py-4 flex flex-wrap items-center gap-4">
        {product.image_key && colourImages[product.primary_colour] && <img src={colourImages[product.primary_colour]} alt={product.name} className="h-20 w-16 object-cover"/>}
        <div className="min-w-0 flex-1"><h3>{product.name}</h3><p className="text-muted-foreground">{money(product.price)} · {product.active ? 'Active' : 'Hidden'}</p></div><Button variant="outline" size="icon" aria-label={`Edit ${product.name}`} title="Edit product" onClick={() => setEditor(product)}><Pencil/></Button>
        <div className="basis-full flex flex-wrap gap-4">{data.variants.filter(v => v.product_id === product.id).map(v => <label key={v.id} className="text-sm">{v.colour} / {v.size}<input type="number" aria-label={`Stock ${v.colour} ${v.size}`} className="field w-24" min="0" defaultValue={v.stock} disabled={saving} onBlur={e => { const stock = Number(e.target.value); if(stock !== v.stock) void change(() => variantSave({ data: { id:v.id,stock } })); }}/></label>)}</div>
      </div>)}</div></>}
    {section === 'Orders' && <><h2>Orders ({data.orders.length})</h2>{!data.orders.length && <p>No orders yet.</p>}{data.orders.map(order => <form key={order.id} onSubmit={e => {e.preventDefault(); const f = new FormData(e.currentTarget); void change(() => orderSave({data:{id:order.id,status:f.get('status') as 'Processing',tracking_number:String(f.get('tracking') ?? ''),admin_note:String(f.get('note') ?? '')}}));}} className="border-b border-border py-6 space-y-3"><div className="flex flex-wrap justify-between gap-2"><h3>{order.order_number} · {order.ship_name}</h3><strong>{money(order.total)}</strong></div><p>{order.ship_address}, {order.ship_city}, {order.ship_state} {order.ship_pincode} · {order.ship_phone}</p><p>{order.payment_method} · {order.payment_status}</p>{order.order_items.map(item => <p key={item.id}>{item.quantity} × {item.product_name} · {item.colour} / {item.size}</p>)}<div className="grid gap-3 sm:grid-cols-3"><label>Status<select name="status" className="field" defaultValue={order.status}>{['Processing','Shipped','Delivered','Cancelled'].map(s=><option key={s}>{s}</option>)}</select></label><label>Tracking number<input name="tracking" className="field" defaultValue={order.tracking_number ?? ''}/></label><label>Internal note<input name="note" className="field" defaultValue={order.admin_note ?? ''}/></label></div><Button type="submit" disabled={saving}><Save/>Save order</Button></form>)}</>}
    {section === 'Users' && <><h2>Customers ({data.users.length})</h2><div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="py-3">Name</th><th>Email</th><th>Joined</th></tr></thead><tbody>{data.users.map(person=><tr key={person.id} className="border-t border-border"><td className="py-3 pr-4">{person.name || '—'}</td><td className="pr-4">{person.email}</td><td>{new Date(person.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div>{!data.users.length && <p>No customers yet.</p>}</>}
    {section === 'Support' && <><h2>Support ({data.messages.length})</h2>{!data.messages.length && <p>No support messages yet.</p>}{data.messages.map(message=><article key={message.id} className="border-b border-border py-6 space-y-2"><h3>{message.topic} · {message.name}</h3><p className="text-muted-foreground">{message.email}</p><p className="whitespace-pre-wrap">{message.message}</p><label>Status<select className="field max-w-xs" value={message.status} disabled={saving} onChange={e=>void change(()=>messageSave({data:{id:message.id,status:e.target.value as 'open'|'resolved'}}))}><option value="open">Open</option><option value="resolved">Resolved</option></select></label></article>)}</>}
    {section === 'Settings' && <SettingsForm settings={data.settings} busy={saving} onSave={values=>change(()=>settingsSave({data:values}))}/>}
    <Modal open={editor !== null} onOpenChange={open=>{if(!open)setEditor(null);}} title={editor==='new'?'Add product':'Edit product'}>{editor && <ProductForm key={editor==='new'?'new':editor.id} product={editor==='new'?null:editor} busy={saving} onSave={async values=>{await change(()=>productSave({data:values}));}}/>}</Modal>
  </section>;
}
function ProductForm({product,busy,onSave}:{product:Product|null;busy:boolean;onSave:(values:Parameters<typeof saveProduct>[0]['data'])=>Promise<void>}) {
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);void onSave({id:product?.id,name:String(f.get('name')),slug:String(f.get('slug')),price:Number(f.get('price')),description:String(f.get('description')),category:String(f.get('category')),primary_colour:String(f.get('colour')),active:f.get('active')==='on',image_key:product?.image_key ?? String(f.get('colour')).toLowerCase().replaceAll(' ','-')});}
  return <form onSubmit={submit} className="space-y-4">{[['name','Name',product?.name??''],['slug','Slug',product?.slug??''],['price','Price (₹)',product?.price??0],['category','Category',product?.category??'T-Shirts']].map(([name,label,value])=><label key={name} className="block">{label}<input className="field" name={String(name)} defaultValue={value} type={name==='price'?'number':'text'} min="0" required/></label>)}<label className="block">Colour<select className="field" name="colour" defaultValue={product?.primary_colour??'Black'}>{Object.keys(colourImages).map(c=><option key={c}>{c}</option>)}</select></label><label className="block">Description<textarea className="field" name="description" defaultValue={product?.description}/></label><label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={product?.active??true}/>Active</label><Button type="submit" disabled={busy}><Save/>Save product</Button></form>;
}
function SettingsForm({settings,busy,onSave}:{settings:Settings|null;busy:boolean;onSave:(values:Parameters<typeof saveSettings>[0]['data'])=>Promise<void>}) {
 return <form className="max-w-2xl space-y-4" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void onSave({store_name:String(f.get('store_name')),announcement:String(f.get('announcement')),support_email:String(f.get('support_email')),free_shipping_threshold:Number(f.get('free_shipping_threshold')),shipping_fee:Number(f.get('shipping_fee')),cod_enabled:f.get('cod_enabled')==='on',razorpay_enabled:f.get('razorpay_enabled')==='on'});}}><h2>Store settings</h2>{[['store_name','Store name',settings?.store_name??'THE YEARTH STORE'],['announcement','Announcement',settings?.announcement??''],['support_email','Support email',settings?.support_email??''],['free_shipping_threshold','Free shipping threshold (₹)',settings?.free_shipping_threshold??999],['shipping_fee','Shipping fee (₹)',settings?.shipping_fee??79]].map(([name,label,value])=><label key={name} className="block">{label}<input name={String(name)} className="field" type={name==='support_email'?'email':typeof value==='number'?'number':'text'} min="0" defaultValue={value}/></label>)}{[['cod_enabled','Cash on delivery',settings?.cod_enabled??true],['razorpay_enabled','Online payments',settings?.razorpay_enabled??false]].map(([name,label,value])=><label key={String(name)} className="flex items-center gap-2"><input type="checkbox" name={String(name)} defaultChecked={Boolean(value)}/>{label}</label>)}<Button type="submit" disabled={busy}><Save/>Save settings</Button></form>;
}
