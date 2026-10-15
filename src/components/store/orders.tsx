import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Package, Check, Truck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "./shared";
import { useStore } from "@/lib/store/state";
import { products, colourImages, money, type Order } from "@/lib/store/catalogue";
export function OrdersPage() {
  const store = useStore(),
    navigate = useNavigate();
  const [tab, setTab] = useState("All Orders"),
    [detail, setDetail] = useState<Order | null>(null),
    [cancel, setCancel] = useState<Order | null>(null),
    [tracking, setTracking] = useState(false);
  const orders = store.orders.filter((o) => tab === "All Orders" || o.status === tab);
  const repeat = (o: Order) => {
    o.items.forEach((l) => store.add(l));
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
      <p className="sample-note">
        Prototype orders · Sample records and orders you place in this demo.
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
              <span className={`status status-${o.status.toLowerCase()}`}>{o.status}</span>
            </div>
            {o.items.map((l, i) => {
              const p = products.find((p) => p.id === l.productId);
              return (
                p && (
                  <div className="order-product" key={i}>
                    <img
                      src={l.colour === p.colour ? p.image : colourImages[l.colour]}
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
                {o.status === "Processing" ? (
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
        description="Demo order details · Not a real shipment"
      >
        {detail && (
          <>
            <span className={`status status-${detail.status.toLowerCase()}`}>{detail.status}</span>
            <Progress order={detail} />
            {tracking && (
              <p>
                Demo tracking number: YRT-DEMO-{detail.id}
                <br />
                Your parcel is on its way. Estimated delivery: 3–5 business days after dispatch.
              </p>
            )}
            {detail.items.map((l, i) => {
              const p = products.find((p) => p.id === l.productId);
              return (
                p && (
                  <div className="summary-item" key={i}>
                    <img src={colourImages[l.colour]} alt={p.name} />
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
              <p>Sample order — no customer address.</p>
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
        description="This action cancels your demo order."
      >
        <p>Order #{cancel?.id} has not shipped yet. Are you sure you want to cancel?</p>
        <Button
          variant="destructive"
          onClick={() => {
            if (cancel) store.cancel(cancel.id);
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
function Progress({ order }: { order: Order }) {
  const stage =
    order.status === "Delivered"
      ? 3
      : order.status === "Shipped"
        ? 2
        : order.status === "Processing"
          ? 0
          : 0;
  return (
    <div className={`order-progress ${order.status === "Cancelled" ? "cancelled" : ""}`}>
      {["Order Placed", "Processed", "Shipped", "Delivered"].map((label, i) => (
        <div key={label} className={i <= stage ? "complete" : ""}>
          <span>{i <= stage ? <Check size={12} /> : <span />}</span>
          <b>{label}</b>
          <small>
            {i <= stage
              ? new Date(new Date(order.createdAt).getTime() + i * 86400000).toLocaleDateString(
                  "en-IN",
                  { day: "numeric", month: "short" },
                )
              : "—"}
          </small>
        </div>
      ))}
    </div>
  );
}
