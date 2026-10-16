import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordPage } from '@/components/store/auth';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/reset-password')({
  head: () => pageHead('Set a New Password', 'Choose a new password for your YEARTH STORE account.'),
  component: ResetPasswordPage,
});
