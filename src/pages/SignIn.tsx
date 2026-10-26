import { useState } from 'react';
import { Wordmark } from '../components/Layout';
import { continueLocalOnly, signIn } from '../lib/auth';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  }

  return (
    <main
      className="flex min-h-dvh flex-col items-center justify-center px-4 py-10"
      style={{ backgroundImage: 'radial-gradient(800px 400px at 50% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%)' }}
    >
      <div className="w-full max-w-sm">
      <Wordmark />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Bar review companion, made for Shendy Anne Catulin-Dayag.</p>
      <form className="panel mt-8 space-y-4 p-5" onSubmit={submit}>
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button className="btn btn-ghost mt-4" onClick={() => void continueLocalOnly()}>
        Use on this device only for now
      </button>
      <p className="mt-2 text-center text-xs text-muted">
        Anything you add is kept and uploads when you sign in later.
      </p>
      </div>
    </main>
  );
}
