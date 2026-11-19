import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Link2, Package, RefreshCw, Save, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Database } from "@/integrations/supabase/types";
import { money } from "@/lib/store/catalogue";
import { saveOrder } from "@/lib/admin/functions";
import { createShiprocketOrderDirectly, linkManualShiprocketShipment, refreshManualShiprocketTracking, setManualShipmentStage } from "@/lib/shipping/functions";
import { normalizeShipmentStage, SHIPMENT_STAGE_OPTIONS, type ShipmentStage } from "@/lib/shipping/status";

type OrderItem = {
  id: string;
  product_name: string;
  product_slug: string | null;
  colour: string;
  size: string;
  quantity: number;
  unit_price: number;
};
type AdminOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: string;
  payment_method: string;
  payment_status: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  admin_note: string | null;
  tracking_number: string | null;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_city: string;
  ship_state: string;
  ship_pincode: string;
  order_items: OrderItem[];
};
type Fulfilment = Database["public"]["Tables"]["shiprocket_fulfillments"]["Row"];

type Stage = ShipmentStage;

function initialStage(order: AdminOrder, fulfilment?: Fulfilment): Stage {
  return normalizeShipmentStage(fulfilment?.fulfilment_status, order.status);
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}


export function AdminOrders({ orders, fulfilments }: { orders: AdminOrder[]; fulfilments: Fulfilment[] }) {
  if (!orders.length) return <div className="rounded-lg border border-border p-8 text-center text-muted-foreground">No orders yet.</div>;
  const fulfilmentByOrder = new Map(fulfilments.map((item) => [item.order_id, item]));
  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2>Orders ({orders.length})</h2>
          <p className="text-sm text-muted-foreground">Prepare the parcel here and create the order directly in Shiprocket. Then use Ship Now in the Shiprocket dashboard.</p>
        </div>
        <p className="text-xs text-muted-foreground">Shipment status syncs automatically after an AWB is linked and the webhook is active.</p>
      </header>
      <div className="space-y-3">
        {orders.map((order) => <AdminOrderCard key={order.id} order={order} fulfilment={fulfilmentByOrder.get(order.id)} />)}
      </div>
    </section>
  );
}

function AdminOrderCard({ order, fulfilment }: { order: AdminOrder; fulfilment?: Fulfilment }) {
  const queryClient = useQueryClient();
  const linkShipment = useServerFn(linkManualShiprocketShipment);
  const updateStage = useServerFn(setManualShipmentStage);
  const refreshTracking = useServerFn(refreshManualShiprocketTracking);
  const createDirectOrder = useServerFn(createShiprocketOrderDirectly);
  const updateOrder = useServerFn(saveOrder);
  const [stage, setStage] = useState<Stage>(() => initialStage(order, fulfilment));
  const [awb, setAwb] = useState(fulfilment?.awb ?? order.tracking_number ?? "");
  const [shipmentId, setShipmentId] = useState(fulfilment?.shiprocket_shipment_id == null ? "" : String(fulfilment.shiprocket_shipment_id));
  const [shiprocketOrderId, setShiprocketOrderId] = useState(fulfilment?.shiprocket_order_id == null ? "" : String(fulfilment.shiprocket_order_id));
  const [courierName, setCourierName] = useState(fulfilment?.courier_name ?? "");
  const [note, setNote] = useState(order.admin_note ?? "");
  const [showPreparation, setShowPreparation] = useState(false);
  const [parcelWeight, setParcelWeight] = useState(fulfilment?.parcel_weight_kg == null ? "" : String(fulfilment.parcel_weight_kg));
  const [parcelLength, setParcelLength] = useState(fulfilment?.parcel_length_cm == null ? "" : String(fulfilment.parcel_length_cm));
  const [parcelBreadth, setParcelBreadth] = useState(fulfilment?.parcel_breadth_cm == null ? "" : String(fulfilment.parcel_breadth_cm));
  const [parcelHeight, setParcelHeight] = useState(fulfilment?.parcel_height_cm == null ? "" : String(fulfilment.parcel_height_cm));
  const [busy, setBusy] = useState<"stage" | "link" | "note" | "sync" | "prepare" | "">("");
  const [linkError, setLinkError] = useState("");
  const [createError, setCreateError] = useState("");
  const hasAwb = Boolean(fulfilment?.awb);
  const hasShiprocketOrder = Boolean(fulfilment?.shiprocket_order_id && fulfilment?.shiprocket_shipment_id);
  const detailsSentAt = fulfilment?.details_sent_at ?? null;
  const isDetailsSent = hasShiprocketOrder;
  const needsVerifiedRetry = Boolean(fulfilment?.order_create_attempted_at && !hasShiprocketOrder);
  const sourceLabel = fulfilment?.status_source === "webhook" ? "Auto · Shiprocket webhook" : fulfilment?.status_source === "tracking_api" ? "Auto · tracking API refresh" : "Manual / awaiting webhook";
  const rawTrackingStatus = fulfilment?.last_tracking_status;
  const stageLabel = SHIPMENT_STAGE_OPTIONS.find((item) => item.value === stage)?.label ?? "Processing";
  const itemCount = useMemo(() => order.order_items.reduce((sum, item) => sum + Number(item.quantity || 0), 0), [order.order_items]);

  useEffect(() => {
    setStage(initialStage(order, fulfilment));
    setAwb(fulfilment?.awb ?? order.tracking_number ?? "");
    setShipmentId(fulfilment?.shiprocket_shipment_id == null ? "" : String(fulfilment.shiprocket_shipment_id));
    setShiprocketOrderId(fulfilment?.shiprocket_order_id == null ? "" : String(fulfilment.shiprocket_order_id));
    setCourierName(fulfilment?.courier_name ?? "");
    setNote(order.admin_note ?? "");
    setParcelWeight(fulfilment?.parcel_weight_kg == null ? "" : String(fulfilment.parcel_weight_kg));
    setParcelLength(fulfilment?.parcel_length_cm == null ? "" : String(fulfilment.parcel_length_cm));
    setParcelBreadth(fulfilment?.parcel_breadth_cm == null ? "" : String(fulfilment.parcel_breadth_cm));
    setParcelHeight(fulfilment?.parcel_height_cm == null ? "" : String(fulfilment.parcel_height_cm));
  }, [order, fulfilment]);

  async function refreshAdmin() {
    await queryClient.invalidateQueries({ queryKey: ["admin"] });
  }

  async function saveStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("stage");
    try {
      await updateStage({ data: { orderId: order.id, stage } });
      toast.success(`Status updated: ${stageLabel}`);
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Status could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function syncTracking() {
    setBusy("sync");
    try {
      const result = await refreshTracking({ data: { orderId: order.id } });
      toast.success(result.currentStatus ? `Tracking refreshed: ${result.currentStatus}` : "No courier scan activity is available yet.");
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tracking could not be refreshed.");
    } finally {
      setBusy("");
    }
  }

  async function saveAwb(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLinkError("");
    setBusy("link");
    try {
      const result = await linkShipment({ data: { orderId: order.id, awb, shipmentId, shiprocketOrderId, courierName } });
      toast.success(`AWB ${result.awb} linked to ${order.order_number}. New Shiprocket webhook events can now match this order.`);
      await refreshAdmin();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shipment details could not be linked.";
      setLinkError(message);
      toast.error(message);
    } finally {
      setBusy("");
    }
  }

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("note");
    try {
      await updateOrder({ data: {
        id: order.id,
        status: order.status as "Processing" | "Shipped" | "Delivered" | "Cancelled",
        tracking_number: order.tracking_number ?? "",
        admin_note: note,
      } });
      toast.success("Internal note saved.");
      await refreshAdmin();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Note could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function sendDetailsToShiprocket(confirmRetryAfterManualCheck = false) {
    const values = {
      weightKg: Number(parcelWeight),
      lengthCm: Number(parcelLength),
      breadthCm: Number(parcelBreadth),
      heightCm: Number(parcelHeight),
    };
    if (Object.values(values).some((value) => !Number.isFinite(value) || value <= 0)) {
      toast.error("Enter valid parcel weight, length, breadth and height before continuing.");
      return;
    }
    if (hasShiprocketOrder) {
      toast.error("This YEARTH order already exists in Shiprocket. Use Ship Now from the Shiprocket dashboard.");
      return;
    }

    setBusy("prepare");
    setCreateError("");
    try {
      const result = await createDirectOrder({
        data: {
          orderId: order.id,
          ...values,
          confirmRetryAfterManualCheck,
        },
      });
      const message = result.reconciled
        ? `Existing Shiprocket order #${result.shiprocketOrderId} was found and linked.`
        : result.alreadyCreated
          ? `Shiprocket order #${result.shiprocketOrderId} already exists.`
          : `Shiprocket order created successfully. Order #${result.shiprocketOrderId} · Shipment #${result.shiprocketShipmentId}.`;
      toast.success(message);
      setShowPreparation(false);
      await refreshAdmin();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shiprocket order could not be created.";
      setCreateError(message);
      toast.error(message);
      // Reload the persisted attempt marker so the UI can expose a guarded retry.
      await refreshAdmin();
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_245px]">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="font-semibold">{order.order_number} · {order.ship_name}</h3>
            <span className="text-xs text-muted-foreground">{dateLabel(order.created_at)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{order.payment_method.toUpperCase()} · {order.payment_status}</span>
            <span>{itemCount} item(s)</span>
            <span>{order.ship_city}, {order.ship_state} {order.ship_pincode}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-foreground">{money(order.total)}</span>
            {fulfilment?.awb && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">AWB linked · {fulfilment.awb}</span>}
            {fulfilment?.courier_name && <span className="text-xs text-muted-foreground">{fulfilment.courier_name}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {isDetailsSent ? (
              <>
                <Button type="button" size="sm" variant="outline" disabled><CheckCircle2 size={15}/>Order created in Shiprocket</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowPreparation((open) => !open)}>{showPreparation ? "Hide details" : "View Again"}</Button>
                {detailsSentAt && <span className="text-xs text-muted-foreground">{dateLabel(detailsSentAt)}</span>}
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowPreparation((open) => !open)}>
                <Package size={15}/>Create Order
              </Button>
            )}
            {hasShiprocketOrder && <span className="self-center text-xs text-muted-foreground">SR order #{fulfilment?.shiprocket_order_id} · Shipment #{fulfilment?.shiprocket_shipment_id}</span>}
            {fulfilment?.awb && <span className="self-center text-xs text-muted-foreground">Tracking linked · {fulfilment.awb}</span>}
          </div>
        </div>

        <form onSubmit={saveStage} className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`stage-${order.id}`} className="text-sm font-semibold">Order / shipping status</label>
            <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${(fulfilment?.status_source === "webhook" || fulfilment?.status_source === "tracking_api") ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
              {(fulfilment?.status_source === "webhook" || fulfilment?.status_source === "tracking_api") ? "AUTO" : "MANUAL"}
            </span>
          </div>
          <select id={`stage-${order.id}`} className="field" value={stage} onChange={(event) => setStage(event.target.value as Stage)}>
            {SHIPMENT_STAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <Button type="submit" size="sm" className="w-full" disabled={busy !== "" || stage === initialStage(order, fulfilment)}>
            {busy === "stage" ? <RefreshCw className="animate-spin" size={15}/> : <Save size={15}/>}Save status
          </Button>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {rawTrackingStatus ? `Shiprocket: ${rawTrackingStatus}` : hasAwb ? "AWB linked. Waiting for the first Shiprocket scan/webhook." : "Link an AWB below to enable automatic shipment updates."}
          </p>
          {fulfilment?.last_tracking_event_at && <p className="text-[11px] text-muted-foreground">Last event: {dateLabel(fulfilment.last_tracking_event_at)}</p>}
          <p className="text-[10px] text-muted-foreground">Status source: {sourceLabel}</p>
          {hasAwb && <Button type="button" size="sm" variant="outline" className="w-full" disabled={busy !== ""} onClick={() => void syncTracking()}>
            {busy === "sync" ? <RefreshCw size={14} className="animate-spin"/> : <RefreshCw size={14}/>}Refresh from Shiprocket
          </Button>}
        </form>
      </div>

      {showPreparation && (
        <section className="mt-4 space-y-4 rounded-lg border border-primary/20 bg-muted/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="font-semibold">Prepare Shiprocket order</h4>
              <p className="mt-1 text-xs text-muted-foreground">Review the customer/items and final packed parcel measurements. Send to Shiprocket creates the actual order in your Shiprocket account through the secure backend API.</p>
            </div>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-medium text-emerald-900">Direct API creation</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
              <h5 className="font-medium">Customer and delivery</h5>
              <p><b>Order:</b> {order.order_number}</p>
              <p><b>Name:</b> {order.ship_name}</p>
              <p><b>Phone:</b> {order.ship_phone}</p>
              <p><b>Address:</b> {order.ship_address}, {order.ship_city}, {order.ship_state} — {order.ship_pincode}</p>
              <p><b>Payment:</b> {order.payment_method.toUpperCase()} · {order.payment_status}</p>
              <p><b>Pickup:</b> The Yearth Store · 700113</p>
            </div>
            <div className="space-y-2 rounded-md border border-border bg-card p-3 text-sm">
              <h5 className="font-medium">Products in this order</h5>
              {order.order_items.map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
                  <span>{item.quantity} × {item.product_name} · {item.colour} / {item.size}</span>
                  <b className="shrink-0">{money(item.unit_price * item.quantity)}</b>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-2"><span>Order total</span><b>{money(order.total)}</b></div>
              {order.payment_method.toLowerCase() === "cod" && <p className="text-xs text-muted-foreground">COD to collect: {money(order.total)}</p>}
            </div>
          </div>
          <div className="space-y-3 rounded-md border border-border bg-card p-3">
            <div>
              <h5 className="font-medium">Final packed parcel measurements</h5>
              <p className="mt-1 text-xs text-muted-foreground">Measure the complete outer mailer/box after packing. These exact values are saved to this YEARTH order and sent in the Shiprocket API request.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="block text-xs font-medium">Weight (kg)<input className="field mt-1" type="number" min="0.001" max="30" step="0.001" value={parcelWeight} onChange={(event) => setParcelWeight(event.target.value)} placeholder="e.g. 0.450" required disabled={hasAwb || hasShiprocketOrder}/></label>
              <label className="block text-xs font-medium">Length (cm)<input className="field mt-1" type="number" min="1" max="300" step="0.1" value={parcelLength} onChange={(event) => setParcelLength(event.target.value)} placeholder="e.g. 32" required disabled={hasAwb || hasShiprocketOrder}/></label>
              <label className="block text-xs font-medium">Breadth (cm)<input className="field mt-1" type="number" min="1" max="300" step="0.1" value={parcelBreadth} onChange={(event) => setParcelBreadth(event.target.value)} placeholder="e.g. 26" required disabled={hasAwb || hasShiprocketOrder}/></label>
              <label className="block text-xs font-medium">Height (cm)<input className="field mt-1" type="number" min="1" max="300" step="0.1" value={parcelHeight} onChange={(event) => setParcelHeight(event.target.value)} placeholder="e.g. 4" required disabled={hasAwb || hasShiprocketOrder}/></label>
            </div>
            {fulfilment?.parcel_measured_at && <p className="text-[11px] text-muted-foreground">Last saved measurement: {dateLabel(fulfilment.parcel_measured_at)}</p>}
          </div>
          {hasShiprocketOrder && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">Shiprocket order created successfully</p>
              <p className="mt-1 text-xs">Shiprocket Order ID: {fulfilment?.shiprocket_order_id} · Shipment ID: {fulfilment?.shiprocket_shipment_id}</p>
              <p className="mt-1 text-xs">Open Shiprocket → Orders → All/New and use Ship Now to choose a courier, assign AWB and request pickup.</p>
              {fulfilment?.shiprocket_reference && <p className="mt-1 text-xs">YEARTH source reference: {fulfilment.shiprocket_reference}</p>}
            </div>
          )}
          {needsVerifiedRetry && !hasShiprocketOrder && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-medium">Previous API attempt needs verification</p>
              <p className="text-xs">Before retrying, check Shiprocket Orders → All using source reference {fulfilment?.shiprocket_reference ?? "shown after the first attempt"}. Retry only after confirming that no matching order exists.</p>
              {fulfilment?.order_create_error && <p className="text-xs">Previous response: {fulfilment.order_create_error}</p>}
              <Button type="button" size="sm" disabled={busy !== ""} onClick={() => void sendDetailsToShiprocket(true)}>
                {busy === "prepare" ? <RefreshCw size={15} className="animate-spin"/> : <RefreshCw size={15}/>}Retry after checking Shiprocket
              </Button>
            </div>
          )}
          {createError && !needsVerifiedRetry && !hasShiprocketOrder && <p role="alert" className="text-xs text-destructive">{createError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {!hasShiprocketOrder && !needsVerifiedRetry && (
              <Button type="button" disabled={busy !== "" || hasAwb} onClick={() => void sendDetailsToShiprocket(false)}>
                {busy === "prepare" ? <RefreshCw size={15} className="animate-spin"/> : <Truck size={15}/>}Send to Shiprocket
              </Button>
            )}
            <Button type="button" variant="outline" disabled={busy !== ""} onClick={() => setShowPreparation(false)}>Close</Button>
            {!hasShiprocketOrder && !needsVerifiedRetry && <p className="basis-full text-[11px] text-muted-foreground">This button creates a real Shiprocket order via API. It does not select a courier, assign an AWB or book pickup. Complete those steps using Ship Now in the Shiprocket dashboard.</p>}
          </div>
        </section>
      )}

      <div className="mt-3 grid gap-2 border-t border-border pt-3 md:grid-cols-2">
        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Order details & products</summary>
          <div className="mt-3 space-y-2 text-sm">
            <p><b>Phone:</b> {order.ship_phone}</p>
            <p><b>Address:</b> {order.ship_address}, {order.ship_city}, {order.ship_state} {order.ship_pincode}</p>
            <div className="space-y-1"><b>Items</b>{order.order_items.map((item) => <p key={item.id} className="text-muted-foreground">{item.quantity} × {item.product_name} · {item.colour} / {item.size}</p>)}</div>
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs">
              <span>Subtotal: {money(order.subtotal)}</span><span>Shipping: {money(order.shipping)}</span>
              <span>Discount: {money(order.discount)}</span><b>Total: {money(order.total)}</b>
            </div>
            <form onSubmit={saveNote} className="space-y-2 border-t border-border pt-2">
              <label className="block text-xs font-medium">Internal note<input className="field mt-1" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000}/></label>
              <Button type="submit" size="sm" variant="outline" disabled={busy !== ""}><Save size={14}/>Save note</Button>
            </form>
          </div>
        </details>

        <details className="rounded-md border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Link tracking from Shiprocket</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs leading-5 text-muted-foreground">After this YEARTH order has been created in Shiprocket and you complete Ship Now there, paste the generated AWB here. Shipment ID, Shiprocket Order ID and courier name are optional references.</p>
            <form onSubmit={saveAwb} className="space-y-2">
              <label className="block text-xs font-medium">AWB / Tracking number *<input className="field mt-1" value={awb} onChange={(event) => setAwb(event.target.value)} placeholder="Paste Shiprocket AWB" required minLength={6} maxLength={40}/></label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs font-medium">Shipment ID (optional)<input className="field mt-1" value={shipmentId} onChange={(event) => setShipmentId(event.target.value)} inputMode="numeric" placeholder="Shiprocket shipment ID" maxLength={18}/></label>
                <label className="block text-xs font-medium">Shiprocket Order ID (optional)<input className="field mt-1" value={shiprocketOrderId} onChange={(event) => setShiprocketOrderId(event.target.value)} inputMode="numeric" placeholder="Shiprocket order ID" maxLength={18}/></label>
              </div>
              <label className="block text-xs font-medium">Courier partner (optional)<input className="field mt-1" value={courierName} onChange={(event) => setCourierName(event.target.value)} placeholder="e.g. Delhivery Surface" maxLength={120}/></label>
              {linkError && <p role="alert" className="text-xs text-destructive">{linkError}</p>}
              <Button type="submit" size="sm" variant="outline" disabled={busy !== "" || awb.trim().length < 6}>
                {busy === "link" ? <RefreshCw size={14} className="animate-spin"/> : <Link2 size={14}/>}Save / link AWB
              </Button>
            </form>
            <p className="text-[11px] text-muted-foreground">Automatic webhook updates match by AWB. Shipment ID is stored for reference. You can also use Refresh from Shiprocket for a read-only tracking lookup.</p>
            {fulfilment?.awb && <p className="rounded bg-emerald-50 p-2 text-xs text-emerald-900"><Truck size={13} className="mr-1 inline"/>Linked: {fulfilment.awb}{fulfilment.courier_name ? ` · ${fulfilment.courier_name}` : ""}</p>}
          </div>
        </details>
      </div>
    </article>
  );
}
