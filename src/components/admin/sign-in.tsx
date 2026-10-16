import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ShieldCheck, ArrowRight, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { adminEmail } from '@/lib/admin/rules';
import { passwordProblem } from '@/lib/auth';
export function AdminSignIn() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: adminEmail, password });
    setBusy(false);
    if (error) { toast.error('Check your password and confirm your email first.'); return; }
    navigate({ to: '/admin' });
  }
  async function setup() {
    const problem = passwordProblem(password);
    if (problem) { toast.error(problem); return; }
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email: adminEmail, password, options: { emailRedirectTo: `${window.location.origin}/admin`, data: { name: 'YEARTH administrator' } } });
    setBusy(false);
    if (error) { toast.error('Unable to create the account. If it already exists, send a reset link.'); return; }
    setSent(true);
  }
  async function reset() {
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(adminEmail, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) toast.error('Unable to send the reset link. Please try again.'); else setSent(true);
  }
  return <section className="container py-16"><div className="mx-auto max-w-md space-y-6">
    <ShieldCheck size={32}/><div><p className="text-muted-foreground">THE YEARTH STORE</p><h1>Admin sign-in</h1></div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block">Email<input className="field mt-2" type="email" value={adminEmail} readOnly autoComplete="username"/></label>
      <label className="block">Password<input className="field mt-2" type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" minLength={8}/></label>
      <Button type="submit" className="w-full" disabled={busy}>Sign in <ArrowRight/></Button>
      <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={setup}>Create admin account</Button>
      <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={reset}><Mail/> Send password-reset link</Button>
    </form>
    {sent && <p role="status" className="text-success">Check {adminEmail} for your secure email link.</p>}
    <Link to="/" className="text-muted-foreground">Return to store</Link>
  </div></section>;
}
