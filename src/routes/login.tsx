import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/components/store/auth';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>): { next?: string | undefined } => ({ next: typeof s['next'] === 'string' ? s['next'] : undefined }),
  head: () => pageHead('Login', 'Log in to your YEARTH STORE account to track orders and check out faster.'),
  component: function Page() {
    const q = Route.useSearch();
    return <LoginPage next={q.next} />;
  },
});
