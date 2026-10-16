import { createFileRoute } from '@tanstack/react-router';
import { SignupPage } from '@/components/store/auth';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/signup')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({ next: typeof s['next'] === 'string' ? s['next'] : undefined }),
  head: () => pageHead('Create Account', 'Create your YEARTH STORE account for faster checkout, a wishlist and order tracking.'),
  component: function Page() {
    const q = Route.useSearch();
    return <SignupPage next={q.next} />;
  },
});
