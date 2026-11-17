import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Volume2 } from 'lucide-react';

type Language = 'en' | 'kn';
type Role = 'jeweller' | 'karigar';

export interface DailyBriefItem {
  id: string;
  category: string;
  title: string;
  detail: string;
  amountPaise: number;
  urgencyScore: number;
  rankingScore: number;
  orderId: string;
  eventId: string | null;
  dueId: string | null;
  ageDays: number | null;
  overdueDays: number | null;
  href: string;
}

interface BriefData {
  actor: { id: string; name: string; role: Role };
  language: Language;
  briefDate: string;
  generatedAt: string | null;
  preview: boolean;
  schedule: {
    timeZone: string;
    scheduledTime: string;
    hoursUntilNextRun: number;
  };
  items: DailyBriefItem[];
  spokenText: string;
}

interface Props {
  userId: string;
  role: Role;
  language: Language;
  onOpenAction: (item: DailyBriefItem) => void;
}

interface FastForwardResult {
  error?: string;
  evaluationTime: string;
  brief: BriefData;
}

const labels = {
  en: {
    title: 'Daily brief',
    scheduled: 'Scheduled',
    preview: 'Live preview',
    generated: 'Generated',
    play: 'Play brief',
    fastForward: 'Fast-forward to scheduled brief',
    loading: 'Preparing your daily brief…',
    empty: 'No actions need your attention today.',
    error: 'Could not load the daily brief.',
    retry: 'Retry',
  },
  kn: {
    title: 'ದೈನಂದಿನ ಮಾಹಿತಿ',
    scheduled: 'ನಿಗದಿತ ಸಮಯ',
    preview: 'ಈಗಿನ ಪೂರ್ವವೀಕ್ಷಣೆ',
    generated: 'ರಚಿಸಿದ ಸಮಯ',
    play: 'ಮಾಹಿತಿ ಕೇಳಿಸಿ',
    fastForward: 'ನಿಗದಿತ ಸಮಯಕ್ಕೆ ವೇಗವಾಗಿ ಹೋಗಿ',
    loading: 'ನಿಮ್ಮ ದೈನಂದಿನ ಮಾಹಿತಿಯನ್ನು ಸಿದ್ಧಪಡಿಸಲಾಗುತ್ತಿದೆ…',
    empty: 'ಇಂದು ಗಮನಿಸಬೇಕಾದ ಕೆಲಸಗಳಿಲ್ಲ.',
    error: 'ದೈನಂದಿನ ಮಾಹಿತಿಯನ್ನು ಲೋಡ್ ಮಾಡಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ.',
    retry: 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  },
};

export default function DailyBriefPanel({ userId, role, language, onOpenAction }: Props) {
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [briefAsOf, setBriefAsOf] = useState<string | null>(null);
  const text = labels[language];

  const loadBrief = useCallback(async (cancelled?: () => boolean) => {
    try {
      const query = new URLSearchParams({ language });
      if (briefAsOf) query.set('asOf', briefAsOf);
      const response = await fetch(`/api/daily-brief?${query}`, {
        headers: { 'x-user-id': userId },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? labels[language].error);
      if (!cancelled?.()) {
        setBrief(result as BriefData);
        setError('');
      }
    } catch (loadError) {
      if (!cancelled?.()) setError(loadError instanceof Error ? loadError.message : labels[language].error);
    }
  }, [briefAsOf, language, userId]);

  useEffect(() => {
    let cancelled = false;
    const initialTimeout = window.setTimeout(() => { void loadBrief(() => cancelled); }, 0);
    const intervalId = window.setInterval(() => { void loadBrief(() => cancelled); }, 60_000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimeout);
      window.clearInterval(intervalId);
    };
  }, [loadBrief]);

  const fastForward = async () => {
    if (!brief) return;
    setBusy(true);
    try {
      const response = await fetch('/api/daily-brief/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
        body: JSON.stringify({
          fastForwardHours: brief.schedule.hoursUntilNextRun,
          language,
        }),
      });
      const result = await response.json() as FastForwardResult;
      if (!response.ok) throw new Error(result.error ?? text.error);
      setBriefAsOf(result.evaluationTime);
      setBrief(result.brief);
      setError('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : text.error);
    } finally {
      setBusy(false);
    }
  };

  const playBrief = () => {
    if (!brief) return;
    if (!('speechSynthesis' in window)) {
      setError('Speech synthesis is not available in this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(brief.spokenText);
    utterance.lang = language === 'kn' ? 'kn-IN' : 'en-IN';
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className="min-w-0 space-y-3 rounded-3xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-label="Daily brief">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-black text-gray-900">{text.title}</h2>
          {brief && (
            <p className="break-words text-sm text-gray-600">
              {brief.preview ? text.preview : text.generated}: {brief.generatedAt
                ? new Date(brief.generatedAt).toLocaleString(language === 'kn' ? 'kn-IN' : 'en-IN')
                : `${text.scheduled} ${brief.schedule.scheduledTime} · ${brief.schedule.timeZone}`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled={!brief}
            onClick={playBrief}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            <Volume2 size={18} /> {text.play}
          </button>
          {role === 'jeweller' && brief && (
            <button
              disabled={busy}
              onClick={() => void fastForward()}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {text.fastForward} · {brief.schedule.hoursUntilNextRun}h
            </button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
          <span className="break-words">{error}</span>
          <button onClick={() => void loadBrief()} className="rounded-lg bg-white px-3 py-2 text-red-900">{text.retry}</button>
        </div>
      )}
      {!brief ? <p className="text-sm text-gray-600">{text.loading}</p> : brief.items.length === 0 ? (
        <p className="text-sm text-gray-600">{text.empty}</p>
      ) : (
        <ol className="space-y-2">
          {brief.items.map((item, index) => (
            <li key={item.id}>
              <a
                href={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  onOpenAction(item);
                }}
                className="flex min-w-0 items-start justify-between gap-3 rounded-xl bg-amber-50 p-3 text-left hover:bg-amber-100"
              >
                <span className="min-w-0">
                  <strong className="block break-words text-sm text-gray-900">{index + 1}. {item.title}</strong>
                  <span className="mt-1 block break-words text-sm text-gray-700">{item.detail}</span>
                </span>
                <ArrowUpRight size={18} className="mt-0.5 shrink-0 text-indigo-700" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
