import { useState, useEffect, useCallback } from 'react';
import {
  Banknote,
  BookOpen,
  CheckCircle,
  ClipboardList,
  FileText,
  Globe,
  Home,
  LogOut,
  Mic,
  MoreHorizontal,
  PlusCircle,
  Users,
} from 'lucide-react';
import { useSpeech } from './hooks/useSpeech';
import AgreementPanel from './AgreementPanel';
import ReturnReconciliationPanel from './ReturnReconciliationPanel';
import DashboardPanel from './DashboardPanel';
import DeadlinePanel from './DeadlinePanel';
import DailyBriefPanel from './DailyBriefPanel';
import type { DailyBriefItem } from './DailyBriefPanel';
import DisputePanel from './DisputePanel';
import GoldJourneyPanel from './GoldJourneyPanel';
import KarigarFloatPanel from './KarigarFloatPanel';
import KarigarWorkspace from './KarigarWorkspace';
import PinLogin, { type LoginUser } from './PinLogin';
import GoldOrderDemo from './GoldOrderDemo';
import { localeText, type LocaleCode } from './locales';
import routeManifest from './routeManifest.json';

type AppScreen =
  | 'home'
  | 'karigars'
  | 'karigar-detail'
  | 'orders'
  | 'order-detail'
  | 'records'
  | 'more';

const formatPaise = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(paise / 100);

interface DemoOrder {
  id: string;
  description: string;
  karigarId: string;
}

interface PendingEvent {
  id: string;
  orderId?: string;
  description?: string;
  type: string;
  notes: string | null;
  amount: number;
  weightMg: number;
  createdBy: string;
}

interface InboxEvent extends PendingEvent {
  orderId: string;
  description: string;
}

interface DraftEvent {
  type: 'issue' | 'return' | 'scrap_entry' | 'payment' | 'unknown';
  weightMg: number;
  amount: number;
  confidence: 'high' | 'low';
  readBackText: string;
}

// Local deterministic parser fallback so voice entry never fails if backend isn't restarted
function localParseUtterance(text: string): DraftEvent {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  if (/-\d/.test(lower) || lower.includes('infinity') || lower.includes('maybe') || lower.includes('?')) {
    return {
      type: 'unknown',
      weightMg: 0,
      amount: 0,
      confidence: 'low',
      readBackText: "I didn't quite catch a valid amount. Please repeat."
    };
  }

  const norm = lower
    .replace(/five thousand/g, '5000')
    .replace(/ಮೂರು ಸಾವಿರ/g, '3000')
    .replace(/ಹತ್ತು ಸಾವಿರ/g, '10000')
    .replace(/ಐನೂರು/g, '500')
    .replace(/ಎರಡುವರೆ/g, '2.5')
    .replace(/ಅರ್ಧ/g, '0.5')
    .replace(/quarter of a|quarter/g, '0.25')
    .replace(/half a|half/g, '0.5')
    .replace(/\bone\b|ಒಂದು/g, '1')
    .replace(/\btwo\b|ಎರಡು/g, '2')
    .replace(/\bthree\b|ಮೂರು/g, '3')
    .replace(/\bfour\b|ನಾಲ್ಕು/g, '4')
    .replace(/\bfive\b|ಐದು/g, '5')
    .replace(/\bsix\b|ಆರು/g, '6')
    .replace(/\bseven\b|ಏಳು/g, '7')
    .replace(/\beight\b|ಎಂಟು/g, '8')
    .replace(/\bnine\b|ಒಂಬತ್ತು/g, '9')
    .replace(/\bten\b|ಹತ್ತು/g, '10')
    .replace(/(\d+)\s+point\s+(\d+)/g, '$1.$2')
    .replace(/\bpoint\s+(\d+)/g, '0.$1');

  const numMatch = norm.match(/\d+(\.\d+)?/);
  if (!numMatch) {
    return {
      type: 'unknown',
      weightMg: 0,
      amount: 0,
      confidence: 'low',
      readBackText: "I didn't catch the numbers. Please try again."
    };
  }

  const value = parseFloat(numMatch[0]);
  let type: 'issue' | 'return' | 'scrap_entry' | 'payment' | 'unknown' = 'unknown';

  if (/scrap|wastage|dust|ಸ್ಕ್ರಾಪ್|ತ್ಯಾಜ್ಯ/.test(norm)) {
    type = 'scrap_entry';
  } else if (/paid|payment|rupees|inr|cash|settled|ರೂಪಾಯಿ|ಪಾವತಿ/.test(norm)) {
    type = 'payment';
  } else if (/return|returned|received|back|ವಾಪಸ್/.test(norm)) {
    type = 'return';
  } else if (/issue|issued|give|given|gave|sent|hand over|transfer|load(?:ed|ing)?|ನೀಡಿದ್ದೇನೆ|ಕೊಟ್ಟೆ|ನೀಡಿ|ಇಶ್ಯೂ/.test(norm)) {
    type = 'issue';
  }

  if (type === 'unknown') {
    return {
      type: 'unknown',
      weightMg: 0,
      amount: 0,
      confidence: 'low',
      readBackText: "I didn't understand the transaction type."
    };
  }

  let weightMg = 0;
  let amount = 0;

  if (type === 'payment') {
    amount = Math.round(value);
  } else if (/milligram|milligrams|\bmg\b|ಮಿಲಿಗ್ರಾಂ/.test(norm)) {
    weightMg = Math.round(value);
  } else if (/\bkg\b|kilogram/.test(norm)) {
    weightMg = Math.round(value * 1000000);
  } else {
    weightMg = Math.round(value * 1000);
  }

  const readBackText = type === 'payment'
    ? `I heard: Payment of ${amount} rupees. Is this correct?`
    : `I heard: ${type} of ${weightMg} milligrams. Is this correct?`;

  return { type, weightMg, amount, confidence: 'high', readBackText };
}

export default function App() {
  const [lang, setLang] = useState<LocaleCode>('en');
  const [user, setUser] = useState<LoginUser | null>(null);

  const [activeScreen, setActiveScreen] = useState<AppScreen>('home');
  const [selectedKarigarId, setSelectedKarigarId] = useState('');
  const [selectedRecordOrderId, setSelectedRecordOrderId] = useState('');
  const [agreementPanelOpen, setAgreementPanelOpen] = useState(false);
  const [returnCheckOpen, setReturnCheckOpen] = useState(false);
  const [ownerApprovalCount, setOwnerApprovalCount] = useState(0);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [demoOrderState, setDemoOrderState] = useState<{ userId: string; orders: DemoOrder[] } | null>(null);
  const [demoError, setDemoError] = useState('');
  const [balance, setBalance] = useState(0);

  const [pendingEventState, setPendingEventState] = useState<{
    orderId: string;
    userId: string;
    events: PendingEvent[];
  } | null>(null);
  const [inboxState, setInboxState] = useState<{ userId: string; events: InboxEvent[] } | null>(null);
  const [proposal, setProposal] = useState<{ amountDue: number, breakdown: string } | null>(null);
  const [briefTarget, setBriefTarget] = useState<{ orderId: string; eventId: string | null; category: string } | null>(null);

  const t = localeText[lang].app;
  const panelLanguage = lang === 'hi' ? 'en' : lang;
  const showDemoControls = import.meta.env.VITE_SHOW_DEMO_CONTROLS === 'true';
  const activeTab = routeManifest.screens.find((screen) => screen.id === activeScreen)?.tab ?? null;
  const demoOrders = demoOrderState && user && demoOrderState.userId === user.id ? demoOrderState.orders : [];
  const activeDemoOrder = demoOrders.find((order) => order.id === activeOrderId);
  const canUseOrderPanels = user?.role === 'jeweller'
    || (user?.role === 'karigar' && (!activeDemoOrder || activeDemoOrder.karigarId === user.id));
  const pendingEvents = pendingEventState?.orderId === activeOrderId && pendingEventState?.userId === user?.id
    ? pendingEventState.events
    : [];
  const inboxEvents = inboxState && inboxState.userId === user?.id ? inboxState.events : [];

  // --- VOICE ENTRY STATE & LOGIC ---
  const { isListening, transcript, listen, error: speechError } = useSpeech(
    lang === 'hi' ? 'hi-IN' : lang === 'kn' ? 'kn-IN' : 'en-IN',
  );
  const [draftEvent, setDraftEvent] = useState<DraftEvent | null>(null);
  const [postingVoiceEvent, setPostingVoiceEvent] = useState(false);

  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'hi' ? 'hi-IN' : lang === 'kn' ? 'kn-IN' : 'en-IN';
      window.speechSynthesis.speak(utterance);
    }
  }, [lang]);

  useEffect(() => {
    if (transcript && !isListening) {
      fetch('/api/agent/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript })
      })
        .then(async res => {
          if (!res.ok) throw new Error('Backend parse route unavailable');
          return res.json();
        })
        .then(data => {
          setDraftEvent(data);
          speak(data.readBackText);
        })
        .catch(() => {
          const fallbackDraft = localParseUtterance(transcript);
          setDraftEvent(fallbackDraft);
          speak(fallbackDraft.readBackText);
        });
    }
  }, [transcript, isListening, speak]);
  // ---------------------------------

  const fetchBalance = async (orderId: string) => {
    const res = await fetch(`/api/orders/${orderId}/balance`);
    if (res.ok) {
      const data = await res.json();
      setBalance(data.netKarigarHeldMg);
    }
  };

  const loadPendingEvents = async (orderId: string, userId: string): Promise<PendingEvent[]> => {
    const response = await fetch(`/api/orders/${orderId}/pending-events`, {
      headers: { 'x-user-id': userId },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not load pending approvals.');
    return data.events;
  };

  const loadInboxEvents = useCallback(async (userId: string): Promise<InboxEvent[]> => {
    const response = await fetch('/api/notifications/pending', {
      headers: { 'x-user-id': userId },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Could not load pending notifications.');
    return data.events;
  }, []);

  const fetchPendingEvents = async (orderId: string, userId: string) => {
    const events = await loadPendingEvents(orderId, userId);
    setPendingEventState({ orderId, userId, events });
  };

  const fetchInboxEvents = async (userId: string) => {
    const events = await loadInboxEvents(userId);
    setInboxState({ userId, events });
  };

  const navigateTo = (screen: AppScreen) => {
    setActiveScreen(screen);
    setActiveOrderId(null);
    setSelectedKarigarId('');
    setSelectedRecordOrderId('');
    setAgreementPanelOpen(false);
    setReturnCheckOpen(false);
    setProposal(null);
    setBriefTarget(null);
    setDemoError('');
  };

  const openOrder = (orderId: string, loadApprovals = true) => {
    setActiveScreen('order-detail');
    setActiveOrderId(orderId);
    setSelectedRecordOrderId(orderId);
    setAgreementPanelOpen(false);
    setReturnCheckOpen(false);
    setProposal(null);
    setDemoError('');
    window.history.pushState(null, '', `#order-${orderId}`);
    void fetchBalance(orderId);
    if (loadApprovals && user) {
      void fetchPendingEvents(orderId, user.id)
        .catch((loadError: Error) => setDemoError(loadError.message));
    }
  };

  const openBriefAction = (item: DailyBriefItem) => {
    if (!user) return;
    setBriefTarget({
      orderId: item.orderId,
      eventId: item.eventId,
      category: item.category,
    });
    openOrder(item.orderId, item.category !== 'custody_approval');
  };

  useEffect(() => {
    if (!briefTarget || activeOrderId !== briefTarget.orderId) return;
    const targetId = briefTarget.category === 'custody_approval'
      ? 'gold-journey'
      : briefTarget.category === 'pending_approval' && briefTarget.eventId
      ? `ledger-event-${briefTarget.eventId}`
      : briefTarget.category === 'escalated_dispute' && briefTarget.eventId
        ? `dispute-entry-${briefTarget.eventId}`
        : `order-${briefTarget.orderId}`;
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeOrderId, briefTarget, pendingEventState]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch('/api/demo/orders', { headers: { 'x-user-id': user.id } })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not load sample jobs.');
        return data.orders as DemoOrder[];
      })
      .then((orders) => {
        if (!cancelled) {
          setDemoOrderState({ userId: user.id, orders });
          setDemoError('');
        }
      })
      .catch((loadError: Error) => {
        if (!cancelled) setDemoError(loadError.message);
      });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refreshInbox = async () => {
      try {
        const events = await loadInboxEvents(user.id);
        if (!cancelled) setInboxState({ userId: user.id, events });
      } catch (loadError) {
        if (!cancelled) {
          setDemoError(loadError instanceof Error ? loadError.message : 'Could not load pending notifications.');
        }
      }
    };
    void refreshInbox();
    const intervalId = window.setInterval(() => { void refreshInbox(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadInboxEvents, user]);

  useEffect(() => {
    if (!user || user.role !== 'jeweller') return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch('/api/owner-issue-approvals', {
          headers: { 'x-user-id': user.id },
        });
        const result = await response.json() as { approvals?: unknown[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? 'Could not load owner approvals.');
        if (!cancelled) setOwnerApprovalCount(result.approvals?.length ?? 0);
      } catch (loadError) {
        if (!cancelled) {
          setDemoError(loadError instanceof Error ? loadError.message : 'Could not load owner approvals.');
        }
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => { void refresh(); }, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [user]);

  useEffect(() => {
    if (!user || !activeOrderId || user.role === 'staff'
      || (user.role === 'karigar' && activeDemoOrder && activeDemoOrder.karigarId !== user.id)) return;
    let cancelled = false;
    loadPendingEvents(activeOrderId, user.id)
      .then((events) => {
        if (!cancelled) setPendingEventState({ orderId: activeOrderId, userId: user.id, events });
      })
      .catch((loadError: Error) => {
        if (!cancelled) setDemoError(loadError.message);
      });
    return () => { cancelled = true; };
  }, [activeOrderId, user, activeDemoOrder]);

  const handleCreateOrder = async (): Promise<string | null> => {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user!.id },
      body: JSON.stringify({ jewellerId: user?.id, karigarId: 'k1', description: 'Settlement Demo' })
    });
    if (res.ok) {
      const data = await res.json();
      setActiveOrderId(data.id);
      setActiveScreen('order-detail');
      fetchBalance(data.id);
      return data.id;
    } else {
      const err = await res.json();
      alert(`Failed to create order: ${err.error}`);
      return null;
    }
  };

  const postLedgerEvent = async (
    type: string,
    weightMg: number,
    amount: number = 0,
    notes: string | null = null,
  ): Promise<boolean> => {
    let targetOrderId = activeOrderId;
    if (!targetOrderId) {
      targetOrderId = await handleCreateOrder();
      if (!targetOrderId) return false;
    }

    const res = await fetch('/api/ledger/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user!.id },
      body: JSON.stringify({ orderId: targetOrderId, type, weightMg, amount, notes, idempotencyKey: crypto.randomUUID() })
    });
    if (res.ok) {
      const data = await res.json();
      setProposal(null);
      if (targetOrderId && user) {
        await fetchPendingEvents(targetOrderId, user.id)
          .catch((loadError: Error) => setDemoError(loadError.message));
        await fetchInboxEvents(user.id)
          .catch((loadError: Error) => setDemoError(loadError.message));
      }
      const displayVal = type === 'payment' || type === 'settlement' ? formatPaise(data.amount) : `${weightMg} mg`;
      alert(`${type.toUpperCase()} (${displayVal}) sent for Karigar approval.`);
      return true;
    } else {
      const error = await res.json();
      alert(`Could not record ${type}: ${error.error ?? 'Unknown error'}`);
      return false;
    }
  };

  const handleGenerateSettlement = async () => {
    const res = await fetch(`/api/orders/${activeOrderId}/settlement`);
    if (res.ok) {
      const data = await res.json();
      setProposal(data);
    }
  };

  const handleAcknowledge = async (pendingEvent: PendingEvent) => {
    const res = await fetch(`/api/ledger/${pendingEvent.id}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user!.id },
    });
    if (res.ok) {
      if (activeOrderId && user) await fetchPendingEvents(activeOrderId, user.id);
      if (activeOrderId) fetchBalance(activeOrderId);
      if (user) await fetchInboxEvents(user.id);
      alert('Acknowledged successfully!');
    } else {
      const error = await res.json();
      alert(`Could not acknowledge event: ${error.error ?? 'Unknown error'}`);
    }
  };

  const selectUser = (nextUser: LoginUser | null) => {
    setUser(nextUser);
    setActiveScreen('home');
    setSelectedKarigarId('');
    setSelectedRecordOrderId('');
    setOwnerApprovalCount(0);
    setActiveOrderId(null);
    setDemoOrderState(null);
    setPendingEventState(null);
    setInboxState(null);
    setProposal(null);
    setBriefTarget(null);
    setDraftEvent(null);
    setBalance(0);
    setDemoError('');
    if (!nextUser) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  if (!user) {
    return <PinLogin language={lang} onLanguageChange={setLang} onLogin={selectUser} />;
  }

  if (user.role !== 'staff') {
    return (
      <GoldOrderDemo
        user={user}
        language={lang}
        onLanguageChange={setLang}
        onLogout={() => selectUser(null)}
      />
    );
  }

  if (user.role === 'staff') {
    return (
      <div className="min-h-dvh bg-stone-100">
        <header className="flex items-center justify-between bg-gray-900 p-4 text-white">
          <h1 className="font-black">Helper view</h1>
          <button type="button" onClick={() => selectUser(null)} aria-label={t.logout}>
            <LogOut aria-hidden="true" />
          </button>
        </header>
        <main className="mx-auto max-w-2xl space-y-4 p-4 pb-8">
          <section className="space-y-2 rounded-2xl bg-white p-4">
            <h2 className="font-black">Assigned gold journeys</h2>
            {demoOrders.length === 0 && <p className="text-sm text-gray-600">No assigned handoffs.</p>}
            {demoOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => openOrder(order.id, false)}
                className="min-h-12 w-full rounded-xl bg-indigo-50 p-3 text-left font-semibold text-indigo-950"
              >
                {order.description} · Open journey
              </button>
            ))}
          </section>
          {activeOrderId && <GoldJourneyPanel orderId={activeOrderId} userId={user.id} />}
          <DeadlinePanel userId={user.id} role="staff" view="rescue" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-stone-100 font-sans text-gray-950">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-gray-900 px-4 py-3 text-white shadow-sm">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-300">{user.name}</p>
          <h1 className="truncate font-black">{activeScreen === 'more' ? 'More' : t.jewellerView}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigateTo('more')}
            aria-current={activeScreen === 'more' ? 'page' : undefined}
            className="min-h-11 rounded-xl bg-white/10 px-3 font-bold"
          >
            <MoreHorizontal aria-hidden="true" className="mr-1 inline" size={18} />
            More
          </button>
          <button
            type="button"
            aria-label="Change language"
            onClick={() => setLang(lang === 'en' ? 'hi' : lang === 'hi' ? 'kn' : 'en')}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-white/10"
          >
            <Globe aria-hidden="true" size={21} />
          </button>
          <button
            type="button"
            onClick={() => selectUser(null)}
            aria-label={t.logout}
            className="grid min-h-11 min-w-11 place-items-center rounded-xl hover:bg-white/10"
          >
            <LogOut aria-hidden="true" size={21} />
          </button>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100dvh-9rem)] max-w-2xl space-y-4 p-4 pb-28">
        {demoError && (
          <p role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
            {demoError}
          </p>
        )}

        {activeScreen === 'home' && (
          <>
            <DashboardPanel
              userId={user.id}
              role="jeweller"
              language={panelLanguage}
              view="summary"
              onSelectOrder={openOrder}
            />
            <DailyBriefPanel
              userId={user.id}
              role="jeweller"
              language={panelLanguage}
              onOpenAction={openBriefAction}
              showFastForward={false}
            />
            <button
              type="button"
              onClick={() => navigateTo('orders')}
              className="flex min-h-16 w-full items-center justify-between rounded-2xl border border-amber-200 bg-white p-4 text-left shadow-sm"
            >
              <span>
                <strong className="block">Pending approvals</strong>
                <span className="text-sm text-gray-600">
                  {inboxEvents.length + ownerApprovalCount === 0
                    ? 'Nothing needs your approval.'
                    : `${inboxEvents.length + ownerApprovalCount} waiting for review`}
                </span>
              </span>
              <strong className="rounded-full bg-amber-100 px-3 py-1 text-amber-950">
                {inboxEvents.length + ownerApprovalCount}
              </strong>
            </button>
          </>
        )}

        {(activeScreen === 'karigars' || activeScreen === 'karigar-detail') && (
          <KarigarWorkspace
            userId={user.id}
            language={panelLanguage}
            karigarId={activeScreen === 'karigar-detail' ? selectedKarigarId : undefined}
            onLanguageChange={setLang}
            onSelectKarigar={(karigarId) => {
              setSelectedKarigarId(karigarId);
              setActiveScreen(karigarId ? 'karigar-detail' : 'karigars');
            }}
            onOpenOrder={openOrder}
          />
        )}

        {activeScreen === 'orders' && (
          <>
            <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black">Orders</h2>
                <button
                  type="button"
                  onClick={() => void handleCreateOrder()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gray-900 px-4 font-bold text-white"
                >
                  <PlusCircle aria-hidden="true" size={18} />
                  Create order
                </button>
              </div>
              <details>
                <summary className="cursor-pointer rounded-xl bg-gray-50 p-3 font-bold">
                  Open a job · {demoOrders.length}
                </summary>
                <div className="mt-2 space-y-2">
                  {demoOrders.length === 0 && <p className="text-sm text-gray-600">No jobs yet.</p>}
                  {demoOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => openOrder(order.id)}
                      className="min-h-11 w-full rounded-xl border border-gray-200 p-3 text-left font-semibold"
                    >
                      {order.description}
                    </button>
                  ))}
                </div>
              </details>
              <details>
                <summary className="cursor-pointer rounded-xl bg-gray-50 p-3 font-bold">
                  Customer deadline and rescue plan
                </summary>
                <div className="mt-3">
                  <DeadlinePanel userId={user.id} role="jeweller" view="rescue" />
                </div>
              </details>
            </section>

            <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-black">Issue gold and review owner approvals</summary>
              <div className="mt-3">
                <KarigarFloatPanel
                  userId={user.id}
                  role="jeweller"
                  language={panelLanguage}
                  view="issue"
                  onSelectOrder={openOrder}
                />
              </div>
            </details>

            {inboxEvents.length > 0 && (
              <details className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer font-black">Ledger approvals · {inboxEvents.length}</summary>
                <div className="mt-3 space-y-2">
                  {inboxEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => openOrder(event.orderId)}
                      className="min-h-12 w-full rounded-xl bg-amber-50 p-3 text-left"
                    >
                      <strong className="block">{event.description || 'Gold work'} · {event.type.replaceAll('_', ' ')}</strong>
                      <span className="text-sm">
                        {event.type === 'payment' || event.type === 'settlement'
                          ? `${formatPaise(event.amount)} · SIMULATED`
                          : `${event.weightMg.toLocaleString()} ${t.mg}`}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        )}

        {activeScreen === 'order-detail' && activeOrderId && (
          <>
            <button
              type="button"
              onClick={() => navigateTo('orders')}
              className="min-h-11 font-bold text-indigo-800"
            >
              ← Back to orders
            </button>
            <section id={`order-${activeOrderId}`} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">
                  {demoOrders.find((order) => order.id === activeOrderId)?.description ?? t.currentOrder}
                </h2>
                <p className="text-sm text-gray-600">
                  {t.balance}: {(balance / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g
                </p>
              </div>
              {balance === 0 && (
                <button
                  type="button"
                  onClick={() => void postLedgerEvent('issue', 5000)}
                  className="min-h-12 rounded-xl bg-amber-600 px-4 font-black text-white"
                >
                  Issue 5 g
                </button>
              )}
              {balance > 0 && !proposal && (
                <button
                  type="button"
                  onClick={() => void handleGenerateSettlement()}
                  className="min-h-12 rounded-xl bg-indigo-700 px-4 font-black text-white"
                >
                  {t.generateSettlement}
                </button>
              )}
            </section>

            {canUseOrderPanels && (
              <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer font-black">Agreement, Fair Pay and return check</summary>
                <div className="mt-3 space-y-3">
                  <details
                    className="rounded-xl bg-gray-50 p-3"
                    onToggle={(event) => setAgreementPanelOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer font-bold">Agreement and Fair Pay</summary>
                    {agreementPanelOpen && (
                      <AgreementPanel
                        orderId={activeOrderId}
                        userId={user.id}
                        role="jeweller"
                        language={panelLanguage}
                      />
                    )}
                  </details>
                  <details
                    className="rounded-xl bg-gray-50 p-3"
                    onToggle={(event) => setReturnCheckOpen(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer font-bold">Purity check and fine-gold waterfall</summary>
                    {returnCheckOpen && (
                      <ReturnReconciliationPanel
                        orderId={activeOrderId}
                        userId={user.id}
                        language={panelLanguage}
                        onSubmitted={() => {
                          void fetchBalance(activeOrderId);
                          void fetchPendingEvents(activeOrderId, user.id)
                            .catch((loadError: Error) => setDemoError(loadError.message));
                        }}
                      />
                    )}
                  </details>
                </div>
              </details>
            )}

            <details
              id="order-approvals"
              open={briefTarget?.category === 'pending_approval'}
              className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm"
            >
              <summary className="cursor-pointer font-black">Settlement and approvals · {pendingEvents.length}</summary>
              <div className="mt-3 space-y-3">
                {pendingEvents.length === 0 && <p className="text-sm text-gray-600">No approvals waiting for this job.</p>}
                {pendingEvents.map((event) => (
                  <article id={`ledger-event-${event.id}`} key={event.id} className="rounded-xl bg-amber-50 p-3">
                    <h3 className="font-bold">{event.type.replaceAll('_', ' ')}</h3>
                    {event.type === 'settlement' && event.notes ? (
                      <pre className="mt-2 whitespace-pre-wrap text-sm">{event.notes}</pre>
                    ) : event.type === 'payment' ? (
                      <p className="mt-2 font-semibold">{formatPaise(event.amount)} · SIMULATED</p>
                    ) : (
                      <p className="mt-2 font-semibold">{event.weightMg.toLocaleString()} {t.mg}</p>
                    )}
                    {event.createdBy === user.id
                      ? <p className="mt-2 text-sm">{t.pendingLabel} awaiting the other party.</p>
                      : (
                        <button
                          type="button"
                          onClick={() => void handleAcknowledge(event)}
                          className="mt-3 min-h-11 rounded-xl bg-green-700 px-4 font-bold text-white"
                        >
                          <CheckCircle aria-hidden="true" className="mr-2 inline" size={18} />{t.ack}
                        </button>
                      )}
                  </article>
                ))}
                {proposal && (
                  <article className="rounded-xl bg-indigo-50 p-3">
                    <pre className="whitespace-pre-wrap text-sm font-semibold">{proposal.breakdown}</pre>
                    <button
                      type="button"
                      onClick={() => void postLedgerEvent('settlement', balance, proposal.amountDue, proposal.breakdown)}
                      className="mt-3 min-h-11 rounded-xl bg-indigo-700 px-4 font-bold text-white"
                    >
                      <FileText aria-hidden="true" className="mr-2 inline" size={18} />
                      {t.sendProposal} · {formatPaise(proposal.amountDue)}
                    </button>
                  </article>
                )}
                {balance > 0 && !proposal && (
                  <button
                    type="button"
                    onClick={() => void postLedgerEvent('payment', 0, 0, 'SIMULATED payment under the stored agreement rate policy.')}
                    className="min-h-11 rounded-xl bg-emerald-700 px-4 font-bold text-white"
                  >
                    <Banknote aria-hidden="true" className="mr-2 inline" size={18} />{t.simulatePayment}
                  </button>
                )}
              </div>
            </details>

            <details
              id="order-history-details"
              open={briefTarget?.category === 'escalated_dispute' || briefTarget?.category === 'custody_approval'}
              className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <summary className="cursor-pointer font-black">Disputes and verified gold history</summary>
              <div className="mt-3 space-y-3">
                <details
                  id="dispute-entry"
                  open={briefTarget?.category === 'escalated_dispute'}
                  className="rounded-xl bg-gray-50 p-3"
                >
                  <summary className="cursor-pointer font-bold">Disputes</summary>
                  {canUseOrderPanels && (
                    <DisputePanel
                      orderId={activeOrderId}
                      userId={user.id}
                      role="jeweller"
                      language={panelLanguage}
                      focusEventId={briefTarget?.category === 'escalated_dispute' ? briefTarget.eventId : null}
                    />
                  )}
                </details>
                <details open={briefTarget?.category === 'custody_approval'} className="rounded-xl bg-gray-50 p-3">
                  <summary className="cursor-pointer font-bold">Gold journey and hash verification</summary>
                  <GoldJourneyPanel orderId={activeOrderId} userId={user.id} />
                </details>
                <details className="rounded-xl bg-gray-50 p-3">
                  <summary className="cursor-pointer font-bold">Voice entry</summary>
                  <div className="mt-3 space-y-3">
                    <button
                      type="button"
                      onClick={listen}
                      className={`min-h-12 rounded-xl px-4 font-bold text-white ${isListening ? 'bg-red-600' : 'bg-gray-900'}`}
                    >
                      <Mic aria-hidden="true" className="mr-2 inline" size={18} />
                      {isListening ? 'Listening…' : 'Speak an entry'}
                    </button>
                    {transcript && <p className="text-sm">Heard: “{transcript}”</p>}
                    {speechError && <p role="alert" className="text-sm font-semibold text-red-700">{speechError}</p>}
                    {draftEvent && (
                      <div className="rounded-xl bg-indigo-50 p-3">
                        <p className="font-semibold">{draftEvent.readBackText}</p>
                        {draftEvent.confidence === 'high' && (
                          <button
                            type="button"
                            disabled={postingVoiceEvent}
                            onClick={async () => {
                              setPostingVoiceEvent(true);
                              try {
                                const posted = await postLedgerEvent(
                                  draftEvent.type,
                                  draftEvent.weightMg,
                                  draftEvent.amount,
                                  `Voice Entry: ${transcript}`,
                                );
                                if (posted) setDraftEvent(null);
                              } catch (postError) {
                                setDemoError(postError instanceof Error ? postError.message : 'Could not post voice entry.');
                              } finally {
                                setPostingVoiceEvent(false);
                              }
                            }}
                            className="mt-3 min-h-11 rounded-xl bg-green-700 px-4 font-bold text-white"
                          >
                            {postingVoiceEvent ? 'Saving…' : 'Confirm entry'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDraftEvent(null)}
                          className="ml-2 min-h-11 rounded-xl bg-gray-200 px-4 font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </details>
          </>
        )}

        {activeScreen === 'records' && (
          <>
            <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black">Records</h2>
              <details>
                <summary className="cursor-pointer rounded-xl bg-gray-50 p-3 font-bold">
                  Choose a job · {demoOrders.length}
                </summary>
                <div className="mt-2 space-y-2">
                  {demoOrders.length === 0 && <p className="text-sm text-gray-600">No records yet.</p>}
                  {demoOrders.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => setSelectedRecordOrderId(order.id)}
                      className={`min-h-11 w-full rounded-xl p-3 text-left font-semibold ${selectedRecordOrderId === order.id ? 'bg-amber-100' : 'bg-gray-50'}`}
                    >
                      {order.description}
                    </button>
                  ))}
                </div>
              </details>
              {!selectedRecordOrderId && (
                <p className="text-sm text-gray-600">Choose a job to review disputes and its verified history.</p>
              )}
            </section>
            {selectedRecordOrderId && (
              <>
                <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer font-black">Disputes and corrections</summary>
                  <div className="mt-3">
                    <DisputePanel
                      orderId={selectedRecordOrderId}
                      userId={user.id}
                      role="jeweller"
                      language={panelLanguage}
                    />
                  </div>
                </details>
                <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <summary className="cursor-pointer font-black">Verified ledger and gold journey</summary>
                  <div className="mt-3">
                    <GoldJourneyPanel orderId={selectedRecordOrderId} userId={user.id} />
                  </div>
                </details>
              </>
            )}
          </>
        )}

        {activeScreen === 'more' && (
          <>
            <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-black">Gold values, rate shock and rate policy</summary>
              <div className="mt-3">
                <DashboardPanel userId={user.id} role="jeweller" language={panelLanguage} onSelectOrder={openOrder} />
              </div>
            </details>
            <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-black">Early warning and synthetic replay</summary>
              <div className="mt-3">
                <KarigarFloatPanel userId={user.id} role="jeweller" language={panelLanguage} view="signals" />
              </div>
            </details>
            <details className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-black">Inbox and action log · {inboxEvents.length}</summary>
              <div className="mt-3 space-y-3">
                {inboxEvents.length === 0 && <p className="text-sm text-gray-600">Inbox is clear.</p>}
                {inboxEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openOrder(event.orderId)}
                    className="min-h-12 w-full rounded-xl bg-amber-50 p-3 text-left"
                  >
                    <strong className="block">{event.description || 'Gold work'} · {event.type.replaceAll('_', ' ')}</strong>
                    <span className="text-sm">
                      {event.type === 'payment' || event.type === 'settlement'
                        ? `${formatPaise(event.amount)} · SIMULATED`
                        : `${event.weightMg.toLocaleString()} ${t.mg}`}
                    </span>
                  </button>
                ))}
                <DeadlinePanel userId={user.id} role="jeweller" view="more" />
                {showDemoControls && (
                  <details className="rounded-xl bg-gray-50 p-3">
                    <summary className="cursor-pointer font-bold">Demo controls · SIMULATED</summary>
                    <div className="mt-3 space-y-3">
                      <DailyBriefPanel
                        userId={user.id}
                        role="jeweller"
                        language={panelLanguage}
                        onOpenAction={openBriefAction}
                        showActions={false}
                      />
                      <DeadlinePanel
                        userId={user.id}
                        role="jeweller"
                        view="controls"
                        showDemoControls
                      />
                    </div>
                  </details>
                )}
              </div>
            </details>
          </>
        )}
      </main>

      <nav
        aria-label="Jeweller navigation"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1">
          {routeManifest.tabs.map((tab) => {
            const Icon = tab.id === 'home'
              ? Home
              : tab.id === 'karigars'
                ? Users
                : tab.id === 'orders'
                  ? ClipboardList
                  : BookOpen;
            return (
              <button
                key={tab.id}
                type="button"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => navigateTo(tab.id as AppScreen)}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold ${activeTab === tab.id ? 'bg-amber-100 text-amber-950' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Icon aria-hidden="true" size={20} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}