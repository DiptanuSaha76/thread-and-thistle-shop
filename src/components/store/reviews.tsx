import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { dbErrorKey } from "@/lib/store/errors";
import { Modal } from "./shared";
import type { Product } from "@/lib/store/catalogue";

/**
 * Customer reviews from public.product_reviews. Only published reviews are readable.
 * Reviews are written through public.submit_product_review(), which requires a signed-in
 * customer with a delivered order containing this product and takes the reviewer's name
 * from their profile.
 */
type Review = {
  id: string;
  rating: number;
  title: string;
  body: string;
  display_name: string;
  verified_purchase: boolean;
  created_at: string;
};

const reviewErrors: Record<string, string> = {
  NOT_PURCHASED: "Only customers who have received this product can review it.",
  INVALID_RATING: "Please choose a rating from 1 to 5 stars.",
  INVALID_TITLE: "Please keep the title under 60 characters.",
  INVALID_REVIEW: "Please write between 3 and 400 characters.",
  PRODUCT_NOT_FOUND: "This product is no longer available.",
  AUTH_REQUIRED: "Please log in to write a review.",
};

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
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const here = useRouterState({ select: (s) => s.location.href });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [draft, setDraft] = useState({ stars: 5, title: "", text: "" });

  const reviews = useQuery({
    queryKey: ["product-reviews", product.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_reviews")
        .select("id, rating, title, body, display_name, verified_purchase, created_at")
        .eq("product_id", product.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Review[];
    },
  });
  const canReview = useQuery({
    queryKey: ["can-review", product.id, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can_review_product", { p_product: product.id });
      if (error) throw error;
      return data === true;
    },
    enabled: open && !!user,
  });

  const list = reviews.data ?? [];
  const total = list.length;
  const avg = total ? list.reduce((s, r) => s + r.rating, 0) / total : 0;
  const pct = (n: number) => (total ? Math.round((list.filter((r) => r.rating === n).length / total) * 100) : 0);
  const postingAs = profile
    ? [profile.first_name.trim(), profile.last_name.trim() ? `${profile.last_name.trim()[0]}.` : ""].filter(Boolean).join(" ") || "Customer"
    : "";

  const submit = async () => {
    if (busy) return;
    if (draft.text.trim().length < 3) {
      setFormError(reviewErrors["INVALID_REVIEW"]!);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const { error } = await supabase.rpc("submit_product_review", {
        p_product: product.id,
        p_rating: draft.stars,
        p_title: draft.title,
        p_body: draft.text,
      });
      if (error) {
        setFormError(reviewErrors[dbErrorKey(error) ?? ""] ?? "We couldn't save your review. Please try again.");
        return;
      }
      setDraft({ stars: 5, title: "", text: "" });
      setOpen(false);
      toast.success("Thanks! Your review is published.");
      await queryClient.invalidateQueries({ queryKey: ["product-reviews", product.id] });
    } catch {
      setFormError("We couldn't save your review. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const loop = [...list, ...list];
  return (
    <section className="container reviews-section" aria-labelledby="reviews-heading">
      <div className="reviews-top">
        <aside className="reviews-summary">
          <h2 id="reviews-heading">Customer reviews</h2>
          {total ? (
            <p className="reviews-avg">
              <Stars value={avg} size={20} /> {avg.toFixed(1)} out of 5
            </p>
          ) : null}
          <p className="muted">
            {reviews.isPending
              ? "Loading reviews…"
              : reviews.isError
                ? "Reviews couldn't be loaded right now."
                : total
                  ? `${total} customer rating${total === 1 ? "" : "s"}`
                  : "No reviews yet."}
          </p>
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
          {user ? (
            <Button variant="outline" className="full-button" onClick={() => { setFormError(""); setOpen(true); }}>
              Write a product review
            </Button>
          ) : (
            <Button variant="outline" className="full-button" asChild>
              <Link to="/login" search={{ next: here }}>Log in to write a review</Link>
            </Button>
          )}
        </aside>
        <div className="reviews-say">
          <h3>About these reviews</h3>
          <p>
            Reviews are written by customers who have received the {product.name}. Each customer can
            review a product once and may update their review later.
          </p>
        </div>
      </div>
      {total > 0 && (
        <div className="review-marquee" aria-label="Customer reviews">
          <div className="review-track">
            {loop.map((r, i) => (
              <article className="review-card" key={`${r.id}-${i}`} aria-hidden={i >= total}>
                <header>
                  <span className="review-avatar">{r.display_name[0]}</span>
                  <b>{r.display_name.toUpperCase()}</b>
                </header>
                <Stars value={r.rating} />
                {r.title && <h4>{r.title}</h4>}
                <p>{r.body}</p>
                <small className="muted">
                  {r.verified_purchase && (
                    <>
                      <BadgeCheck size={13} /> Verified purchase ·{" "}
                    </>
                  )}
                  {new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </small>
              </article>
            ))}
          </div>
        </div>
      )}
      <Modal open={open} onOpenChange={setOpen} title="Write a review" description="Share your feedback with other customers.">
        {canReview.isPending ? (
          <p role="status">Checking…</p>
        ) : canReview.data !== true ? (
          <p role="alert">
            {canReview.isError ? "We couldn't check right now. Please try again later." : reviewErrors["NOT_PURCHASED"]}
          </p>
        ) : (
          <div className="review-form">
            <p className="muted">Posting as {postingAs}</p>
            <div className="star-pick">
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} type="button" aria-label={`${i} stars`} aria-pressed={i === draft.stars} onClick={() => setDraft({ ...draft, stars: i })}>
                  <Star size={24} className={i <= draft.stars ? "star-on" : "star-off"} />
                </button>
              ))}
            </div>
            <input placeholder="Review title (optional)" aria-label="Review title" value={draft.title} maxLength={60} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea placeholder="What did you like or dislike?" aria-label="Your review" rows={4} maxLength={400} value={draft.text} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); setFormError(""); }} />
            {formError && <p className="field-error" role="alert">{formError}</p>}
            <Button onClick={() => void submit()} disabled={busy}>{busy ? "Submitting…" : "Submit review"}</Button>
          </div>
        )}
      </Modal>
    </section>
  );
}
