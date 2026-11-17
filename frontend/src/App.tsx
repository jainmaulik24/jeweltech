import { useState, useEffect } from 'react';
import { Volume2, CheckCircle, PlusCircle, LogOut, Globe, FileText, Banknote, Mic } from 'lucide-react';
import { useSpeech } from './hooks/useSpeech';
import AgreementPanel from './AgreementPanel';
import ReturnReconciliationPanel from './ReturnReconciliationPanel';
import DashboardPanel from './DashboardPanel';
import DeadlinePanel from './DeadlinePanel';
import DailyBriefPanel from './DailyBriefPanel';
import type { DailyBriefItem } from './DailyBriefPanel';
import DisputePanel from './DisputePanel';
import GoldJourneyPanel from './GoldJourneyPanel';

const dict = {
  en: {
    login: 'Login to Jeweltech',
    jewellerView: 'Jeweller Dashboard',
    karigarView: 'Karigar Dashboard',
    issueGoldTo: 'Issue Gold (5000 mg)',
    createOrder: 'Create New Order',
    generateSettlement: 'Generate Settlement',
    sendProposal: 'Send Proposal to Karigar',
    simulatePayment: 'Simulate Payment (₹)',
    ack: 'Acknowledge',
    balance: 'Outstanding Gold',
    mg: 'mg',
    pendingLabel: 'Pending Approval:',
    readAloud: 'Read Aloud',
    sampleJobs: 'Sample jobs',
    changeJob: 'Change job',
    currentOrder: 'Current order',
    loadingSamples: 'Loading sample jobs…'
  },
  kn: {
    login: 'ಜ್ಯುವೆಲ್ಟೆಕ್ ಲಾಗಿನ್',
    jewellerView: 'ಮಾಲೀಕರ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    karigarView: 'ಕಾರಿಗರ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    issueGoldTo: 'ಚಿನ್ನ ನೀಡಿ (5000 ಮಿ.ಗ್ರಾಂ)',
    createOrder: 'ಹೊಸ ಆರ್ಡರ್ ರಚಿಸಿ',
    generateSettlement: 'ಸೆಟಲ್ಮೆಂಟ್ ರಚಿಸಿ',
    sendProposal: 'ಪ್ರಸ್ತಾವನೆ ಕಳುಹಿಸಿ',
    simulatePayment: 'ಪಾವತಿ ಸಿಮ್ಯುಲೇಟ್ ಮಾಡಿ (₹)',
    ack: 'ಒಪ್ಪಿಕೊಳ್ಳಿ',
    balance: 'ಬಾಕಿ ಚಿನ್ನ',
    mg: 'ಮಿ.ಗ್ರಾಂ',
    pendingLabel: 'ಅನುಮೋದನೆಗಾಗಿ ಕಾಯುತ್ತಿದೆ:',
    readAloud: 'ಓದಿ ಹೇಳಿ',
    sampleJobs: 'ಮಾದರಿ ಕೆಲಸಗಳು',
    changeJob: 'ಕೆಲಸ ಬದಲಿಸಿ',
    currentOrder: 'ಪ್ರಸ್ತುತ ಆರ್ಡರ್',
    loadingSamples: 'ಮಾದರಿ ಕೆಲಸಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ…'
  }
};

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
  type: string;
  notes: string | null;
  amount: number;
  weightMg: number;
  createdBy: string;
}

// Local deterministic parser fallback so voice entry never fails if backend isn't restarted
function localParseUtterance(text: string) {
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
  } else if (/issue|issued|give|given|gave|sent|hand over|transfer|ನೀಡಿದ್ದೇನೆ|ಕೊಟ್ಟೆ|ನೀಡಿ|ಇಶ್ಯೂ/.test(norm)) {
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
  const [lang, setLang] = useState<'en' | 'kn'>('en');
  const [user, setUser] = useState<{ id: string, role: string } | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [demoOrderState, setDemoOrderState] = useState<{ userId: string; orders: DemoOrder[] } | null>(null);
  const [demoError, setDemoError] = useState('');
  const [balance, setBalance] = useState(0);

  const [pendingEventState, setPendingEventState] = useState<{
    orderId: string;
    userId: string;
    events: PendingEvent[];
  } | null>(null);
  const [proposal, setProposal] = useState<{ amountDue: number, breakdown: string } | null>(null);
  const [briefTarget, setBriefTarget] = useState<{ orderId: string; eventId: string | null; category: string } | null>(null);

  const t = dict[lang];
  const demoOrders = demoOrderState && user && demoOrderState.userId === user.id ? demoOrderState.orders : [];
  const activeDemoOrder = demoOrders.find((order) => order.id === activeOrderId);
  const canUseOrderPanels = user?.role === 'jeweller'
    || (user?.role === 'karigar' && (!activeDemoOrder || activeDemoOrder.karigarId === user.id));
  const pendingEvents = pendingEventState?.orderId === activeOrderId && pendingEventState?.userId === user?.id
    ? pendingEventState.events
    : [];

  // --- VOICE ENTRY STATE & LOGIC ---
  const { isListening, transcript, listen } = useSpeech(lang === 'en' ? 'en-IN' : 'kn-IN');
  const [draftEvent, setDraftEvent] = useState<any>(null);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === 'kn' ? 'kn-IN' : 'en-IN';
      window.speechSynthesis.speak(utterance);
    }
  };

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
  }, [transcript, isListening]);
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

  const fetchPendingEvents = async (orderId: string, userId: string) => {
    const events = await loadPendingEvents(orderId, userId);
    setPendingEventState({ orderId, userId, events });
  };

  const openBriefAction = (item: DailyBriefItem) => {
    if (!user) return;
    setActiveOrderId(item.orderId);
    setBriefTarget({
      orderId: item.orderId,
      eventId: item.eventId,
      category: item.category,
    });
    window.history.pushState(null, '', item.category === 'custody_approval' ? '#gold-journey' : item.href);
    void fetchBalance(item.orderId);
    if (item.category !== 'custody_approval') {
      void fetchPendingEvents(item.orderId, user.id)
        .catch((loadError: Error) => setDemoError(loadError.message));
    }
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
      fetchBalance(data.id);
      return data.id;
    } else {
      const err = await res.json();
      alert(`Failed to create order: ${err.error}`);
      return null;
    }
  };

  const postLedgerEvent = async (type: string, weightMg: number, amount: number = 0, notes: string | null = null) => {
    let targetOrderId = activeOrderId;
    if (!targetOrderId) {
      targetOrderId = await handleCreateOrder();
      if (!targetOrderId) return;
    }

    const res = await fetch('/api/ledger/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user!.id },
      body: JSON.stringify({ orderId: targetOrderId, type, weightMg, amount, notes, idempotencyKey: crypto.randomUUID() })
    });
    if (res.ok) {
      const data = await res.json();
      setProposal(null);
      if (targetOrderId && user) await fetchPendingEvents(targetOrderId, user.id);
      const displayVal = type === 'payment' || type === 'settlement' ? formatPaise(data.amount) : `${weightMg} mg`;
      alert(`${type.toUpperCase()} (${displayVal}) sent for Karigar approval.`);
    } else {
      const error = await res.json();
      alert(`Could not record ${type}: ${error.error ?? 'Unknown error'}`);
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
      alert('Acknowledged successfully!');
    } else {
      const error = await res.json();
      alert(`Could not acknowledge event: ${error.error ?? 'Unknown error'}`);
    }
  };

  const selectUser = (nextUser: { id: string; role: string } | null) => {
    setUser(nextUser);
    setActiveOrderId(null);
    setDemoOrderState(null);
    setPendingEventState(null);
    setProposal(null);
    setBriefTarget(null);
    setBalance(0);
    setDemoError('');
    if (!nextUser) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  };

  if (!user) {
    return (
      <div className="max-w-md mx-auto h-screen overflow-y-auto bg-gray-50 flex flex-col justify-center p-6">
        <div className="flex justify-end mb-8">
          <button onClick={() => setLang(lang === 'en' ? 'kn' : 'en')} className="flex items-center gap-2 p-2 bg-gray-200 text-gray-800 rounded-full font-bold">
            <Globe size={24} /> {lang.toUpperCase()}
          </button>
        </div>
        <h1 className="text-4xl font-black text-center mb-10 text-amber-600 tracking-tight">{t.login}</h1>
        <div className="space-y-4">
          <button onClick={() => selectUser({ id: 'j1', role: 'jeweller' })} className="w-full py-4 bg-gray-900 text-white rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-transform">
            Jeweller (J1)
          </button>
          <button onClick={() => selectUser({ id: 'k1', role: 'karigar' })} className="w-full py-4 bg-amber-600 text-white rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-transform">
            Karigar (K1)
          </button>
          <button onClick={() => selectUser({ id: 'k2', role: 'karigar' })} className="w-full py-4 bg-amber-700 text-white rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-transform">
            Karigar (K2)
          </button>
          <button onClick={() => selectUser({ id: 'k5', role: 'karigar' })} className="w-full py-4 bg-amber-800 text-white rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-transform">
            Karigar (K5)
          </button>
          <button onClick={() => selectUser({ id: 's1', role: 'staff' })} className="w-full py-4 bg-indigo-800 text-white rounded-2xl text-xl font-bold shadow-xl active:scale-95 transition-transform">
            Helper (S1)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-screen max-w-xl flex-col bg-gray-100 font-sans">
      <header className="flex items-center justify-between gap-3 bg-gray-900 p-4 text-white shadow-lg sm:p-5">
      <h2 className="min-w-0 break-words text-lg font-black tracking-wide sm:text-xl">{user.role === 'jeweller' ? t.jewellerView : user.role === 'staff' ? 'Helper View' : t.karigarView}</h2>
        <div className="flex gap-4">
          <button onClick={() => setLang(lang === 'en' ? 'kn' : 'en')} className="hover:text-amber-400"><Globe size={24} /></button>
          <button onClick={() => selectUser(null)} className="hover:text-amber-400"><LogOut size={24} /></button>
        </div>
      </header>

      <main className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-5">

        {demoError && <p role="alert" className="break-words rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{demoError}</p>}

        {!activeOrderId && (
          <>
            {user.role !== 'staff' && (
              <DailyBriefPanel
                userId={user.id}
                role={user.role === 'karigar' ? 'karigar' : 'jeweller'}
                language={lang}
                onOpenAction={openBriefAction}
              />
            )}
            {user.role !== 'staff' && (
              <DashboardPanel
                userId={user.id}
                role={user.role === 'jeweller' ? 'jeweller' : 'karigar'}
                language={lang}
                onSelectOrder={(orderId) => {
                  setActiveOrderId(orderId);
                  fetchBalance(orderId);
                  setDemoError('');
                }}
              />
            )}
            {user.role === 'staff' && (
              <section className="space-y-3 rounded-3xl border border-indigo-200 bg-white p-4 shadow-sm">
                <h2 className="font-black text-gray-900">Assigned gold journeys</h2>
                {demoOrders.length === 0 && <p className="text-sm text-gray-600">No assigned handoffs are available.</p>}
                {demoOrders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => { setActiveOrderId(order.id); fetchBalance(order.id); }}
                    className="w-full rounded-xl bg-indigo-50 p-3 text-left font-semibold text-indigo-950"
                  >
                    {order.description} · Open journey
                  </button>
                ))}
              </section>
            )}
            <DeadlinePanel
              userId={user.id}
              role={user.role === 'staff' || user.role === 'karigar' ? user.role : 'jeweller'}
            />
          </>
        )}

        {activeOrderId && user && (
          <>
            <div id={`order-${activeOrderId}`} className="rounded-3xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:p-8">
              <p className="text-gray-500 text-lg font-medium mb-2">{t.balance}</p>
              <div className="flex flex-wrap items-baseline justify-center gap-x-2 break-words text-[clamp(2.5rem,10vw,3.75rem)] font-black tracking-tighter text-amber-600">
                {balance.toLocaleString()} <span className="text-xl font-bold text-gray-400 sm:text-2xl">{t.mg}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-3 shadow-sm">
              <p className="min-w-0 break-words font-bold text-gray-800">
                {demoOrders.find((order) => order.id === activeOrderId)?.description ?? t.currentOrder}
              </p>
              <button onClick={() => { setActiveOrderId(null); setProposal(null); setDemoError(''); }} className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-sm font-bold text-gray-800">
                {t.changeJob}
              </button>
            </div>
            {canUseOrderPanels && <AgreementPanel
              orderId={activeOrderId}
              userId={user.id}
              role={user.role === 'jeweller' ? 'jeweller' : 'karigar'}
              language={lang}
            />}
            {canUseOrderPanels && <ReturnReconciliationPanel
              orderId={activeOrderId}
              userId={user.id}
              language={lang}
              onSubmitted={() => {
                fetchBalance(activeOrderId);
                fetchPendingEvents(activeOrderId, user.id).catch((loadError: Error) => setDemoError(loadError.message));
              }}
            />}
            {canUseOrderPanels && <DisputePanel
              orderId={activeOrderId}
              userId={user.id}
              role={user.role === 'jeweller' ? 'jeweller' : 'karigar'}
              language={lang}
              focusEventId={briefTarget?.category === 'escalated_dispute' ? briefTarget.eventId : null}
            />}
            <GoldJourneyPanel orderId={activeOrderId} userId={user.id} />
          </>
        )}

        {/* Jeweller Controls */}
        {user.role === 'jeweller' && pendingEvents.length === 0 && (
          <div className="space-y-4 mt-2">

            {/* 1. THE MICROPHONE BUTTON */}
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200 text-center my-6">
              <button
                onClick={listen}
                className={`p-6 rounded-full text-white shadow-xl mb-4 transition-all ${isListening ? 'bg-red-500 animate-pulse' : 'bg-gray-900 hover:bg-gray-800'
                  }`}
              >
                <Mic size={32} />
              </button>
              <p className="text-gray-500 font-medium">
                {isListening ? 'Listening...' : (transcript ? `Heard: "${transcript}"` : 'Tap to speak ledger event')}
              </p>
            </div>

            {/* 2. THE DRAFT CONFIRMATION CARD */}
            {draftEvent && (
              <div className={`p-6 rounded-3xl border-2 mb-6 ${draftEvent.confidence === 'high' ? 'bg-green-50 border-green-400' : 'bg-red-50 border-red-400'
                }`}>
                <h3 className="font-black text-xl mb-2">
                  {draftEvent.confidence === 'high' ? 'Confirm Draft' : 'Low Confidence - Please Retry'}
                </h3>

                <p className="text-gray-700 font-bold mb-4">{draftEvent.readBackText}</p>

                {draftEvent.confidence === 'high' && (
                  <button
                    onClick={() => {
                      postLedgerEvent(draftEvent.type, draftEvent.weightMg, draftEvent.amount, `Voice Entry: ${transcript}`);
                      setDraftEvent(null);
                    }}
                    className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold shadow-md hover:bg-green-700"
                  >
                    Confirm & Post ({draftEvent.type === 'payment' ? `₹${draftEvent.amount.toLocaleString()}` : `${draftEvent.weightMg} mg`})
                  </button>
                )}

                <button
                  onClick={() => setDraftEvent(null)}
                  className="w-full mt-3 bg-gray-200 text-gray-800 py-3 rounded-2xl font-bold hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            )}

            {!activeOrderId && !draftEvent && (
              <button onClick={handleCreateOrder} className="w-full flex items-center justify-center gap-3 bg-gray-900 text-white py-5 rounded-2xl text-xl font-bold shadow-md active:scale-95">
                <PlusCircle size={28} /> {t.createOrder}
              </button>
            )}

            {activeOrderId && balance === 0 && !draftEvent && (
              <button onClick={() => postLedgerEvent('issue', 5000)} className="w-full flex items-center justify-center gap-3 bg-amber-500 text-white py-5 rounded-2xl text-xl font-bold shadow-md active:scale-95">
                <PlusCircle size={28} /> {t.issueGoldTo}
              </button>
            )}

            {activeOrderId && balance > 0 && !proposal && !draftEvent && (
              <button onClick={handleGenerateSettlement} className="w-full flex items-center justify-center gap-3 bg-indigo-600 text-white py-5 rounded-2xl text-xl font-bold shadow-md active:scale-95">
                <FileText size={28} /> {t.generateSettlement}
              </button>
            )}

            {proposal && (
              <div className="bg-indigo-50 p-5 rounded-3xl border border-indigo-200">
                <pre className="text-indigo-900 font-mono text-sm whitespace-pre-wrap font-bold">{proposal.breakdown}</pre>
                <button onClick={() => postLedgerEvent('settlement', balance, proposal.amountDue, proposal.breakdown)} className="w-full mt-4 flex items-center justify-center gap-3 bg-indigo-700 text-white py-4 rounded-2xl text-lg font-bold shadow-md active:scale-95">
                  <CheckCircle size={24} /> {t.sendProposal} ({formatPaise(proposal.amountDue)})
                </button>
              </div>
            )}

            {activeOrderId && balance > 0 && !proposal && !draftEvent && (
              <button
                onClick={() => {
                  postLedgerEvent('payment', 0, 0, 'SIMULATED payment under the stored agreement rate policy.');
                }}
                className="w-full flex items-center justify-center gap-3 bg-emerald-600 text-white py-5 rounded-2xl text-xl font-bold shadow-md active:scale-95"
              >
                <Banknote size={28} /> {t.simulatePayment}
              </button>
            )}
          </div>
        )}

        {/* Karigar Controls */}
        {user.role === 'karigar' && (
          <div className="space-y-4 mt-2">
            <button onClick={() => speak(`${t.balance} ${balance} ${t.mg}`)} className="w-full flex items-center justify-center gap-3 bg-blue-100 text-blue-900 py-5 rounded-2xl text-xl font-bold shadow-sm active:bg-blue-200">
              <Volume2 size={28} /> {t.readAloud}
            </button>
          </div>
        )}

        {pendingEvents.map((event) => (
          <div id={`ledger-event-${event.id}`} key={event.id} className="min-w-0 rounded-3xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm sm:p-5">
            <h3 className="break-words font-black">{t.pendingLabel} {event.type.replaceAll('_', ' ').toUpperCase()}</h3>
            {event.type === 'settlement' && event.notes ? (
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-amber-200 bg-white p-3 text-sm font-semibold">{event.notes}</pre>
            ) : event.type === 'payment' ? (
              <p className="mt-2 break-words font-semibold">Amount: {formatPaise(event.amount)} · SIMULATED</p>
            ) : (
              <p className="mt-2 break-words font-semibold">Amount: {event.weightMg.toLocaleString()} {t.mg}</p>
            )}
            {event.createdBy === user.id ? (
              <p className="mt-3 break-words text-sm font-bold">{t.pendingLabel} awaiting the other party.</p>
            ) : (
              <button onClick={() => handleAcknowledge(event)} className="mt-3 flex w-full items-center justify-center gap-3 rounded-2xl bg-green-600 py-4 font-bold text-white shadow-md">
                <CheckCircle size={22} /> {t.ack}
              </button>
            )}
          </div>
        ))}
      </main>
    </div>
  );
}