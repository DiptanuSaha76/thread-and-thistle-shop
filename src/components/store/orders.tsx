import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Package, Check, Truck, ArrowRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Modal } from "./shared";
import { useStore } from "@/lib/store/state";
import { products, imageFor, money, type Order } from "@/lib/store/catalogue";
import { getOrderTracking } from "@/lib/shipping/functions";
import { orderTimeline } from "@/lib/store/orders";
export function OrdersPage() {
  const store = useStore(),
    navigate = useNavigate();
  const [tab, setTab] = useState("All Orders"),
    [detail, setDetail] = useState<Order | null>(null),
    [cancel, setCancel] = useState<Order | null>(null),
    [tracking, setTracking] = useState(false);
  const orders = store.orders.filter((o) => tab === "All Orders" || o.status === tab);
  const repeat = (o: Order) => {
    // One message for the whole order instead of one per item.
    const outcomes = o.items.map((l) =>
      store.add(
        { productId: l.productId, colour: l.colour, size: l.size, quantity: l.quantity },
        { quiet: true },
      ),
    );
    if (outcomes.every((r) => r.kind === "added" || r.kind === "increased"))
      toast.success("Items added to your bag");
    else if (
      outcomes.some((r) => r.kind === "added" || r.kind === "increased" || r.kind === "limited")
    )
      toast("Some items were added. Others are out of stock or already at the limit in your bag.");
    else toast.error("These items are out of stock or already at the limit in your bag.");
    navigate({ to: "/cart" });
  };
  const open = (o: Order, track = false) => {
    setDetail(o);
    setTracking(track);
  };
  return (
    <section className="container standard-page orders-page">
      <div className="orders-heading">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/account" aria-label="Back to account">
            <ArrowLeft />
          </Link>
        </Button>
        <h1>My Orders</h1>
      </div>
      <p className="info-note">
        Orders placed with your signed-in account.
      </p>
      <nav className="order-tabs" aria-label="Order status">
        {["All Orders", "Processing", "Shipped", "Delivered", "Cancelled"].map((s) => (
          <Button
            key={s}
            variant={s === tab ? "default" : "outline"}
            aria-pressed={s === tab}
            onClick={() => setTab(s)}
          >
            {s}
          </Button>
        ))}
      </nav>
      <div className="order-list">
        {orders.map((o) => (
          <article key={o.id} className="order-card">
            <div className="order-top">
              <div>
                <b>Order #{o.id}</b>
                <small>
                  {new Date(o.createdAt).toLocaleString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </small>
              </div>
              <span className={`status status-${o.status.toLowerCase().replace(/\s+/g, "-")}`}>{o.status}</span>
            </div>
            {o.items.map((l, i) => {
              const p = products.find((p) => p.id === l.productId);
              return (
                p && (
                  <div className="order-product" key={i}>
                    <img
                      src={imageFor(p, l.colour)}
                      alt={p.name}
                    />
                    <div>
                      <b>{p.name}</b>
                      <p>
                        Size: {l.size} / Colour: {l.colour}
                      </p>
                      <small>Qty: {l.quantity}</small>
                    </div>
                    <b>{money(p.price * l.quantity)}</b>
                  </div>
                )
              );
            })}
            <Progress order={o} />
            <div className="order-bottom">
              <span>
                Total <b>{money(o.total)}</b>
              </span>
              <div>
                {o.status === "Processing" || o.status === "Awaiting payment" ? (
                  <Button variant="outline" onClick={() => setCancel(o)}>
                    Cancel Order
                  </Button>
                ) : o.status === "Shipped" ? (
                  <Button onClick={() => open(o, true)}>
                    <Truck />
                    Track Order
                  </Button>
                ) : (
                  <Button onClick={() => repeat(o)}>
                    Buy Again <ArrowRight />
                  </Button>
                )}
                <Button variant="outline" onClick={() => open(o)}>
                  View Details
                </Button>
              </div>
            </div>
          </article>
        ))}
        {!orders.length && (
          <div className="empty-state">
            <Package size={36} />
            <h2>No {tab === "All Orders" ? "" : tab.toLowerCase()} orders yet</h2>
            <Button variant="outline" onClick={() => setTab("All Orders")}>
              View all orders
            </Button>
          </div>
        )}
      </div>
      <Modal
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        title={tracking ? "Track your order" : `Order #${detail?.id ?? ""}`}
        description="Order details and delivery status"
      >
        {detail && (
          <>
            <span className={`status status-${detail.status.toLowerCase().replace(/\s+/g, "-")}`}>{detail.status}</span>
            <Progress order={detail} />
            {tracking && <TrackingDetails order={detail} />}
            {detail.items.map((l, i) => {
              const p = products.find((p) => p.id === l.productId);
              return (
                p && (
                  <div className="summary-item" key={i}>
                    <img src={imageFor(p, l.colour)} alt={p.name} />
                    <div>
                      <b>{p.name}</b>
                      <small>
                        {l.size} / {l.colour} · Qty {l.quantity}
                      </small>
                    </div>
                    <b>{money(p.price * l.quantity)}</b>
                  </div>
                )
              );
            })}
            {detail.shippingAddress ? (
              <p>
                <b>Delivery address</b>
                <br />
                {detail.shippingAddress.fullName}
                <br />
                {detail.shippingAddress.address}
                <br />
                {detail.shippingAddress.city}, {detail.shippingAddress.state}{" "}
                {detail.shippingAddress.pincode}
                <br />
                {detail.shippingAddress.phone}
              </p>
            ) : (
              <p>Address details will appear once your order is confirmed.</p>
            )}
            <p>Payment: {detail.paymentMethod}</p>
            <dl className="order-detail-totals">
              {[
                ["Subtotal", detail.subtotal],
                ["Shipping", detail.shipping],
                ["Discount", detail.discount],
                ["Total", detail.total],
              ].map(([label, n]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(Number(n))}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </Modal>
      <Modal
        open={!!cancel}
        onOpenChange={(o) => {
          if (!o) setCancel(null);
        }}
        title="Cancel this order?"
        description="This action cancels your order."
      >
        <p>Order #{cancel?.id} has not shipped yet. Are you sure you want to cancel?</p>
        <Button
          variant="destructive"
          onClick={() => {
            if (cancel) void store.cancel(cancel.id);
            setCancel(null);
          }}
        >
          Confirm cancellation
        </Button>
        <Button variant="outline" onClick={() => setCancel(null)}>
          Keep my order
        </Button>
      </Modal>
    </section>
  );
}
/** Live courier tracking for the customer's own order (ownership is checked on the server). */
function TrackingDetails({ order }: { order: Order }) {
  const fetchTracking = useServerFn(getOrderTracking);
  const query = useQuery({
    queryKey: ["order-tracking", order.dbId],
    queryFn: () => fetchTracking({ data: { orderId: order.dbId ?? "" } }),
    enabled: !!order.dbId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  if (!order.dbId) return <p>Tracking details aren’t available for this order.</p>;
  if (query.isPending) return <p role="status">Loading tracking details…</p>;
  if (query.isError || !query.data)
    return <p role="alert">{query.error instanceof Error ? query.error.message : "Tracking details aren't available right now."}</p>;
  const t = query.data;
  if (t.state === "not_shipped") return <p>Tracking details will appear here once your order has been dispatched.</p>;
  const courierLink =
    (t.state === "tracking" || t.state === "pending") && t.trackUrl ? (
      <a href={t.trackUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">
        Track on the courier page <ExternalLink size={14} />
      </a>
    ) : null;
  return (
    <div className="tracking-details" aria-live="polite">
      <p>
        Tracking number (AWB): <b>{t.awb}</b>
        {t.state === "tracking" && t.currentStatus && (
          <>
            <br />
            Current status: <b>{t.currentStatus}</b>
          </>
        )}
        {t.state === "tracking" && t.estimatedDelivery && (
          <>
            <br />
            Expected delivery: {t.estimatedDelivery}
          </>
        )}
      </p>
      {t.state === "manual" && <p>Your parcel has been handed to the courier. Use this tracking number on the courier’s website for the latest updates.</p>}
      {t.state === "pending" && <p>Your parcel has been handed to the courier. Tracking updates usually appear within 24 hours.</p>}
      {t.state === "unavailable" && <p>Live tracking isn’t available right now. Please try again later.</p>}
      {t.state === "tracking" && t.stale && <p><small>We couldn’t refresh tracking just now; these are the latest saved updates.</small></p>}
      {t.state === "tracking" && t.events.length > 0 && (
        <ol className="space-y-2 border-l border-neutral-200 pl-4 text-sm dark:border-neutral-800">
          {t.events.slice(0, 15).map((e, i) => (
            <li key={`${e.time}-${i}`}>
              <b>{e.activity}</b>
              <br />
              <small>{[e.location, e.time].filter(Boolean).join(" · ")}</small>
            </li>
          ))}
        </ol>
      )}
      {courierLink && <p>{courierLink}</p>}
    </div>
  );
}

function Progress({ order }: { order: Order }) {
  // Only recorded times are shown; steps without a recorded time say so instead of guessing.
  return (
    <div className={`order-progress ${order.status === "Cancelled" ? "cancelled" : ""}`}>
      {orderTimeline(order).map((step) => (
        <div key={step.label} className={step.done ? "complete" : ""}>
          <span>{step.done ? <Check size={12} /> : <span />}</span>
          <b>{step.label}</b>
          <small>
            {step.at
              ? new Date(step.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
              : step.note}
          </small>
        </div>
      ))}
    </div>
  );
}
