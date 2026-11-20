import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Bell,
  BookOpen,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Mic,
  Search,
  Settings,
  Users,
  UserRound,
  Volume2,
  X,
} from 'lucide-react';
import type { LoginUser } from './PinLogin';
import { useSpeech } from './hooks/useSpeech';
import {
  appendDemoActivity,
  DEFAULT_DEMO_SETTINGS,
  getKarigarBalances,
  getOrderThresholdMg,
  DEFAULT_ALLOWED_PCT,
  LOW_UNTOUCHED_WARNING_MG,
  makeDemoId,
  readDemoStore,
  resetDemoStore,
  subscribeDemoStore,
  transactDemoStore,
  type DemoKarigar,
  type DemoOrder,
  type DemoStore,
} from './goldOrderStore';
import type { LocaleCode } from './locales';

interface Props {
  user: LoginUser;
  language: LocaleCode;
  onLanguageChange: (language: LocaleCode) => void;
  onLogout: () => void;
}

const grams = (mg: number) => `${Number((mg / 1000).toFixed(3))} g`;
const toMg = (gramsValue: number) => Math.round(gramsValue * 1000);
const speechLanguage = (language: LocaleCode) =>
  language === 'hi' ? 'hi-IN' : language === 'kn' ? 'kn-IN' : 'en-IN';
const typedNumbers: Record<string, string> = {
  ek: '1', do: '2', teen: '3', char: '4', chaar: '4', paanch: '5',
  chhe: '6', che: '6', saat: '7', aath: '8', nau: '9', das: '10', bees: '20',
};
const hindiSpokenNumbers: Record<string, string> = {
  एक: '1', इक: '1', दो: '2', तीन: '3', चार: '4', पांच: '5', पाँच: '5',
  छह: '6', छः: '6', सात: '7', आठ: '8', नौ: '9', दस: '10',
  ग्यारह: '11', बारह: '12', तेरह: '13', चौदह: '14', पंद्रह: '15', पन्द्रह: '15',
  सोलह: '16', सत्रह: '17', अठारह: '18', उन्नीस: '19', बीस: '20',
  तीस: '30', चालीस: '40', पचास: '50', साठ: '60', सत्तर: '70', अस्सी: '80', नब्बे: '90',
  सौ: '100', डेढ़: '1.5', ढाई: '2.5',
};
const normalizeHindiWeightWords = (text: string) => text
  .replace(/[०-९]/g, (digit) => String('०१२३४५६७८९'.indexOf(digit)))
  .split(/(\s+)/)
  .map((part) => {
    const word = part.replace(/[.,!?।]/g, '');
    return hindiSpokenNumbers[word] ?? part;
  })
  .join('');
const englishSpokenNumbers: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
};
const normalizeLooseNumbers = (text: string) => normalizeHindiWeightWords(text)
  .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi,
    (word) => englishSpokenNumbers[word.toLowerCase()] ?? word)
  .replace(/\b(ek|do|teen|char|chaar|paanch|chhe|che|saat|aath|nau|das|bees)\b/gi,
    (word) => typedNumbers[word.toLowerCase()] ?? word)
  .replace(/(\d+)\s+(?:point|दशमलव)\s+(\d+)/gi, '$1.$2')
  .replace(/(?:point|दशमलव)\s+(\d+)/gi, '0.$1');
const formatDate = (date: string) => new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
}).format(new Date(date));
const formatINR = (amount: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
}).format(amount);
const estimatedCustomerValue = (expectedWeightG: number, makingINR: number, ratePerGram: number) =>
  Math.round(toMg(expectedWeightG) * ratePerGram / 1000) + makingINR;
const DEMO_JEWELLERS = [
  'Jain Jewellers',
  'Sri Raj Jewellers',
  'Lakshmi Gold House',
  'Mehta Jewellers',
  'Mysore Jewels',
];

function verdict(order: DemoOrder) {
  if (order.reportedWasteMg === null) return null;
  const thresholdMg = getOrderThresholdMg(order);
  const differenceMg = Math.abs(thresholdMg - order.reportedWasteMg);
  return {
    thresholdMg,
    label: order.reportedWasteMg < thresholdMg ? 'KAM hua' : order.reportedWasteMg > thresholdMg ? 'ZYADA hua' : 'BARABAR hua',
    differenceMg,
    direction: order.reportedWasteMg < thresholdMg ? 'bonus' : order.reportedWasteMg > thresholdMg ? 'over' : 'none',
  };
}

function parseWeight(text: string, requireUnit = false, allowZero = false): number | null {
  const normalized = normalizeLooseNumbers(text).toLowerCase();
  const match = normalized.match(requireUnit
    ? /(\d+(?:\.\d+)?)\s*(?:grams?|g|ग्राम|point)(?=\s|$|[,!.])/i
    : /(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const value = Number(match[1]);
  const weightMg = toMg(value);
  return Number.isSafeInteger(weightMg) && (allowZero ? weightMg >= 0 : weightMg > 0) ? weightMg : null;
}

function makeOrder(
  karigarId: string,
  title: string,
  drawMg: number,
  customerOrderId: string | null,
  allowedPct = DEFAULT_ALLOWED_PCT,
  customerDueDate?: string,
): DemoOrder {
  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 7);
  return {
    id: makeDemoId(),
    karigarId,
    title,
    customerOrderId,
    drawMg,
    allowedPct,
    status: 'open',
    reportedWasteMg: null,
    createdAt: now.toISOString(),
    dueDate: customerDueDate ?? dueDate.toISOString(),
    closedAt: null,
    isNew: true,
    acknowledged: false,
    disputeReason: null,
  };
}

function karigarIdFor(user: LoginUser, karigars: DemoKarigar[]): string | null {
  const normalizedName = user.name.trim().toLowerCase();
  const byName = karigars.find((karigar) => karigar.name.toLowerCase() === normalizedName);
  if (byName) return byName.id;
  const idIndex = /^k([1-4])$/.exec(user.id);
  return idIndex ? karigars[Number(idIndex[1]) - 1]?.id ?? null : null;
}

export default function GoldOrderDemo({ user, language, onLanguageChange, onLogout }: Props) {
  const [store, setStore] = useState<DemoStore | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedKarigarId, setSelectedKarigarId] = useState('');
  const [selectedDemoJeweller, setSelectedDemoJeweller] = useState('');
  const [selectedCustomerOrderId, setSelectedCustomerOrderId] = useState('');
  const [customerForm, setCustomerForm] = useState({
    customerId: '',
    item: '',
    expectedWeightG: '',
    dueDate: new Date().toISOString().slice(0, 10),
    advanceINR: '0',
    makingINR: '0',
  });
  const [assignmentInputs, setAssignmentInputs] = useState<Record<string, { karigarId: string; grams: string }>>({});
  const [floatTopUpGrams, setFloatTopUpGrams] = useState('');
  const [screen, setScreen] = useState<
    'dashboard' | 'karigars' | 'karigar-detail' | 'orders' | 'customers' | 'ledger' | 'settings'
  >('dashboard');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderKarigarFilter, setOrderKarigarFilter] = useState('all');
  const [orderCustomerFilter, setOrderCustomerFilter] = useState('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [karigarSort, setKarigarSort] = useState<'name' | 'untouched' | 'trust' | 'pending'>('name');
  const [whatIfRateDelta, setWhatIfRateDelta] = useState(0);
  const [ledgerKarigarFilter, setLedgerKarigarFilter] = useState('all');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState('all');
  const [ledgerFrom, setLedgerFrom] = useState('');
  const [ledgerTo, setLedgerTo] = useState('');
  const [statementKarigarId, setStatementKarigarId] = useState('');
  const [nowMs, setNowMs] = useState(0);
  const [command, setCommand] = useState('');
  const [commandPreview, setCommandPreview] = useState<{
    kind: 'order' | 'topup';
    grams: number;
    title: string;
    karigarId: string;
    customerOrderId: string | null;
  } | null>(null);
  const [wastageInputs, setWastageInputs] = useState<Record<string, string>>({});
  const [wastagePreviews, setWastagePreviews] = useState<Record<string, number | null>>({});
  const [reasonOrderId, setReasonOrderId] = useState('');
  const [reportFormOrderId, setReportFormOrderId] = useState('');
  const [speechTarget, setSpeechTarget] = useState('command');
  const speechTargetRef = useRef('command');
  const commandInputRef = useRef<HTMLInputElement>(null);
  const handleTranscript = useCallback((spoken: string) => {
    const target = speechTargetRef.current;
    if (target === 'command') {
      setCommand(spoken);
      setCommandPreview(null);
    } else {
      const amountMg = parseWeight(spoken, false, true);
      if (amountMg === null) {
        setError('I heard speech, but not a wastage number. Try saying a number such as 1.5.');
        return;
      }
      const amountGrams = (amountMg / 1000).toLocaleString('en-IN', {
        useGrouping: false,
        maximumFractionDigits: 3,
      });
      setWastageInputs((current) => ({ ...current, [target]: `${amountGrams} g` }));
      setWastagePreviews((current) => ({ ...current, [target]: null }));
      setError('');
    }
  }, []);
  const { isListening, transcript, listen, error: speechError } = useSpeech(speechLanguage(language), handleTranscript);

  useEffect(() => {
    if (speechError) commandInputRef.current?.focus();
  }, [speechError]);

  const refresh = useCallback(() => {
    try {
      setStore(readDemoStore());
      setError('');
      setNotice('');
      setCommand('');
      setCommandPreview(null);
      setWastageInputs({});
      setWastagePreviews({});
      setReportFormOrderId('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the shared demo ledger.');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDemoStore(refresh);
    const timeoutId = window.setTimeout(refresh, 0);
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    updateClock();
    const timerId = window.setInterval(updateClock, 60_000);
    return () => window.clearInterval(timerId);
  }, []);

  const listenFor = (target: string) => {
    speechTargetRef.current = target;
    setSpeechTarget(target);
    listen();
  };

  const pendingReports = useMemo(
    () => store?.orders.filter((order) => order.status === 'reported') ?? [],
    [store],
  );
  const currentKarigarId = store && user.role === 'karigar' ? karigarIdFor(user, store.karigars) : null;
  const selectedKarigar = store?.karigars.find((karigar) => karigar.id === selectedKarigarId);
  const lowFloatThresholdG = store?.settings?.lowFloatThresholdG ?? DEFAULT_DEMO_SETTINGS.lowFloatThresholdG;
  const demoRates = store?.settings?.demoRates ?? DEFAULT_DEMO_SETTINGS.demoRates;
  const rateLastUpdated = store?.settings?.rateLastUpdated ?? DEFAULT_DEMO_SETTINGS.rateLastUpdated;
  const activeOrders = store?.orders.filter((order) => order.status !== 'closed') ?? [];
  const overdueOrders = activeOrders.filter((order) => nowMs > 0 && Date.parse(order.dueDate) < nowMs);
  const disputedOrders = activeOrders.filter((order) => order.status === 'disputed');
  const totalFloatMg = store?.karigars.reduce((sum, karigar) => sum + karigar.floatTotalMg, 0) ?? 0;
  const currentMonthStart = new Date();
  currentMonthStart.setDate(1);
  currentMonthStart.setHours(0, 0, 0, 0);
  const closedThisMonth = store?.orders.filter((order) =>
    order.status === 'closed'
    && order.closedAt !== null
    && Date.parse(order.closedAt) >= currentMonthStart.getTime()) ?? [];
  const monthDrawMg = closedThisMonth.reduce((sum, order) => sum + order.drawMg, 0);
  const monthWasteMg = closedThisMonth.reduce((sum, order) => sum + (order.reportedWasteMg ?? 0), 0);
  const monthThresholdMg = closedThisMonth.reduce((sum, order) => sum + getOrderThresholdMg(order), 0);
  const monthWastagePct = monthDrawMg === 0 ? 0 : monthWasteMg / monthDrawMg * 100;
  const monthAllowedPct = monthDrawMg === 0 ? DEFAULT_ALLOWED_PCT : monthThresholdMg / monthDrawMg * 100;
  const monthBonusMg = closedThisMonth.reduce((sum, order) => {
    const result = verdict(order);
    return sum + (result?.direction === 'bonus' ? result.differenceMg : 0);
  }, 0);

  const trustScore = (karigarId: string): number => {
    if (!store) return 0;
    const recent = store.orders
      .filter((order) => order.karigarId === karigarId && order.status === 'closed')
      .sort((first, second) => Date.parse(second.closedAt!) - Date.parse(first.closedAt!))
      .slice(0, 5);
    if (recent.length === 0) return 70;
    const withinThreshold = recent.filter((order) =>
      (order.reportedWasteMg ?? 0) <= getOrderThresholdMg(order)).length / recent.length * 100;
    const onTime = recent.filter((order) =>
      Date.parse(order.closedAt!) <= Date.parse(order.dueDate)).length / recent.length * 100;
    const disputePenalty = Math.min(100, store.orders.filter((order) =>
      order.karigarId === karigarId && order.status === 'disputed').length * 25);
    return Math.round(withinThreshold * 0.6 + onTime * 0.3 + (100 - disputePenalty) * 0.1);
  };

  const customerForOrder = (order: DemoOrder) => {
    const customerOrder = store?.customerOrders.find((item) => item.id === order.customerOrderId);
    return {
      customerOrder,
      customer: store?.customers.find((item) => item.id === customerOrder?.customerId),
    };
  };

  const openOrderInDrawer = (orderId: string) => {
    setSelectedOrderId(orderId);
    setOrderStatusFilter('all');
    setScreen('orders');
  };

  const openKarigarDetail = (karigarId: string, topUpGrams?: number) => {
    setSelectedKarigarId(karigarId);
    setSelectedCustomerOrderId('');
    setFloatTopUpGrams(topUpGrams ? String(topUpGrams) : '');
    setCommand('');
    setCommandPreview(null);
    setScreen('karigar-detail');
  };

  const updateDemoRate = (purity: 24 | 22 | 18, value: string) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a demo gold rate greater than zero.');
      return;
    }
    perform(() => transactDemoStore((current) => ({
      ...current,
      settings: {
        ...current.settings,
        demoRates: { ...current.settings.demoRates, [purity]: amount },
        rateLastUpdated: new Date().toISOString(),
      },
    })));
  };

  const updateCustomer = (customerOrderId: string, orderId: string) => {
    if (!store) return;
    const order = store.orders.find((item) =>
      item.id === orderId && item.customerOrderId === customerOrderId && item.status === 'closed');
    if (!order) {
      setError('A customer update is available after the linked work is acknowledged.');
      return;
    }
    const customerOrder = store.customerOrders.find((item) => item.id === customerOrderId);
    const customer = store.customers.find((item) => item.id === customerOrder?.customerId);
    if (!customer || !customerOrder) {
      setError('Could not find the customer linked to this completed work.');
      return;
    }
    const result = verdict(order);
    if (!result) {
      setError('Could not calculate the completed work result.');
      return;
    }
    const karigar = store.karigars.find((item) => item.id === order.karigarId);
    const comparison = result.direction === 'none'
      ? 'within the agreed wastage allowance'
      : `${grams(result.differenceMg)} ${result.direction === 'bonus' ? 'below' : 'above'} the agreed wastage allowance`;
    const text = `Demo update for ${customer.name}: ${customerOrder.item} work${karigar ? ` with ${karigar.name}` : ''} is complete. Reported wastage is ${grams(order.reportedWasteMg ?? 0)} against ${grams(result.thresholdMg)} allowed, ${comparison}.`;
    const preparedAt = new Date().toISOString();
    const saved = perform(() => transactDemoStore((current) => {
      const updated = {
        ...current,
        customerOrders: current.customerOrders.map((item) => item.id === customerOrderId
          ? {
            ...item,
            customerUpdate: {
              orderId,
              preparedAt,
              wastageMg: order.reportedWasteMg ?? 0,
              verdict: result.label,
              text,
            },
          }
          : item),
      };
      return appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId: order.id,
        customerOrderId,
        type: 'notify',
        text: `Customer update recorded (demo): ${text}`,
      });
    }));
    if (saved) setNotice(`Customer updated (demo) for ${customer.name}.`);
  };

  const deliverCustomerOrder = (customerOrderId: string) => {
    const saved = perform(() => transactDemoStore((current) => {
      const customerOrder = current.customerOrders.find((item) => item.id === customerOrderId);
      if (!customerOrder || customerOrder.status !== 'ready') {
        throw new Error('Only a ready customer order can be marked delivered.');
      }
      const order = current.orders.find((item) =>
        item.customerOrderId === customerOrderId && item.status === 'closed');
      if (!order) throw new Error('No acknowledged karigar order is linked to this customer order.');
      const updated = {
        ...current,
        customerOrders: current.customerOrders.map((item) => item.id === customerOrderId
          ? { ...item, status: 'delivered' as const }
          : item),
      };
      return appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId: order.id,
        customerOrderId,
        type: 'delivered',
        text: `Customer order ${customerOrder.item} marked delivered.`,
      });
    }));
    if (saved) setNotice('Customer order marked delivered.');
  };

  const createCustomerOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const expectedWeightG = Number(customerForm.expectedWeightG);
    const advanceINR = Number(customerForm.advanceINR);
    const makingINR = Number(customerForm.makingINR);
    const expectedWeightMg = toMg(expectedWeightG);
    if (!customerForm.customerId || !customerForm.item.trim()
      || !Number.isSafeInteger(expectedWeightMg) || expectedWeightMg <= 0
      || !Number.isSafeInteger(advanceINR) || advanceINR < 0
      || !Number.isSafeInteger(makingINR) || makingINR < 0
      || !Number.isFinite(Date.parse(customerForm.dueDate))) {
      setError('Enter a customer, item, positive expected weight, valid due date, and non-negative charges.');
      return;
    }
    const saved = perform(() => transactDemoStore((current) => {
      const customer = current.customers.find((item) => item.id === customerForm.customerId);
      if (!customer) throw new Error('Select an existing customer.');
      const customerOrder = {
        id: makeDemoId(),
        customerId: customer.id,
        item: customerForm.item.trim(),
        expectedWeightG: expectedWeightMg / 1000,
        dueDate: new Date(`${customerForm.dueDate}T12:00:00`).toISOString(),
        advanceINR,
        makingINR,
        status: 'received' as const,
        customerUpdate: null,
      };
      return appendDemoActivity({
        ...current,
        customerOrders: [...current.customerOrders, customerOrder],
      }, {
        karigarId: '',
        customerOrderId: customerOrder.id,
        type: 'customer-order',
        text: `New customer order from ${customer.name}: ${customerOrder.item}, ${expectedWeightG} g expected.`,
      });
    }));
    if (saved) {
      setCustomerForm((current) => ({
        ...current,
        item: '',
        expectedWeightG: '',
        advanceINR: '0',
        makingINR: '0',
      }));
      setNotice('Customer order created. Assign it to a karigar when ready.');
    }
  };

  const assignCustomerOrder = (customerOrderId: string) => {
    if (!store) return;
    const assignment = assignmentInputs[customerOrderId];
    const karigar = store.karigars.find((item) => item.id === assignment?.karigarId);
    const weightMg = parseWeight(assignment?.grams ?? '');
    if (!karigar || !weightMg) {
      setError('Choose a karigar and enter a positive assignment weight in grams.');
      return;
    }
    const saved = perform(() => transactDemoStore((current) => {
      const customerOrder = current.customerOrders.find((item) => item.id === customerOrderId);
      if (!customerOrder || customerOrder.status !== 'received') {
        throw new Error('This customer order has already been assigned.');
      }
      const untouched = getKarigarBalances(current, karigar.id).untouchedMg;
      if (weightMg > untouched) throw new Error(`Only ${grams(untouched)} is untouched for ${karigar.name}.`);
      const order = makeOrder(
        karigar.id,
        customerOrder.item,
        weightMg,
        customerOrder.id,
        current.settings.defaultWastagePct,
        customerOrder.dueDate,
      );
      const updated = {
        ...current,
        orders: [...current.orders, order],
        customerOrders: current.customerOrders.map((item) => item.id === customerOrderId
          ? { ...item, status: 'with_karigar' as const }
          : item),
      };
      const withAssignment = appendDemoActivity(updated, {
        karigarId: karigar.id,
        orderId: order.id,
        customerOrderId,
        type: 'assign',
        text: `Assigned ${grams(weightMg)} for ${customerOrder.item} to ${karigar.name}.`,
      });
      return appendDemoActivity(withAssignment, {
        karigarId: karigar.id,
        orderId: order.id,
        customerOrderId,
        type: 'notify',
        text: `New work slip for ${customerOrder.item} is ready.`,
      });
    }));
    if (saved) {
      setAssignmentInputs((current) => ({ ...current, [customerOrderId]: { karigarId: '', grams: '' } }));
      setNotice(`${karigar.name} has a new linked work slip.`);
    }
  };

  const readKarigarPageAloud = () => {
    if (!currentKarigarId || !store || !('speechSynthesis' in window)) {
      setError('Audio reading is not available on this device.');
      return;
    }
    const balances = getKarigarBalances(store, currentKarigarId);
    const lines = store.orders
      .filter((order) => order.karigarId === currentKarigarId && order.status !== 'closed')
      .map((order) => `${order.title}. Drawn ${grams(order.drawMg)}. Wastage threshold ${grams(getOrderThresholdMg(order))}. Status ${order.status}.`);
    const speech = new SpeechSynthesisUtterance([
      user.name,
      `Total ${grams(balances.totalMg)}. In orders ${grams(balances.inOrdersMg)}. Untouched ${grams(balances.untouchedMg)}.`,
      ...lines,
    ].join('. '));
    speech.lang = speechLanguage(language);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  };

  const perform = (action: () => DemoStore): boolean => {
    try {
      setStore(action());
      setError('');
      setNotice('');
      return true;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Could not update the shared demo ledger.');
      return false;
    }
  };

  const handleCommandReview = () => {
    const normalizedCommand = normalizeLooseNumbers(command).toLowerCase();
    const namedKarigar = store?.karigars.find((karigar) =>
      normalizedCommand.includes(karigar.name.toLowerCase()));
    const commandKarigar = namedKarigar ?? selectedKarigar;
    const weightMg = parseWeight(command, true);
    if (!commandKarigar || !weightMg) {
      setCommandPreview(null);
      setError('Enter a positive weight next to gram, g, ग्राम, or point, and include a karigar name or select one.');
      return;
    }
    if (namedKarigar) setSelectedKarigarId(namedKarigar.id);
    const kind = /\b(?:aur|more|top)\b|top[\s-]*up|add(?:ed)?|increase|और\s*दो|टॉप[\s-]*अप|जोड़(?:ो|ें)?/i.test(normalizedCommand)
      ? 'topup'
      : 'order';
    const title = /\bchain\b/i.test(normalizedCommand) ? 'Chain'
      : /\brings?\b/i.test(normalizedCommand) ? 'Rings'
        : /\bbangles?\b/i.test(normalizedCommand) ? 'Bangles' : 'Order';
    const untouchedMg = getKarigarBalances(store!, commandKarigar.id).untouchedMg;
    if (kind === 'order' && weightMg > untouchedMg) {
      setCommandPreview(null);
      setError(`Only ${grams(untouchedMg)} is untouched. This order cannot be issued.`);
      return;
    }
    setCommandPreview({
      kind,
      grams: weightMg / 1000,
      title: kind === 'topup' ? 'Gold top-up' : title,
      karigarId: commandKarigar.id,
      customerOrderId: kind === 'order' ? selectedCustomerOrderId || null : null,
    });
    setError('');
  };

  const reviewFloatTopUp = () => {
    if (!selectedKarigar) return;
    const weightMg = parseWeight(floatTopUpGrams);
    if (!weightMg) {
      setCommandPreview(null);
      setError('Enter a positive top-up weight in grams, such as 70.');
      return;
    }
    setCommandPreview({
      kind: 'topup',
      grams: weightMg / 1000,
      title: 'Gold top-up',
      karigarId: selectedKarigar.id,
      customerOrderId: null,
    });
    setError('');
  };

  const confirmCommand = () => {
    if (!commandPreview || !store) return;
    const commandKarigar = store.karigars.find((item) => item.id === commandPreview.karigarId);
    if (!commandKarigar) {
      setError('The selected karigar is no longer available.');
      return;
    }
    const drawMg = toMg(commandPreview.grams);
    if (!Number.isSafeInteger(drawMg) || drawMg <= 0
      || (commandPreview.kind === 'order' && !commandPreview.title.trim())) {
      setError('Enter a positive weight and item before confirming.');
      return;
    }
    const saved = perform(() => transactDemoStore((current) => {
      if (commandPreview.kind === 'topup') {
        const updated = {
          ...current,
          karigars: current.karigars.map((karigar) => karigar.id === commandKarigar.id
            ? { ...karigar, floatTotalMg: karigar.floatTotalMg + drawMg }
            : karigar),
        };
        const withActivity = appendDemoActivity(updated, {
          karigarId: commandKarigar.id,
          type: 'top-up',
          text: `Topped up the float by ${grams(drawMg)}.`,
        });
        return appendDemoActivity(withActivity, {
          karigarId: commandKarigar.id,
          type: 'notify',
          text: 'Karigar notified about the float top-up.',
        });
      }
      const untouched = getKarigarBalances(current, commandKarigar.id).untouchedMg;
      if (drawMg > untouched) throw new Error(`Only ${grams(untouched)} is untouched. This order cannot be issued.`);
      const order = makeOrder(
        commandKarigar.id,
        commandPreview.title,
        drawMg,
        commandPreview.customerOrderId,
        current.settings.defaultWastagePct,
      );
      const updated = {
        ...current,
        orders: [...current.orders, order],
        customerOrders: current.customerOrders.map((customerOrder) =>
          customerOrder.id === commandPreview.customerOrderId
            ? { ...customerOrder, status: 'with_karigar' as const }
            : customerOrder),
      };
      const withActivity = appendDemoActivity(updated, {
        karigarId: commandKarigar.id,
        orderId: order.id,
        type: 'issue',
        text: `Issued ${grams(drawMg)} for ${order.title}.`,
      });
      return appendDemoActivity(withActivity, {
        karigarId: commandKarigar.id,
        orderId: order.id,
        type: 'notify',
        text: 'Karigar notified about the new order.',
      });
    }));
    if (!saved) return;
    setNotice(commandPreview.kind === 'topup' ? 'Gold top-up added.' : 'Order issued. The new slip is live.');
    if (commandPreview.kind === 'topup') setFloatTopUpGrams('');
    setCommand('');
    setCommandPreview(null);
  };

  const submitWastage = (orderId: string) => {
    const mg = wastagePreviews[orderId];
    if (mg === undefined || mg === null) {
      setError('Enter wastage in grams or use the microphone, then review the preview.');
      return;
    }
    const saved = perform(() => transactDemoStore((current) => {
      const order = current.orders.find((item) => item.id === orderId);
      if (!order || (order.status !== 'open' && order.status !== 'disputed')) {
        throw new Error('This slip is locked and cannot accept a new report.');
      }
      const updated = {
        ...current,
        orders: current.orders.map((item) => item.id === orderId
          ? { ...item, status: 'reported' as const, reportedWasteMg: mg, disputeReason: null }
          : item),
      };
      const withActivity = appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId,
        type: 'report',
        text: `Reported ${grams(mg)} wastage for ${order.title}.`,
      });
      return appendDemoActivity(withActivity, {
        karigarId: order.karigarId,
        orderId,
        type: 'notify',
        text: 'Jeweller notified that the wastage report is ready.',
      });
    }));
    if (!saved) return;
    setNotice('Wastage report sent to the jeweller.');
    setWastagePreviews((current) => ({ ...current, [orderId]: null }));
    setReportFormOrderId('');
  };

  const flagOrder = (orderId: string, reason: string) => {
    const saved = perform(() => transactDemoStore((current) => {
      const order = current.orders.find((item) => item.id === orderId);
      if (!order || order.status === 'reported' || order.status === 'closed') {
        throw new Error('This slip is locked and cannot be disputed.');
      }
      const updated = {
        ...current,
        orders: current.orders.map((item) => item.id === orderId
          ? { ...item, status: 'disputed' as const, disputeReason: reason }
          : item),
      };
      const withActivity = appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId,
        type: 'dispute',
        text: `Flagged ${order.title}: ${reason}.`,
      });
      return appendDemoActivity(withActivity, {
        karigarId: order.karigarId,
        orderId,
        type: 'notify',
        text: 'Jeweller notified about the disputed slip.',
      });
    }));
    if (!saved) return;
    setReasonOrderId('');
    setNotice('Your concern is flagged for the jeweller. This slip is locked until it is rechecked.');
  };

  const closeOrder = (orderId: string) => {
    const saved = perform(() => transactDemoStore((current) => {
      const order = current.orders.find((item) => item.id === orderId);
      if (!order || order.status !== 'reported') throw new Error('This report is no longer pending.');
      const closedAt = new Date().toISOString();
      const orders = current.orders.map((item) => item.id === orderId
        ? { ...item, status: 'closed' as const, closedAt }
        : item);
      const customerOrders = current.customerOrders.map((customerOrder) => {
        if (customerOrder.id !== order.customerOrderId) return customerOrder;
        const remainingJobs = orders.some((item) =>
          item.customerOrderId === customerOrder.id && item.status !== 'closed');
        return remainingJobs ? customerOrder : { ...customerOrder, status: 'ready' as const };
      });
      const updated = {
        ...current,
        karigars: current.karigars.map((karigar) => karigar.id === order.karigarId
          ? { ...karigar, floatTotalMg: karigar.floatTotalMg - order.drawMg }
          : karigar),
        orders,
        customerOrders,
      };
      const withActivity = appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId,
        type: 'ack',
        text: `Acknowledged ${order.title} report and closed the order.`,
      });
      return appendDemoActivity(withActivity, {
        karigarId: order.karigarId,
        orderId,
        type: 'notify',
        text: 'Karigar notified that the report was acknowledged.',
      });
    }));
    if (saved) setNotice('Report acknowledged and order closed.');
  };

  const recheckOrder = (orderId: string) => {
    const saved = perform(() => transactDemoStore((current) => {
      const order = current.orders.find((item) => item.id === orderId);
      if (!order || order.status !== 'reported') throw new Error('This report is no longer pending.');
      const updated = {
        ...current,
        orders: current.orders.map((item) => item.id === orderId
          ? { ...item, status: 'disputed' as const }
          : item),
      };
      const withActivity = appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId,
        type: 'recheck',
        text: `Requested a recheck for ${order.title}.`,
      });
      return appendDemoActivity(withActivity, {
        karigarId: order.karigarId,
        orderId,
        type: 'notify',
        text: 'Karigar notified to recheck and resubmit the report.',
      });
    }));
    if (saved) setNotice('Sent back for the karigar to recheck and resubmit.');
  };

  const acknowledgeSlip = (orderId: string) => {
    perform(() => transactDemoStore((current) => {
      const order = current.orders.find((item) => item.id === orderId);
      if (!order || order.status === 'closed' || order.status === 'reported' || order.status === 'disputed') {
        throw new Error('This slip is locked and cannot be acknowledged.');
      }
      const updated = {
        ...current,
        orders: current.orders.map((item) => item.id === orderId
          ? { ...item, acknowledged: true }
          : item),
      };
      return appendDemoActivity(updated, {
        karigarId: order.karigarId,
        orderId,
        type: 'ack',
        text: `Karigar acknowledged the ${order.title} slip.`,
      });
    }));
  };

  if (!store) {
    return <main className="mx-auto max-w-2xl p-4"><p role="alert">{error || 'Loading shared demo ledger…'}</p></main>;
  }

  const lowFloatAlertCount = store.karigars.filter((karigar) =>
    getKarigarBalances(store, karigar.id).untouchedMg < toMg(lowFloatThresholdG)).length;
  const pageHeader = (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-gray-900 px-4 py-3 text-white shadow-sm">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-300">{user.name}</p>
        <h1 className="truncate font-black">{user.role === 'karigar' ? 'Karigar paper slip' : 'Jeweller portal'}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {user.role === 'jeweller' && (
          <button type="button" onClick={() => setScreen('dashboard')} aria-label="Open dashboard alerts"
            className="relative flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10">
            <Bell aria-hidden="true" size={20} />
          <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-xs font-black text-gray-950">{pendingReports.length + lowFloatAlertCount}</span>
          </button>
        )}
        {user.role === 'karigar' && (
          <button type="button" onClick={readKarigarPageAloud} aria-label="Read the whole screen aloud"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10">
            <Volume2 aria-hidden="true" size={20} />
          </button>
        )}
        <label className="sr-only" htmlFor="demo-language">Language</label>
        <select id="demo-language" aria-label="Language" value={language}
          onChange={(event) => onLanguageChange(event.target.value as LocaleCode)}
          className="min-h-11 max-w-28 rounded-lg border border-gray-400 bg-white px-2 font-bold text-gray-950">
          <option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option>
        </select>
        <button type="button" onClick={onLogout} aria-label="Log out"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/10">
          <LogOut aria-hidden="true" size={20} />
        </button>
      </div>
    </header>
  );

  const speechFeedback = (target: string) => {
    if (speechTarget !== target) return null;
    if (speechError) return <p role="alert" className="text-sm font-bold text-amber-900">{speechError} Try your keyboard mic (Win+H) if needed.</p>;
    if (isListening) return <p role="status" className="text-sm font-semibold">Listening… {transcript}</p>;
    return transcript ? <p role="status" className="text-sm font-semibold">{transcript}</p> : null;
  };

  const orderCard = (order: DemoOrder, karigarView: boolean) => {
    const thresholdMg = getOrderThresholdMg(order);
    const result = verdict(order);
    const customerOrder = store.customerOrders.find((item) => item.id === order.customerOrderId);
    const customer = store.customers.find((item) => item.id === customerOrder?.customerId);
    const locked = order.status === 'reported' || order.status === 'closed';
    const canReport = order.status === 'open' || order.status === 'disputed';
    return (
      <article key={order.id} className="space-y-3 rounded-2xl border-2 border-gray-800 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="break-words text-lg font-black">{order.title}</h3>
            <p className="text-sm text-gray-700">Drawn {grams(order.drawMg)} · Wastage threshold {order.allowedPct}% ({grams(thresholdMg)})</p>
            <p className="text-sm text-gray-600">Due {formatDate(order.dueDate)}</p>
            {customer && customerOrder && (
              <p className="mt-1 text-sm text-gray-700">
                Customer {customer.name} · {customer.phone} · {customer.city}
                <br />Customer order: {customerOrder.item} · expected {customerOrder.expectedWeightG} g
                · due {formatDate(customerOrder.dueDate)}
                · advance {formatINR(customerOrder.advanceINR)} · making {formatINR(customerOrder.makingINR)}
                · {customerOrder.status.replaceAll('_', ' ')}
              </p>
            )}
          </div>
          <button type="button" aria-label={`Read ${order.title} slip aloud`}
            onClick={() => {
              if (!('speechSynthesis' in window)) { setError('Audio reading is not available on this device.'); return; }
              const speech = new SpeechSynthesisUtterance(`${order.title}. Drawn ${grams(order.drawMg)}. Threshold ${grams(thresholdMg)}. Due ${formatDate(order.dueDate)}.`);
              speech.lang = speechLanguage(language);
              window.speechSynthesis.cancel();
              window.speechSynthesis.speak(speech);
            }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-blue-100 text-blue-950">
            <Volume2 aria-hidden="true" size={21} />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-bold">{order.status.toUpperCase()}</span>
          {order.isNew && <span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-black text-amber-950">NEW</span>}
          {order.disputeReason && <span className="text-sm font-bold text-red-800">Flag: {order.disputeReason}</span>}
          {result && <span className="text-sm font-bold">{grams(order.reportedWasteMg!)} · {result.label}{result.direction !== 'none' ? `, ${result.direction} ${grams(result.differenceMg)}` : ''}</span>}
        </div>
        {karigarView && order.status !== 'closed' && (
          <>
            <div className="flex gap-2">
              <button type="button" disabled={order.acknowledged || order.status === 'disputed' || locked}
                onClick={() => acknowledgeSlip(order.id)}
                className="min-h-11 flex-1 rounded-xl bg-green-700 px-3 font-black text-white disabled:opacity-50">
                {order.acknowledged ? 'OK ✓' : 'OK'}
              </button>
              <button type="button" disabled={locked}
                onClick={() => setReasonOrderId(reasonOrderId === order.id ? '' : order.id)}
                className="min-h-11 flex-1 rounded-xl border-2 border-red-700 px-3 font-bold text-red-800 disabled:opacity-50">
                Kuch galat hai
              </button>
            </div>
            {reasonOrderId === order.id && (
              <div className="flex flex-wrap gap-2" aria-label="Choose a reason">
                {['Weight mismatch', 'Wrong item', 'Due date', 'Other'].map((reason) => (
                  <button type="button" key={reason} onClick={() => flagOrder(order.id, reason)}
                    className="min-h-10 rounded-full border border-red-300 bg-red-50 px-3 text-sm font-bold text-red-900">{reason}</button>
                ))}
              </div>
            )}
          </>
        )}
        {karigarView && canReport && (
          <>
            <button type="button" aria-expanded={reportFormOrderId === order.id}
              onClick={() => setReportFormOrderId(reportFormOrderId === order.id ? '' : order.id)}
              className="min-h-12 w-full rounded-xl bg-amber-600 px-4 font-black text-white">
              Kaam ho gaya
            </button>
            {reportFormOrderId === order.id && (
              <div className="space-y-2 rounded-xl bg-gray-50 p-3">
                <label htmlFor={`wastage-${order.id}`} className="block text-sm font-bold">Actual wastage (g)</label>
                <div className="flex gap-2">
                  <input id={`wastage-${order.id}`} inputMode="decimal" value={wastageInputs[order.id] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setWastageInputs((current) => ({ ...current, [order.id]: value }));
                      setWastagePreviews((current) => ({ ...current, [order.id]: null }));
                    }}
                    placeholder="e.g. 1.5 g" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 px-3" />
                  <button type="button" disabled={isListening && speechTarget !== order.id}
                    onClick={() => listenFor(order.id)} aria-label="Speak wastage amount" aria-pressed={speechTarget === order.id && isListening}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-indigo-700 text-white disabled:opacity-50"><Mic aria-hidden="true" /></button>
                </div>
                {speechFeedback(order.id)}
                {(wastageInputs[order.id] ?? '').trim() && (
                  <button type="button" onClick={() => {
                    const raw = normalizeLooseNumbers(wastageInputs[order.id]).toLowerCase();
                    const number = parseWeight(raw, true, true)
                      ?? (/^\d+(?:\.\d+)?$/.test(raw.trim()) ? parseWeight(raw, false, true) : null);
                    if (number === null) { setError('Could not understand the wastage. Say an amount in grams.'); return; }
                    const relative = raw.match(/zyada|more|over|kam|less|under|ज़्यादा|ज्यादा|कम/i);
                    const actual = relative
                      ? getOrderThresholdMg(order) + (/\b(kam|less|under)\b|कम/i.test(relative[0]) ? -number : number)
                      : number;
                    if (!Number.isSafeInteger(actual)) { setError('Wastage is outside the supported weight range.'); return; }
                    if (actual < 0) { setError('Wastage cannot be below zero grams.'); return; }
                    setWastagePreviews((current) => ({ ...current, [order.id]: actual }));
                    setError('');
                  }} className="min-h-10 rounded-lg border border-indigo-300 bg-white px-3 text-sm font-bold text-indigo-900">Preview report</button>
                )}
                {wastagePreviews[order.id] !== undefined && wastagePreviews[order.id] !== null && (() => {
                  const wasteMg = wastagePreviews[order.id]!;
                  const diff = thresholdMg - wasteMg;
                  return (
                    <p className="rounded-lg bg-white p-3 text-sm font-bold">
                      Wastage {grams(wasteMg)} · threshold {grams(thresholdMg)} → {diff > 0
                        ? `KAM hua, bonus ${grams(diff)}`
                        : diff < 0 ? `ZYADA hua, over by ${grams(-diff)}` : 'BARABAR hua'}
                    </p>
                  );
                })()}
                <button type="button" disabled={wastagePreviews[order.id] === undefined || wastagePreviews[order.id] === null}
                  onClick={() => submitWastage(order.id)}
                  className="min-h-12 w-full rounded-xl bg-green-700 px-4 font-black text-white disabled:opacity-50">
                  Submit report
                </button>
                <button type="button" onClick={() => setReportFormOrderId('')}
                  className="min-h-10 rounded-lg px-3 text-sm font-bold text-gray-700">Cancel</button>
              </div>
            )}
          </>
        )}
        {!karigarView && result && <p className="text-sm font-bold">Wastage {grams(order.reportedWasteMg!)} vs threshold {grams(thresholdMg)} · {result.label}</p>}
      </article>
    );
  };

  const karigarPortal = currentKarigarId && (() => {
    const karigar = store.karigars.find((item) => item.id === currentKarigarId)!;
    const balances = getKarigarBalances(store, currentKarigarId);
    const orders = store.orders.filter((order) => order.karigarId === currentKarigarId);
    const closed = orders
      .filter((order) => order.status === 'closed')
      .sort((first, second) => Date.parse(second.closedAt!) - Date.parse(first.closedAt!));
    const bonusMg = closed.reduce((sum, order) => {
      const result = verdict(order);
      return sum + (result?.direction === 'bonus' ? result.differenceMg : 0);
    }, 0);
    const overMg = closed.reduce((sum, order) => {
      const result = verdict(order);
      return sum + (result?.direction === 'over' ? result.differenceMg : 0);
    }, 0);
    return (
      <>
        <section className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-3 text-center shadow-sm">
          {[['Total', balances.totalMg], ['In orders', balances.inOrdersMg], ['Untouched', balances.untouchedMg]].map(([label, amount]) => (
            <div key={String(label)} className="min-w-0 rounded-xl bg-amber-50 p-2">
              <p className="text-xs font-bold">{label}</p><p className="break-words text-lg font-black">{grams(Number(amount))}</p>
            </div>
          ))}
          <p className="col-span-3 text-left text-sm font-semibold">Bonus earned {grams(bonusMg)} · Over-wastage {grams(overMg)}</p>
        </section>
        {balances.untouchedMg < LOW_UNTOUCHED_WARNING_MG && <p role="status" className="rounded-xl bg-amber-200 p-3 font-bold text-amber-950">Less than 10 g untouched. Please check with your jeweller.</p>}
        <section className="space-y-3" aria-label="Open work slips">
          {orders.filter((order) => order.status !== 'closed').map((order) => orderCard(order, true))}
          {orders.every((order) => order.status === 'closed') && <p className="rounded-xl bg-white p-4">No open slips.</p>}
        </section>
        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-black">History · {closed.length}</summary>
          <div className="mt-3 space-y-3">
            {closed.map((order) => (
              <div key={order.id} className="rounded-xl bg-gray-50 p-3">
                {(() => {
                  const customerOrder = store.customerOrders.find((item) => item.id === order.customerOrderId);
                  const customer = store.customers.find((item) => item.id === customerOrder?.customerId);
                  const result = verdict(order);
                  const earnings = result?.direction === 'none'
                    ? 'no bonus or over-wastage'
                    : `${result?.direction} ${grams(result?.differenceMg ?? 0)}`;
                  return (
                    <>
                      <p className="font-bold">{order.title} · closed {formatDate(order.closedAt!)}</p>
                      <p className="text-sm">Drawn {grams(order.drawMg)} · wastage {grams(order.reportedWasteMg ?? 0)} · threshold {grams(getOrderThresholdMg(order))}</p>
                      {Date.parse(order.closedAt!) > Date.parse(order.dueDate) && (
                        <p className="text-sm text-amber-900">
                          Late by {Math.ceil((Date.parse(order.closedAt!) - Date.parse(order.dueDate)) / 86_400_000)} days · due {formatDate(order.dueDate)}
                        </p>
                      )}
                      <p className="text-sm font-semibold">
                        {result?.label} · {earnings} · Customer {customer?.name ?? 'Unknown'}
                      </p>
                    </>
                  );
                })()}
              </div>
            ))}
            {closed.length === 0 && <p className="text-sm text-gray-600">No closed orders yet.</p>}
          </div>
        </details>
        <details className="rounded-2xl bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-black">Activity</summary>
          <ul className="mt-3 space-y-2">
            {[...store.activities]
              .filter((activity) => activity.karigarId === currentKarigarId)
              .sort((first, second) => Date.parse(second.ts) - Date.parse(first.ts))
              .slice(0, 10)
              .map((activity) => (
                <li key={activity.id} className="rounded-lg bg-gray-50 p-3 text-sm">
                  <time dateTime={activity.ts}>{new Date(activity.ts).toLocaleString('en-GB')}</time>
                  <span className="ml-2 font-bold">{activity.type}</span> · {activity.text}
                </li>
              ))}
          </ul>
        </details>
        <p className="sr-only">{karigar.name}</p>
      </>
    );
  })();

  if (user.role === 'karigar') {
    return (
      <div className="min-h-dvh bg-stone-100 text-gray-950">
        {pageHeader}
        <main className="mx-auto max-w-2xl space-y-4 p-4 pb-8">
          <section className="space-y-2 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
            <label htmlFor="demo-jeweller" className="block text-sm font-bold text-gray-900">
              Select Jeweller
            </label>
            <select
              id="demo-jeweller"
              value={selectedDemoJeweller}
              onChange={(event) => setSelectedDemoJeweller(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 font-semibold"
            >
              <option value="" disabled>Select a Jeweller</option>
              {DEMO_JEWELLERS.map((jeweller) => <option key={jeweller} value={jeweller}>{jeweller}</option>)}
            </select>
          </section>
          {selectedDemoJeweller && (
            <>
              <p className="text-right text-xs font-bold uppercase tracking-wide text-gray-600">SYNTHETIC DEMO DATA</p>
              <p className="text-xs text-gray-600">
                Demo selector only. The same synthetic slips are shown for every Jeweller.
              </p>
              {error && <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-red-800">{error}</p>}
              {notice && <p role="status" className="rounded-xl bg-green-50 p-3 font-semibold text-green-900">{notice}</p>}
              {karigarPortal || <p role="alert" className="rounded-xl bg-red-50 p-4">This karigar is not in the demo ledger.</p>}
            </>
          )}
        </main>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'karigars', label: 'Karigars', icon: Users },
    { id: 'orders', label: 'Orders', icon: ClipboardList },
    { id: 'customers', label: 'Customers', icon: UserRound },
    { id: 'ledger', label: 'Ledger', icon: BookOpen },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;
  const screenTitle = navItems.find((item) => item.id === screen)?.label ?? 'Dashboard';
  const rateChanges = { 24: 85, 22: 78, 18: 64 };
  const rateSparkline = (purity: 24 | 22 | 18) => {
    const change = rateChanges[purity];
    const points = [0.42, 0.55, 0.49, 0.66, 0.58, 0.72, 0.68, 0.82].map((value, index) =>
      `${index * 12},${28 - value * 24}`);
    return (
      <svg viewBox="0 0 84 30" className="h-8 w-20" role="img" aria-label={`${purity} karat rate trend`}>
        <polyline points={points.join(' ')} fill="none" stroke="#b7791f" strokeWidth="2" />
        <text x="82" y="9" textAnchor="end" fontSize="7" fill="#166534">+₹{change}</text>
      </svg>
    );
  };
  const sortedKarigars = [...store.karigars].sort((first, second) => {
    const firstBalance = getKarigarBalances(store, first.id);
    const secondBalance = getKarigarBalances(store, second.id);
    const firstPending = store.orders.filter((order) => order.karigarId === first.id && order.status === 'reported').length;
    const secondPending = store.orders.filter((order) => order.karigarId === second.id && order.status === 'reported').length;
    if (karigarSort === 'untouched') return secondBalance.untouchedMg - firstBalance.untouchedMg;
    if (karigarSort === 'trust') return trustScore(second.id) - trustScore(first.id);
    if (karigarSort === 'pending') return secondPending - firstPending;
    return first.name.localeCompare(second.name);
  });
  const filteredOrders = [...store.orders]
    .filter((order) => {
      const { customerOrder, customer } = customerForOrder(order);
      const karigar = store.karigars.find((item) => item.id === order.karigarId);
      const search = `${order.title} ${karigar?.name ?? ''} ${customer?.name ?? ''} ${customerOrder?.item ?? ''}`.toLowerCase();
      const overdue = order.status !== 'closed' && nowMs > 0 && Date.parse(order.dueDate) < nowMs;
      return (orderStatusFilter === 'all' || order.status === orderStatusFilter)
        && (orderKarigarFilter === 'all' || order.karigarId === orderKarigarFilter)
        && (orderCustomerFilter === 'all' || customerOrder?.customerId === orderCustomerFilter)
        && (!overdueOnly || overdue)
        && search.includes(orderSearch.trim().toLowerCase());
    })
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
  const selectedOrder = store.orders.find((order) => order.id === selectedOrderId);
  const closedOrders = store.orders
    .filter((order) => order.status === 'closed')
    .sort((first, second) => Date.parse(second.closedAt!) - Date.parse(first.closedAt!));
  const dashboardAlerts: { label: string; orderId?: string; karigarId?: string; tone: string }[] = [
    ...pendingReports.map((order) => ({ label: `Pending report · ${store.karigars.find((item) => item.id === order.karigarId)?.name} · ${order.title}`, orderId: order.id, tone: 'amber' })),
    ...overdueOrders.map((order) => ({ label: `Overdue · ${store.karigars.find((item) => item.id === order.karigarId)?.name} · ${order.title}`, orderId: order.id, tone: 'red' })),
    ...disputedOrders.map((order) => ({ label: `Dispute · ${store.karigars.find((item) => item.id === order.karigarId)?.name} · ${order.title}`, orderId: order.id, tone: 'red' })),
    ...store.karigars.filter((karigar) => getKarigarBalances(store, karigar.id).untouchedMg < toMg(lowFloatThresholdG))
      .map((karigar) => ({ label: `Low float · ${karigar.name} has ${grams(getKarigarBalances(store, karigar.id).untouchedMg)} untouched`, karigarId: karigar.id, tone: 'amber' })),
    ...store.orders.filter((order) => order.reportedWasteMg !== null && order.reportedWasteMg > getOrderThresholdMg(order))
      .map((order) => ({ label: `Over-wastage · ${order.title} is ${grams((order.reportedWasteMg ?? 0) - getOrderThresholdMg(order))} over`, orderId: order.id, tone: 'red' })),
  ];
  const insights: { title: string; detail: string; action: string; onClick: () => void }[] = [];
  store.karigars.forEach((karigar) => {
    const balance = getKarigarBalances(store, karigar.id);
    const recent = closedOrders.filter((order) => order.karigarId === karigar.id).slice(0, 5);
    const underThreshold = recent.filter((order) => (order.reportedWasteMg ?? 0) < getOrderThresholdMg(order));
    const overThreshold = recent.filter((order) => (order.reportedWasteMg ?? 0) > getOrderThresholdMg(order));
    if (balance.untouchedMg < toMg(lowFloatThresholdG)) {
      insights.push({
        title: `${karigar.name} has ${grams(balance.untouchedMg)} untouched`,
        detail: 'A small top-up may prevent the next order from being blocked.',
        action: 'Top up 20 g',
        onClick: () => openKarigarDetail(karigar.id, 20),
      });
    }
    if (recent.length >= 2 && underThreshold.length === recent.length) {
      insights.push({
        title: `${karigar.name} stayed under threshold in the last ${recent.length} jobs`,
        detail: 'Consistent wastage performance; consider increasing the working float.',
        action: 'Raise float',
        onClick: () => openKarigarDetail(karigar.id, 20),
      });
    }
    if (recent.length >= 3 && overThreshold.length >= 3) {
      insights.push({
        title: `${karigar.name} exceeded threshold in ${overThreshold.length} of the last ${recent.length}`,
        detail: 'Review recent reports and discuss the wastage trend.',
        action: 'Open',
        onClick: () => openKarigarDetail(karigar.id),
      });
    }
  });

  const totalInOrdersMg = activeOrders.reduce((sum, order) => sum + order.drawMg, 0);
  const goldValue = totalFloatMg / 1000 * demoRates[24];
  const weeklyClosures = Array.from({ length: 6 }, (_, index) => {
    const start = new Date();
    start.setDate(start.getDate() - (5 - index) * 7 - start.getDay());
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {
      label: `${start.getDate()} ${start.toLocaleDateString('en-IN', { month: 'short' })}`,
      count: closedOrders.filter((order) => {
        const closedAt = Date.parse(order.closedAt!);
        return closedAt >= start.getTime() && closedAt < end.getTime();
      }).length,
    };
  });

  const dashboard = (
    <div className="space-y-5">
      <section aria-label="Demo gold rates" className="grid gap-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        {([24, 22, 18] as const).map((purity) => (
          <label key={purity} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2">
            <span className="text-xs font-black uppercase tracking-wide">{purity}K demo rate</span>
            <span className="flex items-center gap-2">
              {rateSparkline(purity)}
              <span className="text-sm font-bold">₹/g</span>
              <input aria-label={`${purity} karat demo rate in rupees per gram`} type="number" min="1" step="1"
                value={demoRates[purity]} onChange={(event) => updateDemoRate(purity, event.target.value)}
                className="w-24 rounded-md border border-amber-300 bg-white px-2 py-1 text-right font-black" />
            </span>
          </label>
        ))}
        <p className="sm:col-span-3 text-right text-xs text-gray-600">Editable demo rates · Change vs yesterday shown in sparkline · Last updated {formatDate(rateLastUpdated)}</p>
      </section>

      <section aria-label="Key performance indicators" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Gold with karigars', value: grams(totalFloatMg), detail: formatINR(goldValue), screen: 'karigars' as const },
          { label: 'Open orders', value: String(activeOrders.length), detail: `${grams(totalInOrdersMg)} currently allocated`, screen: 'orders' as const },
          { label: 'Pending reports', value: String(pendingReports.length), detail: 'Awaiting acknowledgement', screen: 'orders' as const, status: 'reported' },
          { label: 'Overdue', value: String(overdueOrders.length), detail: 'Open past due date', screen: 'orders' as const, overdue: true },
          { label: 'Disputes', value: String(disputedOrders.length), detail: 'Needs review', screen: 'orders' as const, status: 'disputed' },
          { label: 'Wastage this month', value: `${monthWastagePct.toFixed(1)}%`, detail: `Allowed ${monthAllowedPct.toFixed(1)}%`, screen: 'orders' as const },
          { label: 'Bonus this month', value: grams(monthBonusMg), detail: 'Below-threshold bonus', screen: 'ledger' as const },
        ].map((kpi) => (
          <button key={kpi.label} type="button" onClick={() => {
            setScreen(kpi.screen);
            setSelectedOrderId('');
            setOrderKarigarFilter('all');
            setOrderCustomerFilter('all');
            setOrderSearch('');
            setOrderStatusFilter('status' in kpi && kpi.status ? kpi.status : 'all');
            setOverdueOnly('overdue' in kpi && Boolean(kpi.overdue));
          }} className="min-h-28 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-400">
            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{kpi.label}</span>
            <strong className="mt-2 block text-2xl font-black">{kpi.value}</strong>
            <span className="mt-1 block text-sm text-gray-600">{kpi.detail}</span>
          </button>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_1.9fr]">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div><h2 className="font-black">Alerts</h2><p className="text-xs text-gray-500">Computed from live demo data</p></div>
            <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-black text-red-800">{dashboardAlerts.length}</span>
          </div>
          <div className="max-h-64 space-y-2 overflow-auto">
            {dashboardAlerts.map((alert, index) => (
              <button key={`${alert.label}-${index}`} type="button" onClick={() => {
                if (alert.orderId) openOrderInDrawer(alert.orderId);
                else if (alert.karigarId) openKarigarDetail(alert.karigarId);
              }} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold ${alert.tone === 'red' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-950'}`}>
                {alert.label} <span aria-hidden="true">→</span>
              </button>
            ))}
            {dashboardAlerts.length === 0 && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">No active alerts.</p>}
          </div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3"><h2 className="font-black">Agent insights</h2><p className="text-xs text-gray-500">Rule-based suggestions from recent history</p></div>
          <div className="grid gap-2 md:grid-cols-2">
            {insights.map((insight) => (
              <div key={insight.title} className="flex items-center justify-between gap-3 rounded-xl bg-indigo-50 p-3">
                <div><p className="text-sm font-bold">{insight.title}</p><p className="mt-1 text-xs text-gray-700">{insight.detail}</p></div>
                <button type="button" onClick={insight.onClick} className="shrink-0 rounded-lg bg-indigo-800 px-3 py-2 text-xs font-black text-white">{insight.action}</button>
              </div>
            ))}
            {insights.length === 0 && <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">More closed orders are needed for recommendations.</p>}
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-2">
          <h2 className="font-black">Wastage by karigar</h2>
          <p className="text-xs text-gray-500">Closed-order wastage as % of draw weight · dashed line is allowed threshold</p>
          <svg viewBox="0 0 560 220" className="mt-3 h-56 w-full" role="img" aria-label="Wastage percentage by karigar compared with the ten percent threshold">
            <line x1="38" y1="170" x2="545" y2="170" stroke="#9ca3af" />
            <line x1="38" y1="90" x2="545" y2="90" stroke="#dc2626" strokeDasharray="5 4" />
            <text x="4" y="94" fontSize="10" fill="#991b1b">10%</text>
            {store.karigars.map((karigar, index) => {
              const orders = closedOrders.filter((order) => order.karigarId === karigar.id);
              const draw = orders.reduce((sum, order) => sum + order.drawMg, 0);
              const waste = orders.reduce((sum, order) => sum + (order.reportedWasteMg ?? 0), 0);
              const pct = draw ? waste / draw * 100 : 0;
              const barHeight = Math.min(120, pct / 15 * 120);
              const x = 86 + index * 120;
              return (
                <g key={karigar.id}>
                  <rect x={x} y={170 - barHeight} width="44" height={barHeight} rx="4" fill="#c59037" />
                  <text x={x + 22} y="190" textAnchor="middle" fontSize="11" fill="#374151">{karigar.name}</text>
                  <text x={x + 22} y={160 - barHeight} textAnchor="middle" fontSize="10" fill="#111827">{pct.toFixed(1)}%</text>
                  <circle cx={x + 22} cy="90" r="4" fill="#dc2626" />
                </g>
              );
            })}
          </svg>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-black">Gold out vs untouched</h2>
          <p className="text-xs text-gray-500">Current float allocation, grams</p>
          <div className="mt-4 space-y-4">
            {store.karigars.map((karigar) => {
              const balance = getKarigarBalances(store, karigar.id);
              const total = Math.max(balance.totalMg, 1);
              return (
                <div key={karigar.id}>
                  <div className="mb-1 flex justify-between text-xs"><b>{karigar.name}</b><span>{grams(balance.inOrdersMg)} / {grams(balance.untouchedMg)}</span></div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-gray-100" aria-label={`${karigar.name}: ${grams(balance.inOrdersMg)} in orders, ${grams(balance.untouchedMg)} untouched`}>
                    <span className="bg-indigo-700" style={{ width: `${balance.inOrdersMg / total * 100}%` }} />
                    <span className="bg-amber-400" style={{ width: `${balance.untouchedMg / total * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex gap-4 text-xs"><span><i className="mr-1 inline-block h-2 w-2 bg-indigo-700" />In orders</span><span><i className="mr-1 inline-block h-2 w-2 bg-amber-400" />Untouched</span></div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="font-black">Orders closed per week</h2>
          <p className="text-xs text-gray-500">Last six weeks</p>
          <svg viewBox="0 0 380 160" className="mt-3 h-40 w-full" role="img" aria-label="Number of orders closed each week">
            <line x1="20" y1="125" x2="365" y2="125" stroke="#9ca3af" />
            {weeklyClosures.map((week, index) => {
              const max = Math.max(1, ...weeklyClosures.map((item) => item.count));
              const height = week.count / max * 95;
              const x = 32 + index * 56;
              return (
                <g key={week.label}>
                  <rect x={x} y={125 - height} width="28" height={height} rx="3" fill="#4338ca" />
                  <text x={x + 14} y="143" textAnchor="middle" fontSize="8" fill="#4b5563">{week.label}</text>
                  <text x={x + 14} y={119 - height} textAnchor="middle" fontSize="9" fill="#111827">{week.count}</text>
                </g>
              );
            })}
          </svg>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h2 className="font-black">What-if gold rate</h2><p className="text-xs text-gray-500">Projected value of the current {grams(totalFloatMg)} float at 24K demo rate</p></div>
            <strong className="text-lg">{formatINR(totalFloatMg / 1000 * (demoRates[24] + whatIfRateDelta))}</strong>
          </div>
          <input aria-label="Change demo gold rate for what-if calculation" type="range" min="-1000" max="1000" step="50"
            value={whatIfRateDelta} onChange={(event) => setWhatIfRateDelta(Number(event.target.value))}
            className="mt-4 w-full accent-amber-700" />
          <div className="flex justify-between text-xs text-gray-600"><span>−₹1,000/g</span><span>Rate change {whatIfRateDelta >= 0 ? '+' : ''}{formatINR(whatIfRateDelta)}/g · float value change {formatINR(totalFloatMg / 1000 * whatIfRateDelta)}</span><span>+₹1,000/g</span></div>
        </article>
      </section>
    </div>
  );

  const karigarDirectory = (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 p-4">
        <div><h2 className="font-black">Karigar float & trust</h2><p className="text-xs text-gray-500">Select a row to open the order book and activity trail.</p></div>
        <span className="text-xs text-gray-500">Low float alert below {lowFloatThresholdG} g</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="p-3"><button onClick={() => setKarigarSort('name')}>Karigar ↕</button></th>
              <th className="p-3">Total / in orders / untouched</th>
              <th className="p-3"><button onClick={() => setKarigarSort('untouched')}>Float gauge ↕</button></th>
              <th className="p-3"><button onClick={() => setKarigarSort('trust')}>Trust ↕</button></th>
              <th className="p-3"><button onClick={() => setKarigarSort('pending')}>Pending ↕</button></th>
              <th className="p-3">Flags</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedKarigars.map((karigar) => {
              const balance = getKarigarBalances(store, karigar.id);
              const pending = store.orders.filter((order) => order.karigarId === karigar.id && order.status === 'reported').length;
              const flagged = store.orders.some((order) => order.karigarId === karigar.id && order.status === 'disputed');
              const ratio = balance.totalMg ? balance.inOrdersMg / balance.totalMg * 100 : 0;
              const low = balance.untouchedMg < toMg(lowFloatThresholdG);
              return (
                <tr key={karigar.id} onClick={() => openKarigarDetail(karigar.id)} className="cursor-pointer border-t border-gray-100 hover:bg-amber-50">
                  <td className="p-3 font-bold">{karigar.name}</td>
                  <td className="whitespace-nowrap p-3">{grams(balance.totalMg)} / {grams(balance.inOrdersMg)} / {grams(balance.untouchedMg)}</td>
                  <td className="p-3">
                    <div className="h-2 w-36 overflow-hidden rounded-full bg-amber-300"><span className="block h-full bg-indigo-700" style={{ width: `${ratio}%` }} /></div>
                    <span className="text-xs text-gray-500">{ratio.toFixed(0)}% allocated</span>
                  </td>
                  <td className="p-3"><span className="font-black">{trustScore(karigar.id)}</span><span className="text-gray-500"> / 100</span></td>
                  <td className="p-3">{pending}</td>
                  <td className="p-3">{low && <span className="mr-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-950">LOW FLOAT</span>}{flagged && <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-900">DISPUTE</span>}</td>
                  <td className="p-3"><button type="button" onClick={(event) => { event.stopPropagation(); openKarigarDetail(karigar.id); }} className="whitespace-nowrap rounded-lg bg-indigo-800 px-3 py-2 text-xs font-bold text-white">Top up float</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  const karigarDetail = selectedKarigar ? (() => {
    const balance = getKarigarBalances(store, selectedKarigar.id);
    const karigarOrders = store.orders.filter((order) => order.karigarId === selectedKarigar.id);
    const activities = store.activities.filter((item) => item.karigarId === selectedKarigar.id)
      .sort((first, second) => Date.parse(second.ts) - Date.parse(first.ts));
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setScreen('karigars')} className="text-sm font-bold text-indigo-800">← All karigars</button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><h2 className="text-2xl font-black">{selectedKarigar.name}</h2><p className="text-sm text-gray-600">Trust score {trustScore(selectedKarigar.id)} / 100 · {karigarOrders.filter((order) => order.status === 'reported').length} pending reports</p></div>
          {karigarOrders.some((order) => order.status === 'disputed') && <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-900">DISPUTE FLAG</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Total', balance.totalMg],
            ['In orders', balance.inOrdersMg],
            ['Untouched', balance.untouchedMg],
          ].map(([label, amount]) => (
            <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-xs font-bold uppercase text-gray-500">{label}</p><p className="text-xl font-black">{grams(Number(amount))}</p>
            </div>
          ))}
        </div>
        <section className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <h3 className="font-black">Top up {selectedKarigar.name}'s float</h3>
          <p className="text-sm text-gray-700">Add gold to the float for future work. The available balance updates after you confirm.</p>
          <div className="flex flex-wrap gap-2">
            <label htmlFor="float-top-up-grams" className="sr-only">Top-up weight in grams</label>
            <input id="float-top-up-grams" type="number" min="0.001" step="0.001" inputMode="decimal" value={floatTopUpGrams}
              onChange={(event) => { setFloatTopUpGrams(event.target.value); setCommandPreview(null); }}
              placeholder="e.g. 70 g" className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3" />
            <button type="button" onClick={reviewFloatTopUp} className="min-h-11 rounded-lg bg-indigo-800 px-4 font-bold text-white">Review top-up</button>
          </div>
          {commandPreview?.kind === 'topup' && (
            <article className="space-y-2 rounded-xl border border-indigo-200 bg-white p-3">
              <p className="font-bold">Add {grams(toMg(commandPreview.grams))} to {selectedKarigar.name}'s float?</p>
              <p className="text-sm">Total gold and gold available for future work will increase.</p>
              <button type="button" onClick={confirmCommand} className="min-h-10 w-full rounded-lg bg-green-700 font-black text-white">Confirm top-up</button>
            </article>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="font-black">Order book</h3>
          {karigarOrders.filter((order) => order.status !== 'closed').map((order) => (
            <div key={order.id} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
              {orderCard(order, false)}
              {order.status === 'reported' && <div className="flex gap-2"><button type="button" onClick={() => closeOrder(order.id)} className="min-h-10 flex-1 rounded-lg bg-green-700 font-bold text-white">Acknowledge</button><button type="button" onClick={() => recheckOrder(order.id)} className="min-h-10 flex-1 rounded-lg border border-amber-700 font-bold text-amber-950">Recheck</button></div>}
              <button type="button" onClick={() => openOrderInDrawer(order.id)} className="text-xs font-bold text-indigo-800">Open order detail →</button>
            </div>
          ))}
          {karigarOrders.every((order) => order.status === 'closed') && <p className="rounded-xl bg-white p-3 text-sm text-gray-600">No open orders.</p>}
        </section>
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="font-black">Quick work entry</h3>
          <label htmlFor="customer-order-link" className="block text-sm font-bold">Link customer order (optional)
            <select id="customer-order-link" value={selectedCustomerOrderId} onChange={(event) => setSelectedCustomerOrderId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3">
              <option value="">Match item automatically</option>
              {store.customerOrders.map((customerOrder) => {
                const customer = store.customers.find((item) => item.id === customerOrder.customerId);
                return <option key={customerOrder.id} value={customerOrder.id}>{customerOrder.item} · {customer?.name} · {customerOrder.status.replaceAll('_', ' ')}</option>;
              })}
            </select>
          </label>
          <label htmlFor="gold-command" className="block text-sm font-bold">Bolo ya likho: karigar aur kaam likho</label>
          <div className="flex gap-2">
            <input ref={commandInputRef} autoFocus id="gold-command" value={command} onChange={(event) => { setCommand(event.target.value); setCommandPreview(null); }} className="min-h-16 min-w-0 flex-1 rounded-xl border-2 border-indigo-400 px-4 text-lg font-semibold shadow-sm" placeholder="Bolo ya likho: Ramesh ko 8 gram rings do" />
            <button type="button" disabled={isListening && speechTarget !== 'command'} onClick={() => listenFor('command')} aria-label="Speak order or top-up" aria-pressed={speechTarget === 'command' && isListening} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-indigo-800 text-white disabled:opacity-50"><Mic aria-hidden="true" /></button>
          </div>
          {speechFeedback('command')}
          <div className="flex flex-wrap gap-2" aria-label="Example commands">
            {['Ramesh ko 8 gram rings do', 'Suresh ko 5 g chain do', 'Ramesh ko 10 gram aur do'].map((example) => <button key={example} type="button" onClick={() => { setCommand(example); setCommandPreview(null); }} className="min-h-9 rounded-full border border-indigo-200 bg-indigo-50 px-3 text-xs font-bold text-indigo-900">{example}</button>)}
          </div>
          <button type="button" onClick={handleCommandReview} className="min-h-10 rounded-lg bg-gray-900 px-4 font-bold text-white">Review</button>
          {commandPreview && <article className="space-y-3 rounded-xl bg-indigo-50 p-3">
            <p className="font-bold">Confirm {commandPreview.kind === 'topup' ? 'top-up' : 'order'}</p>
            <label className="block text-sm font-semibold">Karigar
              <select value={commandPreview.karigarId} onChange={(event) => setCommandPreview({ ...commandPreview, karigarId: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3">
                {store.karigars.map((karigar) => <option key={karigar.id} value={karigar.id}>{karigar.name}</option>)}
              </select>
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm font-semibold">Grams<input type="number" min="0.001" step="0.001" value={commandPreview.grams} onChange={(event) => setCommandPreview({ ...commandPreview, grams: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3" /></label>
              <label className="text-sm font-semibold">Item<input value={commandPreview.title} onChange={(event) => setCommandPreview({ ...commandPreview, title: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3" /></label>
            </div>
            {commandPreview.customerOrderId && (() => {
              const customerOrder = store.customerOrders.find((item) => item.id === commandPreview.customerOrderId);
              const customer = store.customers.find((item) => item.id === customerOrder?.customerId);
              return customer && customerOrder ? <p className="text-sm">Customer: {customer.name} · {customerOrder.item}</p> : null;
            })()}
            <p className="text-sm">{commandPreview.kind === 'topup' ? 'Float total and untouched gold increase.' : 'Gold will move from untouched to in orders.'}</p>
            <button type="button" disabled={!Number.isFinite(commandPreview.grams) || toMg(commandPreview.grams) <= 0 || (commandPreview.kind === 'order' && !commandPreview.title.trim())} onClick={confirmCommand} className="min-h-10 w-full rounded-lg bg-green-700 font-black text-white disabled:opacity-50">Confirm {commandPreview.kind === 'topup' ? 'top-up' : 'order'}</button>
          </article>}
        </section>
        <section>
          <h3 className="mb-2 font-black">Closed history</h3>
          <div className="space-y-2">{karigarOrders.filter((order) => order.status === 'closed').sort((first, second) => Date.parse(second.closedAt!) - Date.parse(first.closedAt!)).map((order) => orderCard(order, false))}</div>
        </section>
        <section className="rounded-2xl border border-gray-200 bg-white p-4">
          <h3 className="mb-3 font-black">Activity timeline</h3>
          <ol className="space-y-2">{activities.map((activity) => <li key={activity.id} className="border-l-2 border-amber-400 pl-3 text-sm"><time className="text-xs text-gray-500">{formatDate(activity.ts)}</time><p><b>{activity.type}</b> · {activity.text}</p></li>)}</ol>
        </section>
      </div>
    );
  })() : <p role="status" className="rounded-xl bg-white p-4">Select a karigar to open the detail view.</p>;

  const ordersView = (
    <div className="space-y-4">
      <section className="grid gap-2 rounded-2xl border border-gray-200 bg-white p-3 md:grid-cols-5">
        <label className="relative md:col-span-2"><span className="sr-only">Search orders</span><Search className="absolute left-3 top-3 h-4 w-4 text-gray-500" /><input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search title, karigar, customer…" className="min-h-10 w-full rounded-lg border border-gray-300 pl-9 pr-3" /></label>
        <label className="sr-only" htmlFor="order-status-filter">Filter by status</label><select id="order-status-filter" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)} className="min-h-10 rounded-lg border border-gray-300 px-2"><option value="all">All statuses</option><option value="open">Open</option><option value="reported">Reported</option><option value="disputed">Disputed</option><option value="closed">Closed</option></select>
        <label className="sr-only" htmlFor="order-karigar-filter">Filter by karigar</label><select id="order-karigar-filter" value={orderKarigarFilter} onChange={(event) => setOrderKarigarFilter(event.target.value)} className="min-h-10 rounded-lg border border-gray-300 px-2"><option value="all">All karigars</option>{store.karigars.map((karigar) => <option key={karigar.id} value={karigar.id}>{karigar.name}</option>)}</select>
        <label className="sr-only" htmlFor="order-customer-filter">Filter by customer</label><select id="order-customer-filter" value={orderCustomerFilter} onChange={(event) => setOrderCustomerFilter(event.target.value)} className="min-h-10 rounded-lg border border-gray-300 px-2"><option value="all">All customers</option>{store.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm font-semibold md:col-span-5"><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />Overdue only</label>
      </section>
      <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600"><tr><th className="p-3">Order</th><th className="p-3">Karigar</th><th className="p-3">Customer</th><th className="p-3">Draw / waste / threshold</th><th className="p-3">Due</th><th className="p-3">Status</th></tr></thead>
          <tbody>{filteredOrders.map((order) => {
            const { customer } = customerForOrder(order);
            const karigar = store.karigars.find((item) => item.id === order.karigarId);
            const isLate = order.status !== 'closed' && nowMs > 0 && Date.parse(order.dueDate) < nowMs;
            const result = verdict(order);
            return <tr key={order.id} onClick={() => setSelectedOrderId(order.id)} className="cursor-pointer border-t border-gray-100 hover:bg-amber-50">
              <td className="p-3 font-bold">{order.title}</td><td className="p-3">{karigar?.name}</td><td className="p-3">{customer?.name ?? '—'}</td>
              <td className="whitespace-nowrap p-3">{grams(order.drawMg)} / {order.reportedWasteMg === null ? '—' : `${grams(order.reportedWasteMg)} ${result?.label ?? ''}`} / {grams(getOrderThresholdMg(order))}</td>
              <td className="p-3">{formatDate(order.dueDate)} {isLate && <span className="font-bold text-red-700">OVERDUE</span>}</td>
              <td className="p-3"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold">{order.status}</span></td>
            </tr>;
          })}</tbody>
        </table>
        {filteredOrders.length === 0 && <p className="p-5 text-sm text-gray-600">No orders match these filters.</p>}
      </section>
    </div>
  );

  const customersView = (
    <div className="space-y-4">
      <form onSubmit={createCustomerOrder} className="grid gap-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-sm sm:grid-cols-2">
        <h2 className="font-black sm:col-span-2">New customer order</h2>
        <label className="text-sm font-semibold">Customer
          <select required value={customerForm.customerId} onChange={(event) => setCustomerForm({ ...customerForm, customerId: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3">
            <option value="">Choose customer</option>{store.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">Item
          <input required value={customerForm.item} onChange={(event) => setCustomerForm({ ...customerForm, item: event.target.value })} placeholder="Chain, rings, bangles…" className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3" />
        </label>
        <label className="text-sm font-semibold">Expected weight (g)
          <input required min="0.001" step="0.001" type="number" value={customerForm.expectedWeightG} onChange={(event) => setCustomerForm({ ...customerForm, expectedWeightG: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3" />
        </label>
        <label className="text-sm font-semibold">Due date
          <input required type="date" value={customerForm.dueDate} onChange={(event) => setCustomerForm({ ...customerForm, dueDate: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3" />
        </label>
        <label className="text-sm font-semibold">Advance (₹)
          <input required min="0" step="1" type="number" value={customerForm.advanceINR} onChange={(event) => setCustomerForm({ ...customerForm, advanceINR: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3" />
        </label>
        <label className="text-sm font-semibold">Making charges (₹)
          <input required min="0" step="1" type="number" value={customerForm.makingINR} onChange={(event) => setCustomerForm({ ...customerForm, makingINR: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-indigo-800 px-4 font-bold text-white sm:col-span-2">Create customer order</button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <h2 className="border-b border-gray-200 p-4 font-black">Customers</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600"><tr><th className="p-3">Name</th><th className="p-3">Phone</th><th className="p-3">City</th><th className="p-3">Open orders</th><th className="p-3">Open value</th></tr></thead>
            <tbody>{store.customers.map((customer) => {
              const orders = store.customerOrders.filter((order) => order.customerId === customer.id);
              const openOrders = orders.filter((order) => order.status !== 'delivered');
              const openValue = openOrders.reduce((sum, order) =>
                sum + estimatedCustomerValue(order.expectedWeightG, order.makingINR, demoRates[22]), 0);
              return <tr key={customer.id} className="border-t border-gray-100 align-top">
                <td className="p-3 font-bold">{customer.name}<div className="mt-2 space-y-2">{orders.map((order) => <button key={order.id} type="button" onClick={() => document.getElementById(`customer-order-${order.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="block text-left text-xs font-bold text-indigo-800">{order.item} · {order.status.replaceAll('_', ' ')}</button>)}</div></td>
                <td className="p-3">{customer.phone}</td><td className="p-3">{customer.city}</td><td className="p-3">{openOrders.length}</td><td className="p-3">{formatINR(openValue)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {store.customers.map((customer) => {
          const customerOrders = store.customerOrders.filter((order) => order.customerId === customer.id);
          return <article key={customer.id} className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2"><div><h2 className="font-black">{customer.name}</h2><p className="text-sm text-gray-600">{customer.phone} · {customer.city}</p></div><span className="text-xs font-bold text-gray-500">{customerOrders.filter((order) => order.status !== 'delivered').length} open · {customerOrders.length} total</span></div>
            {customerOrders.map((customerOrder) => {
              const linked = store.orders.filter((order) => order.customerOrderId === customerOrder.id);
              const latestClosed = linked.filter((order) => order.status === 'closed').sort((first, second) => Date.parse(second.closedAt!) - Date.parse(first.closedAt!))[0];
              const result = latestClosed ? verdict(latestClosed) : null;
              const estimatedTotal = estimatedCustomerValue(
                customerOrder.expectedWeightG,
                customerOrder.makingINR,
                demoRates[22],
              );
              const remaining = Math.max(0, estimatedTotal - customerOrder.advanceINR);
              const ready = customerOrder.status === 'ready';
              const hasUpdateForLatest = Boolean(
                latestClosed && customerOrder.customerUpdate?.orderId === latestClosed.id,
              );
              const assignment = assignmentInputs[customerOrder.id] ?? { karigarId: '', grams: '' };
              return <div id={`customer-order-${customerOrder.id}`} key={customerOrder.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold">{customerOrder.item}</p><p className="text-xs text-gray-600">Due {formatDate(customerOrder.dueDate)} · {customerOrder.status.replaceAll('_', ' ')}</p></div><span className={`rounded-full px-2 py-1 text-xs font-bold ${ready || customerOrder.status === 'delivered' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-950'}`}>{customerOrder.status.replaceAll('_', ' ')}</span></div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><span>Expected {customerOrder.expectedWeightG} g</span><span>Estimate {formatINR(estimatedTotal)}</span><span>Advance {formatINR(customerOrder.advanceINR)}</span><span>Balance {formatINR(remaining)}</span></div>
                {latestClosed && <p className="mt-2 text-sm font-semibold">Work acknowledged {formatDate(latestClosed.closedAt!)} · wastage {grams(latestClosed.reportedWasteMg ?? 0)} vs {grams(getOrderThresholdMg(latestClosed))} threshold · {result?.label}</p>}
                {customerOrder.customerUpdate && <p role="status" className="mt-2 rounded-lg bg-green-50 p-2 text-sm text-green-900">{customerOrder.customerUpdate.text}</p>}
                {customerOrder.status === 'received' && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_auto]">
                    <label className="text-xs font-bold">Assign to karigar
                      <select value={assignment.karigarId} onChange={(event) => setAssignmentInputs((current) => ({ ...current, [customerOrder.id]: { ...assignment, karigarId: event.target.value } }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2">
                        <option value="">Choose karigar</option>{store.karigars.map((karigar) => <option key={karigar.id} value={karigar.id}>{karigar.name}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold">Grams
                      <input type="number" min="0.001" step="0.001" value={assignment.grams} onChange={(event) => setAssignmentInputs((current) => ({ ...current, [customerOrder.id]: { ...assignment, grams: event.target.value } }))} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-2" />
                    </label>
                    <button type="button" onClick={() => assignCustomerOrder(customerOrder.id)} className="mt-auto min-h-10 rounded-lg bg-indigo-800 px-3 text-sm font-bold text-white">Assign</button>
                  </div>
                )}
                {latestClosed && customerOrder.status !== 'delivered' && <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={hasUpdateForLatest} onClick={() => updateCustomer(customerOrder.id, latestClosed.id)} className="min-h-10 rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
                    {hasUpdateForLatest ? 'Customer updated (demo)' : 'Update customer'}
                  </button>
                  {ready && <button type="button" onClick={() => deliverCustomerOrder(customerOrder.id)} className="min-h-10 rounded-lg border border-gray-400 bg-white px-3 text-sm font-bold">Mark delivered</button>}
                </div>}
                {customerOrder.status === 'delivered' && <p className="mt-2 text-xs text-gray-600">Delivered</p>}
              </div>;
            })}
          </article>;
        })}
      </div>
    </div>
  );

  const filteredActivities = [...store.activities]
    .filter((activity) => (ledgerKarigarFilter === 'all' || activity.karigarId === ledgerKarigarFilter)
      && (ledgerTypeFilter === 'all' || activity.type === ledgerTypeFilter)
      && (!ledgerFrom || Date.parse(activity.ts) >= Date.parse(`${ledgerFrom}T00:00:00`))
      && (!ledgerTo || Date.parse(activity.ts) < Date.parse(`${ledgerTo}T00:00:00`) + 86_400_000))
    .sort((first, second) => Date.parse(second.ts) - Date.parse(first.ts));
  const statementKarigar = store.karigars.find((item) => item.id === statementKarigarId);
  const statementOrders = statementKarigar
    ? store.orders.filter((order) => order.karigarId === statementKarigar.id)
    : [];
  const statementBalance = statementKarigar ? getKarigarBalances(store, statementKarigar.id) : null;
  const statementIssuedMg = statementOrders.reduce((sum, order) => sum + order.drawMg, 0);
  const statementWastageMg = statementOrders.reduce((sum, order) => sum + (order.reportedWasteMg ?? 0), 0);
  const statementBonusMg = statementOrders.reduce((sum, order) => {
    if (order.status !== 'closed') return sum;
    const result = verdict(order);
    return sum + (result?.direction === 'bonus' ? result.differenceMg : 0);
  }, 0);
  const statementCsv = () => {
    if (!statementKarigar || !statementBalance) return;
    const rows = [
      ['Karigar', 'Issued (g)', 'Orders', 'Wastage (g)', 'Bonus (g)', 'Balance in orders (g)'],
      [statementKarigar.name, grams(statementIssuedMg), String(statementOrders.length), grams(statementWastageMg), grams(statementBonusMg), grams(statementBalance.inOrdersMg)],
    ];
    const csv = rows.map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${statementKarigar.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-weight-statement.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const ledgerView = (
    <div className="space-y-4">
      <section className="grid gap-2 rounded-2xl border border-gray-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold">Karigar<select value={ledgerKarigarFilter} onChange={(event) => setLedgerKarigarFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2"><option value="all">All karigars</option>{store.karigars.map((karigar) => <option key={karigar.id} value={karigar.id}>{karigar.name}</option>)}</select></label>
        <label className="text-xs font-bold">Activity type<select value={ledgerTypeFilter} onChange={(event) => setLedgerTypeFilter(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-2"><option value="all">All types</option>{Array.from(new Set(store.activities.map((activity) => activity.type))).sort().map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <label className="text-xs font-bold">From<input type="date" value={ledgerFrom} onChange={(event) => setLedgerFrom(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-2" /></label>
        <label className="text-xs font-bold">Through<input type="date" value={ledgerTo} onChange={(event) => setLedgerTo(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-2" /></label>
      </section>
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 p-4"><div><h2 className="font-black">Activity ledger</h2><p className="text-xs text-gray-500">Chronological activity · newest first</p></div><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold">{filteredActivities.length} entries</span></div>
        <ol className="divide-y divide-gray-100">{filteredActivities.map((activity) => {
          const karigar = store.karigars.find((item) => item.id === activity.karigarId);
          const order = store.orders.find((item) => item.id === activity.orderId);
          const customerOrder = store.customerOrders.find((item) => item.id === activity.customerOrderId);
          return <li key={activity.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[150px_100px_110px_1fr]"><time className="text-xs text-gray-500">{new Date(activity.ts).toLocaleString('en-GB')}</time><b>{karigar?.name ?? '—'}</b><b className="uppercase text-indigo-800">{activity.type}</b><span>{activity.text}{order && <button type="button" onClick={() => openOrderInDrawer(order.id)} className="ml-2 font-bold text-indigo-800">View order</button>}{customerOrder && <span className="ml-2 text-xs text-gray-500">· {customerOrder.item}</span>}</span></li>;
        })}</ol>
        {filteredActivities.length === 0 && <p className="p-4 text-sm text-gray-600">No activity matches these filters.</p>}
      </section>
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="text-sm font-bold">Weight statement
            <select value={statementKarigarId} onChange={(event) => setStatementKarigarId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 bg-white px-3">
              <option value="">Choose karigar</option>{store.karigars.map((karigar) => <option key={karigar.id} value={karigar.id}>{karigar.name}</option>)}
            </select>
          </label>
          {statementKarigar && <div className="flex gap-2"><button type="button" onClick={statementCsv} className="min-h-10 rounded-lg border border-gray-300 px-3 text-sm font-bold">Export CSV</button><button type="button" onClick={() => window.print()} className="min-h-10 rounded-lg bg-gray-900 px-3 text-sm font-bold text-white">Print</button></div>}
        </div>
        {statementKarigar && statementBalance && <div id="weight-statement-print" className="hidden rounded-xl bg-gray-50 p-4 print:block">
          <style>{'@media print { body * { visibility: hidden !important; } #weight-statement-print, #weight-statement-print * { visibility: visible !important; } #weight-statement-print { display: block !important; position: absolute; inset: 0; padding: 24px; } }'}</style>
          <h3 className="text-lg font-black">Weight statement · {statementKarigar.name}</h3>
          <p className="mb-3 text-xs">Generated {new Date().toLocaleString('en-GB')}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><dt>Issued</dt><dd className="font-bold">{grams(statementIssuedMg)}</dd></div>
            <div><dt>Orders</dt><dd className="font-bold">{statementOrders.length}</dd></div>
            <div><dt>Wastage</dt><dd className="font-bold">{grams(statementWastageMg)}</dd></div>
            <div><dt>Bonus</dt><dd className="font-bold">{grams(statementBonusMg)}</dd></div>
            <div><dt>Balance in orders</dt><dd className="font-bold">{grams(statementBalance.inOrdersMg)}</dd></div>
            <div><dt>Untouched float</dt><dd className="font-bold">{grams(statementBalance.untouchedMg)}</dd></div>
          </dl>
        </div>}
      </section>
    </div>
  );

  const settingsView = (
    <div className="max-w-3xl space-y-4">
      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="font-black">Workshop settings</h2>
        <label className="block text-sm font-semibold">Default wastage: <b>{store.settings.defaultWastagePct}%</b>
          <input aria-label="Default wastage percentage" type="range" min="1" max="25" step="1" value={store.settings.defaultWastagePct} onChange={(event) => {
            const value = Number(event.target.value);
            perform(() => transactDemoStore((current) => ({ ...current, settings: { ...current.settings, defaultWastagePct: value } })));
          }} className="mt-2 w-full accent-amber-700" />
        </label>
        <label className="block text-sm font-semibold">Low-float warning threshold: <b>{lowFloatThresholdG} g</b>
          <input aria-label="Low-float warning threshold in grams" type="range" min="5" max="100" step="5" value={lowFloatThresholdG} onChange={(event) => {
            const value = Number(event.target.value);
            perform(() => transactDemoStore((current) => ({ ...current, settings: { ...current.settings, lowFloatThresholdG: value } })));
          }} className="mt-2 w-full accent-amber-700" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {([24, 22, 18] as const).map((purity) => <label key={purity} className="text-sm font-semibold">{purity}K demo rate (₹/g)
            <input aria-label={`Edit ${purity} karat demo rate`} type="number" min="1" step="1" value={demoRates[purity]} onChange={(event) => updateDemoRate(purity, event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-gray-300 px-3" />
          </label>)}
        </div>
        <label className="block text-sm font-semibold">Language
          <select id="settings-language" value={language} onChange={(event) => onLanguageChange(event.target.value as LocaleCode)} className="mt-1 min-h-10 rounded-lg border border-gray-300 bg-white px-3">
            <option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option>
          </select>
        </label>
        <p className="text-xs text-gray-500">Rates are editable demo estimates.</p>
      </section>
      <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="font-black">Demo data</h2>
        <p className="text-sm text-gray-600">Restore the seeded karigars, orders, customers, history, activity, and default settings. This replaces changes in the shared demo ledger.</p>
        <button type="button" onClick={() => perform(() => resetDemoStore())} className="min-h-10 rounded-lg border border-red-300 bg-red-50 px-4 font-bold text-red-900">Reset demo data</button>
      </section>
    </div>
  );

  const pageContent = screen === 'dashboard' ? dashboard
    : screen === 'karigars' ? karigarDirectory
      : screen === 'karigar-detail' ? karigarDetail
        : screen === 'orders' ? ordersView
          : screen === 'customers' ? customersView
            : screen === 'ledger' ? ledgerView
              : settingsView;

  return (
    <div className="min-h-dvh bg-stone-100 text-gray-950">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-gray-800 bg-gray-950 text-white md:flex">
        <div className="border-b border-white/10 px-5 py-5"><p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Jeweltech</p><p className="mt-1 text-lg font-black">Workshop desk</p><p className="mt-1 text-xs text-gray-400">Jeweller portal · Demo</p></div>
        <nav className="flex-1 space-y-1 p-3" aria-label="Jeweller sections">
          {navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setSelectedOrderId(''); setScreen(id); }} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold ${screen === id || (screen === 'karigar-detail' && id === 'karigars') ? 'bg-amber-500 text-gray-950' : 'text-gray-300 hover:bg-white/10'}`}><Icon size={18} aria-hidden="true" />{label}{id === 'orders' && pendingReports.length > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs font-black text-white">{pendingReports.length}</span>}</button>)}
        </nav>
        <div className="border-t border-white/10 p-3"><button type="button" onClick={onLogout} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-gray-300 hover:bg-white/10"><LogOut size={18} aria-hidden="true" />Sign out</button></div>
      </aside>
      <div className="min-h-dvh md:pl-60">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur md:px-7">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold text-gray-500">{user.name} · SYNTHETIC DEMO DATA</p><h1 className="text-xl font-black">{screenTitle}</h1></div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="sr-only" htmlFor="demo-language">Language</label>
              <select id="demo-language" aria-label="Language" value={language} onChange={(event) => onLanguageChange(event.target.value as LocaleCode)} className="min-h-10 max-w-24 rounded-lg border border-gray-300 bg-white px-2 text-sm font-bold">
                <option value="en">English</option><option value="hi">हिन्दी</option><option value="kn">ಕನ್ನಡ</option>
              </select>
              <button type="button" onClick={() => setScreen('dashboard')} aria-label="Open dashboard alerts" className="relative flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-gray-200"><Bell size={19} aria-hidden="true" /><span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-xs font-black">{pendingReports.length + lowFloatAlertCount}</span></button>
              <button type="button" onClick={onLogout} aria-label="Log out" className="flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-gray-200 md:hidden"><LogOut size={18} aria-hidden="true" /></button>
            </div>
          </div>
          <nav className="mt-3 flex gap-1 overflow-x-auto md:hidden" aria-label="Jeweller sections">{navItems.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setSelectedOrderId(''); setScreen(id); }} className={`flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-bold ${screen === id ? 'bg-gray-950 text-white' : 'bg-gray-100 text-gray-700'}`}><Icon size={15} aria-hidden="true" />{label}</button>)}</nav>
        </header>
        <main className="space-y-4 p-3 pb-10 sm:p-5 lg:p-7">
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p>}
          {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-900">{notice}</p>}
          {screen === 'karigar-detail' && !selectedKarigar ? <p role="alert" className="rounded-xl bg-red-50 p-4">Select a karigar from the list.</p> : pageContent}
        </main>
      </div>

      {selectedOrder && screen === 'orders' && (
        <div className="fixed inset-0 z-30">
          <button type="button" aria-label="Close order details" onClick={() => setSelectedOrderId('')} className="absolute inset-0 h-full w-full bg-gray-950/40" />
          <aside aria-label="Order details" className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-stone-100 p-4 shadow-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-gray-500">Order detail</p><h2 className="text-xl font-black">{selectedOrder.title}</h2></div><button type="button" onClick={() => setSelectedOrderId('')} aria-label="Close order drawer" className="rounded-lg p-2 hover:bg-gray-200"><X aria-hidden="true" /></button></div>
            <div className="mb-3 rounded-xl bg-white p-3 text-sm"><p><b>Karigar:</b> {store.karigars.find((item) => item.id === selectedOrder.karigarId)?.name}</p><p><b>Due:</b> {formatDate(selectedOrder.dueDate)} · <b>Status:</b> {selectedOrder.status}</p><p><b>Drawn:</b> {grams(selectedOrder.drawMg)} · <b>Wastage:</b> {selectedOrder.reportedWasteMg === null ? 'Not reported' : grams(selectedOrder.reportedWasteMg)} · <b>Threshold:</b> {grams(getOrderThresholdMg(selectedOrder))}</p><p><b>Verdict:</b> {verdict(selectedOrder)?.label ?? 'Awaiting report'}</p></div>
            {orderCard(selectedOrder, false)}
            {selectedOrder.status === 'reported' && <div className="my-3 flex gap-2"><button type="button" onClick={() => closeOrder(selectedOrder.id)} className="min-h-11 flex-1 rounded-lg bg-green-700 font-bold text-white">Acknowledge</button><button type="button" onClick={() => recheckOrder(selectedOrder.id)} className="min-h-11 flex-1 rounded-lg border border-amber-700 bg-white font-bold text-amber-950">Recheck</button></div>}
            <section className="mt-4 rounded-xl bg-white p-3"><h3 className="mb-2 font-black">Linked customer</h3>{(() => {
              const { customerOrder, customer } = customerForOrder(selectedOrder);
              if (!customer || !customerOrder) return <p className="text-sm text-gray-600">No linked customer order.</p>;
              return <><p className="font-bold">{customer.name} · {customer.phone} · {customer.city}</p><p className="text-sm">{customerOrder.item} · Expected {customerOrder.expectedWeightG} g · Advance {formatINR(customerOrder.advanceINR)}</p><button type="button" onClick={() => setScreen('customers')} className="mt-2 text-sm font-bold text-indigo-800">Open customer records →</button></>;
            })()}</section>
            <section className="mt-4 rounded-xl bg-white p-3"><h3 className="mb-2 font-black">Order timeline</h3><ol className="space-y-2">{store.activities.filter((activity) => activity.orderId === selectedOrder.id).sort((first, second) => Date.parse(first.ts) - Date.parse(second.ts)).map((activity) => <li key={activity.id} className="border-l-2 border-amber-400 pl-3 text-sm"><time className="text-xs text-gray-500">{formatDate(activity.ts)}</time><p><b>{activity.type}</b> · {activity.text}</p></li>)}</ol></section>
          </aside>
        </div>
      )}
    </div>
  );
}
