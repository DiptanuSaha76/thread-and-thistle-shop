import { createFileRoute } from '@tanstack/react-router';
import { VerifyPage } from '@/components/store/auth';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/verify')({
  validateSearch: (s: Record<string, unknown>): { email?: string } => ({ email: typeof s['email'] === 'string' ? s['email'] : undefined }),
  head: () => pageHead('Verify Your Email', 'Verify your email address to activate your YEARTH STORE account.'),
  component: function Page() {
    const q = Route.useSearch();
    return <VerifyPage email={q.email} />;
  },
});
