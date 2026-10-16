import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordPage } from '@/components/store/auth';
import { pageHead } from '@/lib/store/catalogue';
export const Route = createFileRoute('/forgot-password')({
  head: () => pageHead('Forgot Password', 'Reset the password for your YEARTH STORE account.'),
  component: ForgotPasswordPage,
});
