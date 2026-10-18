import { useState } from "react";
import { Star, ThumbsUp, Sparkles, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "./shared";
import type { Product } from "@/lib/store/catalogue";

type Review = { name: string; stars: number; title: string; text: string; helpful: number };
const seed: Review[] = [
  { name: "Aarav S.", stars: 5, title: "Heavyweight and perfect drop", text: "The 240 GSM fabric feels premium. Shoulders drop just right and it keeps shape after washes.", helpful: 42 },
  { name: "Riya M.", stars: 4, title: "Great fit, colour is rich", text: "Ordered my usual size for the oversized look. Colour stayed deep after three washes.", helpful: 27 },
  { name: "Kabir J.", stars: 5, title: "My new everyday tee", text: "Soft, breathable and doesn't cling. Pairs with everything in my wardrobe.", helpful: 35 },
  { name: "Sneha P.", stars: 4, title: "Value for money", text: "Quality is close to brands twice the price. Neck rib is thick and sturdy.", helpful: 19 },
  { name: "Dev R.", stars: 3, title: "Runs a little long", text: "Fabric is lovely but the length is longer than I expected. Size down if you're short.", helpful: 11 },
  { name: "Ishita K.", stars: 5, title: "Fast delivery, neat packing", text: "Arrived in two days. Feels heavy and premium, exactly like the photos.", helpful: 23 },
];
const tags: [string, number, "up" | "mixed"][] = [
  ["Fabric quality", 186, "up"], ["Fit", 142, "up"], ["Value for money", 121, "up"], ["Comfort", 98, "up"], ["Length", 37, "mixed"], ["Colour fade", 22, "mixed"],
];

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="review-stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? "star-on" : "star-off"} />
      ))}
    </span>
  );
}

export function Reviews({ product }: { product: Product }) {
  const [list, setList] = useState(seed);
  const [voted, setVoted] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", stars: 5, title: "", text: "" });
  const total = list.length;
  const avg = list.reduce((s, r) => s + r.stars, 0) / total;
  const pct = (n: number) => Math.round((list.filter((r) => r.stars === n).length / total) * 100);
  const vote = (i: number) =>
    setVoted((v) => {
      const n = new Set(v);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  const submit = () => {
    if (!draft.name.trim() || !draft.text.trim()) return;
    setList([{ ...draft, title: draft.title || "Review", helpful: 0 }, ...list]);
    setDraft({ name: "", stars: 5, title: "", text: "" });
    setOpen(false);
  };
  const loop = [...list, ...list];
  return (
    <section className="container reviews-section" aria-labelledby="reviews-heading">
      <div className="reviews-top">
        <aside className="reviews-summary">
          <h2 id="reviews-heading">Customer reviews</h2>
          <p className="reviews-avg">
            <Stars value={avg} size={20} /> {avg.toFixed(1)} out of 5
          </p>
          <p className="muted">{total} sample ratings</p>
          {[5, 4, 3, 2, 1].map((n) => (
            <div className="rating-row" key={n}>
              <span>{n} star</span>
              <div className="rating-bar"><i style={{ width: `${pct(n)}%` }} /></div>
              <span>{pct(n)}%</span>
            </div>
          ))}
          <hr />
          <h3>Review this product</h3>
          <p className="muted">Share your thoughts with other customers</p>
          <Button variant="outline" className="full-button" onClick={() => setOpen(true)}>
            Write a product review
          </Button>
        </aside>
        <div className="reviews-say">
          <h3>Customers say</h3>
          <p>
            Customers love the heavyweight 240 GSM cotton of the {product.name}, praising its relaxed
            oversized drop and how it holds shape after washing. Most find it great value for money and
            comfortable all day. Opinions on length are mixed — some prefer sizing down for a closer fit.
          </p>
          <p className="muted ai-note"><Sparkles size={14} /> Summarised from sample customer reviews</p>
          <h4>Select to learn more</h4>
          <div className="review-tags">
            {tags.map(([t, n, k]) => (
              <span key={t} className={`review-tag ${k}`}>
                {k === "up" ? <TrendingUp size={15} /> : <Minus size={15} />} {t} <small>({n})</small>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="review-marquee" aria-label="Customer reviews">
        <div className="review-track">
          {loop.map((r, i) => {
            const k = i % list.length;
            const on = voted.has(k);
            return (
              <article className="review-card" key={i} aria-hidden={i >= list.length}>
                <header>
                  <span className="review-avatar">{r.name[0]}</span>
                  <b>{r.name.toUpperCase()}</b>
                </header>
                <Stars value={r.stars} />
                <h4>{r.title}</h4>
                <p>{r.text}</p>
                <Button size="sm" variant={on ? "default" : "outline"} onClick={() => vote(k)} tabIndex={i >= list.length ? -1 : 0}>
                  <ThumbsUp /> Helpful
                </Button>
                <small className="muted">{r.helpful + (on ? 1 : 0)} people found this helpful</small>
              </article>
            );
          })}
        </div>
      </div>
      <Modal open={open} onOpenChange={setOpen} title="Write a review" description="Your review appears in this session only (prototype).">
        <div className="review-form">
          <div className="star-pick">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" aria-label={`${i} stars`} onClick={() => setDraft({ ...draft, stars: i })}>
                <Star size={24} className={i <= draft.stars ? "star-on" : "star-off"} />
              </button>
            ))}
          </div>
          <input placeholder="Your name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input placeholder="Review title" value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea placeholder="What did you like or dislike?" rows={4} maxLength={400} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <Button onClick={submit}>Submit review</Button>
        </div>
      </Modal>
    </section>
  );
}
