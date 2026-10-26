import { useState } from 'react';
import { Empty, Field } from '../components/ui';
import { signOut } from '../lib/auth';
import { db } from '../lib/db';
import { useLive } from '../lib/hooks';
import { getUserId, uuid } from '../lib/identity';
import { putRows, softDelete } from '../lib/repo';
import { nowIso, shortDate } from '../lib/time';
import type { BaonNote } from '../lib/types';
import { SyncBadge } from '../components/Layout';

/** The supporter's only screen: write short notes that show on her Today. */
export default function Baon() {
  const me = getUserId();
  const profile = useLive(() => db.profiles.get(me), [me]);
  const notes = useLive(async () => (await db.baon_notes.toArray()).filter((n) => !n.deleted_at && n.author_id === me).sort((a, b) => b.created_at.localeCompare(a.created_at)), [me]) ?? [];
  const [body, setBody] = useState('');
  const [showOn, setShowOn] = useState('');
  const [editing, setEditing] = useState<BaonNote | null>(null);
  const recipient = profile?.partner_id;

  async function save() {
    if (!recipient || !body.trim()) return;
    const now = nowIso();
    const note: BaonNote = editing
      ? { ...editing, body: body.trim(), show_on: showOn || null }
      : { id: uuid(), author_id: me, recipient_id: recipient, body: body.trim(), show_on: showOn || null, seen_at: null, archived: false, created_at: now, updated_at: now, deleted_at: null };
    await putRows('baon_notes', [note]);
    setBody('');
    setShowOn('');
    setEditing(null);
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Baon</h1>
        <SyncBadge />
      </div>
      <p className="mt-1 text-muted">Short notes from home. She sees at most one a day on her Today screen.</p>
      {!recipient ? (
        <p className="mt-6 rounded-lg border border-rule p-3 text-sm">Your account isn't linked to hers yet. Set partner_id on your profile (see the README).</p>
      ) : (
        <section className="panel mt-6 space-y-3 p-4">
          <Field label={`Note (${body.length}/500)`} htmlFor="b-body">
            <textarea id="b-body" className="textarea reading" maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Kain muna bago mag-codal." />
          </Field>
          <Field label="Show on (optional)" htmlFor="b-date">
            <input id="b-date" type="date" className="input" value={showOn} onChange={(e) => setShowOn(e.target.value)} />
          </Field>
          <p className="text-xs text-muted">Pick a date for a note meant for a particular day, like the night before each exam day. Without a date, it shows on the next day there's no scheduled note.</p>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={!body.trim()} onClick={() => void save()}>
              {editing ? 'Save changes' : 'Save note'}
            </button>
            {editing && (
              <button className="btn" onClick={() => { setEditing(null); setBody(''); setShowOn(''); }}>
                Cancel
              </button>
            )}
          </div>
        </section>
      )}
      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Your notes</h2>
        {notes.length === 0 ? (
          <Empty>No notes yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="panel p-3">
                <p className="reading">{n.body}</p>
                <p className="mt-1 text-xs text-muted">
                  {n.show_on ? `For ${shortDate(n.show_on)}` : 'Any day'} · {n.seen_at ? 'seen' : 'not seen yet'}
                </p>
                <div className="mt-2 flex gap-2">
                  <button className="btn btn-sm" onClick={() => { setEditing(n); setBody(n.body); setShowOn(n.show_on ?? ''); }}>
                    Edit
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => void softDelete('baon_notes', n.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button className="btn btn-ghost mt-8" onClick={() => void signOut()}>
        Sign out
      </button>
    </main>
  );
}
