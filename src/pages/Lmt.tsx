import { useState } from 'react';
import { FileText, Printer, Star } from 'lucide-react';
import Listen from '../components/Listen';
import { Empty, Markdown, PageHeader, SubjectChips } from '../components/ui';
import { stripCloze } from '../lib/cloze';
import { db } from '../lib/db';
import { segments } from '../lib/highlights';
import { useLive, useSettings, useSubjects } from '../lib/hooks';

/** Last-minute tips: starred doctrines, starred provisions with highlights, open mistakes. */
export default function Lmt() {
  const subjects = useSubjects();
  const settings = useSettings();
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const subject = subjects.find((s) => s.id === (subjectId ?? subjects[0]?.id));
  const data = useLive(async () => {
    if (!subject) return null;
    const laws = (await db.laws.toArray()).filter((l) => !l.deleted_at && l.primary_subject_id === subject.id);
    const lawIds = new Set(laws.map((l) => l.id));
    const provisions = (await db.provisions.toArray()).filter((p) => !p.deleted_at && p.starred && lawIds.has(p.law_id)).sort((a, b) => a.law_id.localeCompare(b.law_id) || a.sort - b.sort);
    const pIds = new Set(provisions.map((p) => p.id));
    const hls = (await db.highlights.toArray()).filter((h) => !h.deleted_at && pIds.has(h.provision_id));
    const digests = (await db.digests.toArray()).filter((d) => !d.deleted_at && d.starred && d.subject_id === subject.id).sort((a, b) => a.title.localeCompare(b.title));
    const mistakes = (await db.mistakes.toArray()).filter((m) => !m.deleted_at && m.status === 'open' && m.subject_id === subject.id);
    const cards = (await db.cards.toArray()).filter((c) => !c.deleted_at && c.starred && c.subject_id === subject.id);
    const nodes = (await db.syllabus_nodes.toArray()).filter((n) => !n.deleted_at && n.starred && n.subject_id === subject.id);
    return { laws, provisions, hls, digests, mistakes, cards, nodes };
  }, [subject?.id]);
  if (!subject) return null;
  const color = (k: string) => settings.highlightLegend.find((l) => l.key === k)?.color ?? '#FFE14D';
  const empty = data && !data.provisions.length && !data.digests.length && !data.mistakes.length && !data.cards.length && !data.nodes.length;
  const listen = data
    ? [
        ...data.digests.map((d) => ({ text: `${d.title}. ${d.doctrine}`, pauseAfter: 900 })),
        ...data.provisions.map((p) => ({ text: p.text, pauseAfter: 900 })),
      ]
    : [];

  return (
    <div>
      <div className="no-print space-y-3">
        <PageHeader
          icon={FileText}
          title="LMT sheets"
          subtitle="Starred doctrines, starred provisions and open mistakes, ready to print"
          actions={
            <button className="btn btn-primary" onClick={() => window.print()}>
              <Printer /> Print or save as PDF
            </button>
          }
        />
        <SubjectChips subjects={subjects} value={subject.id} onChange={(v) => setSubjectId(v)} allowAll={false} />
        <Listen items={listen} label="Listen to doctrines and provisions" />
      </div>
      <article className="mt-4">
        <h1 className="mb-3 text-xl font-bold">
          {subject.code} · {subject.name}
        </h1>
        {empty && <Empty icon={Star} title="Nothing starred yet">Star doctrines, provisions, cards and syllabus items while you study; they collect here as your last-minute tips.</Empty>}
        {data && (
          <div className="print-cols space-y-3 text-sm leading-snug sm:columns-2 sm:gap-6">
            {data.digests.length > 0 && <h2 className="font-semibold">Doctrines</h2>}
            {data.digests.map((d) => (
              <div key={d.id} className="break-inside-avoid">
                <p className="font-semibold">
                  {d.title} {d.gr_no && <span className="font-normal text-muted">({d.gr_no})</span>}
                </p>
                <p className="reading text-sm">{d.doctrine}</p>
              </div>
            ))}
            {data.provisions.length > 0 && <h2 className="pt-2 font-semibold">Provisions</h2>}
            {data.provisions.map((p) => {
              const law = data.laws.find((l) => l.id === p.law_id);
              return (
                <div key={p.id} className="break-inside-avoid">
                  <p className="font-semibold">
                    {p.label} {law?.short_name}
                  </p>
                  <p className="reading text-sm whitespace-pre-wrap">
                    {segments(p.text, data.hls.filter((h) => h.provision_id === p.id)).map((s) =>
                      s.hl ? (
                        <mark key={s.start} className="hl" style={{ ['--hl' as string]: color(s.hl.color_key), color: 'inherit' }}>
                          {s.text}
                        </mark>
                      ) : (
                        <span key={s.start}>{s.text}</span>
                      ),
                    )}
                  </p>
                </div>
              );
            })}
            {data.cards.length > 0 && <h2 className="pt-2 font-semibold">Starred cards</h2>}
            {data.cards.map((c) => (
              <div key={c.id} className="break-inside-avoid">
                {c.type === 'cloze' ? <p>{stripCloze(c.cloze_text)}</p> : <Markdown>{`**${c.front}** — ${c.back}`}</Markdown>}
              </div>
            ))}
            {data.mistakes.length > 0 && <h2 className="pt-2 font-semibold">Open mistakes</h2>}
            {data.mistakes.map((m) => (
              <div key={m.id} className="break-inside-avoid">
                <p className="font-semibold">{m.what_went_wrong}</p>
                {m.correct_rule && <p className="reading text-sm">{m.correct_rule}</p>}
              </div>
            ))}
            {data.nodes.length > 0 && <h2 className="pt-2 font-semibold">Starred topics</h2>}
            {data.nodes.map((n) => (
              <p key={n.id} className="break-inside-avoid">
                {n.marker} {n.title}
                {n.notes && <span className="block text-muted">{n.notes}</span>}
              </p>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
