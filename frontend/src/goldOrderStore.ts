export interface DemoKarigar {
  id: string;
  name: string;
  floatTotalMg: number;
}

export type DemoOrderStatus = 'open' | 'reported' | 'closed' | 'disputed';

export interface DemoOrder {
  id: string;
  karigarId: string;
  title: string;
  customerOrderId: string | null;
  drawMg: number;
  allowedPct: number;
  status: DemoOrderStatus;
  reportedWasteMg: number | null;
  createdAt: string;
  dueDate: string;
  closedAt: string | null;
  isNew: boolean;
  acknowledged: boolean;
  disputeReason: string | null;
}

export interface DemoCustomer {
  id: string;
  name: string;
  phone: string;
  city: string;
}

export type CustomerOrderStatus = 'received' | 'with_karigar' | 'ready' | 'delivered';

export interface DemoCustomerOrder {
  id: string;
  customerId: string;
  item: string;
  expectedWeightG: number;
  dueDate: string;
  advanceINR: number;
  makingINR: number;
  status: CustomerOrderStatus;
  customerUpdate: DemoCustomerUpdate | null;
}

export interface DemoCustomerUpdate {
  orderId: string;
  preparedAt: string;
  wastageMg: number;
  verdict: string;
  text: string;
}

export type ActivityType =
  | 'customer-order'
  | 'issue'
  | 'assign'
  | 'top-up'
  | 'report'
  | 'ack'
  | 'recheck'
  | 'dispute'
  | 'notify'
  | 'delivered';

export interface DemoActivity {
  id: string;
  ts: string;
  karigarId: string;
  orderId?: string;
  customerOrderId?: string;
  type: ActivityType;
  text: string;
}

export interface DemoSettings {
  defaultWastagePct: number;
  lowFloatThresholdG: number;
  demoRates: { 24: number; 22: number; 18: number };
  rateLastUpdated: string;
}

export interface DemoStore {
  karigars: DemoKarigar[];
  orders: DemoOrder[];
  customers: DemoCustomer[];
  customerOrders: DemoCustomerOrder[];
  activities: DemoActivity[];
  settings: DemoSettings;
}

const STORAGE_KEY = 'jeweltech.gold-order-demo.v2';
const LEGACY_STORAGE_KEY = 'jeweltech.gold-order-demo.v1';
const CHANNEL_NAME = 'jeweltech.gold-order-demo';
const CHANGE_EVENT = 'jeweltech-gold-order-demo-change';
const GRAMS = 1000;
export const DEFAULT_ALLOWED_PCT = 10;
export const LOW_UNTOUCHED_WARNING_MG = 10 * GRAMS;
export const DEFAULT_DEMO_SETTINGS: DemoSettings = {
  defaultWastagePct: DEFAULT_ALLOWED_PCT,
  lowFloatThresholdG: 20,
  demoRates: { 24: 14500, 22: 13280, 18: 10875 },
  rateLastUpdated: new Date().toISOString(),
};

const karigarSeeds = [
  { id: 'ramesh', name: 'Ramesh', floatTotalMg: 100 * GRAMS },
  { id: 'suresh', name: 'Suresh', floatTotalMg: 150 * GRAMS },
  { id: 'imran', name: 'Imran', floatTotalMg: 120 * GRAMS },
  { id: 'dinesh', name: 'Dinesh', floatTotalMg: 200 * GRAMS },
];

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function createSeedStore(): DemoStore {
  const customers: DemoCustomer[] = [
    { id: 'customer-asha', name: 'Asha Rao', phone: '0000000001', city: 'Mysuru' },
    { id: 'customer-kavya', name: 'Kavya Shetty', phone: '0000000002', city: 'Mysuru' },
    { id: 'customer-meera', name: 'Meera Nair', phone: '0000000003', city: 'Mandya' },
    { id: 'customer-nikhil', name: 'Nikhil Jain', phone: '0000000004', city: 'Mysuru' },
    { id: 'customer-arjun', name: 'Arjun Rao', phone: '0000000005', city: 'Hunsur' },
    { id: 'customer-priya', name: 'Priya', phone: '9876543210', city: 'Mysuru' },
  ];
  const customerOrders: DemoCustomerOrder[] = [
    { id: 'customer-order-1', customerId: 'customer-asha', item: 'Gold chain', expectedWeightG: 22, dueDate: daysFromNow(7), advanceINR: 3000, makingINR: 2500, status: 'with_karigar', customerUpdate: null },
    { id: 'customer-order-2', customerId: 'customer-kavya', item: 'Gold rings', expectedWeightG: 8, dueDate: daysFromNow(8), advanceINR: 1500, makingINR: 1200, status: 'with_karigar', customerUpdate: null },
    { id: 'customer-order-3', customerId: 'customer-meera', item: 'Pendant', expectedWeightG: 5, dueDate: daysFromNow(9), advanceINR: 1000, makingINR: 900, status: 'with_karigar', customerUpdate: null },
    { id: 'customer-order-4', customerId: 'customer-nikhil', item: 'Gold chain', expectedWeightG: 12, dueDate: daysFromNow(12), advanceINR: 2500, makingINR: 1800, status: 'with_karigar', customerUpdate: null },
    { id: 'customer-order-5', customerId: 'customer-arjun', item: 'Bangles', expectedWeightG: 14, dueDate: daysFromNow(14), advanceINR: 5000, makingINR: 3200, status: 'with_karigar', customerUpdate: null },
    { id: 'customer-order-6', customerId: 'customer-asha', item: 'Earrings', expectedWeightG: 15, dueDate: daysFromNow(16), advanceINR: 2000, makingINR: 1500, status: 'with_karigar', customerUpdate: null },
  ];
  const openOrders: Array<Pick<DemoOrder, 'id' | 'karigarId' | 'title' | 'customerOrderId' | 'drawMg'>> = [
    { id: 'ramesh-chain', karigarId: 'ramesh', title: 'Gold chain', customerOrderId: 'customer-order-1', drawMg: 22 * GRAMS },
    { id: 'ramesh-rings', karigarId: 'ramesh', title: 'Gold rings', customerOrderId: 'customer-order-2', drawMg: 8 * GRAMS },
    { id: 'ramesh-pendant', karigarId: 'ramesh', title: 'Pendant', customerOrderId: 'customer-order-3', drawMg: 5 * GRAMS },
    { id: 'suresh-chain', karigarId: 'suresh', title: 'Gold chain', customerOrderId: 'customer-order-4', drawMg: 12 * GRAMS },
    { id: 'suresh-ring', karigarId: 'suresh', title: 'Gold ring', customerOrderId: 'customer-order-4', drawMg: 8 * GRAMS },
    { id: 'imran-bangles', karigarId: 'imran', title: 'Bangles', customerOrderId: 'customer-order-5', drawMg: 14 * GRAMS },
    { id: 'dinesh-chain', karigarId: 'dinesh', title: 'Gold chain', customerOrderId: 'customer-order-1', drawMg: 10 * GRAMS },
    { id: 'dinesh-earrings', karigarId: 'dinesh', title: 'Earrings', customerOrderId: 'customer-order-6', drawMg: 15 * GRAMS },
  ];
  const historySeeds = [
    { id: 'history-ramesh-chain', karigarId: 'ramesh', customerOrderId: 'customer-order-1', title: 'Gold chain', drawG: 22, wasteG: 1.5, closedDaysAgo: 3, dueDaysAgo: 5 },
    { id: 'history-suresh-chain', karigarId: 'suresh', customerOrderId: 'customer-order-4', title: 'Gold chain', drawG: 12, wasteG: 0.9, closedDaysAgo: 10, dueDaysAgo: 12 },
    { id: 'history-suresh-pendant', karigarId: 'suresh', customerOrderId: 'customer-order-3', title: 'Pendant', drawG: 5, wasteG: 0.3, closedDaysAgo: 55, dueDaysAgo: 52 },
    { id: 'history-imran-bangles', karigarId: 'imran', customerOrderId: 'customer-order-5', title: 'Bangles', drawG: 14, wasteG: 1.8, closedDaysAgo: 20, dueDaysAgo: 21 },
    { id: 'history-imran-rings', karigarId: 'imran', customerOrderId: 'customer-order-2', title: 'Gold rings', drawG: 8, wasteG: 1, closedDaysAgo: 25, dueDaysAgo: 20 },
    { id: 'history-imran-pendant', karigarId: 'imran', customerOrderId: 'customer-order-3', title: 'Pendant', drawG: 10, wasteG: 1.4, closedDaysAgo: 30, dueDaysAgo: 27 },
    { id: 'history-dinesh-chain', karigarId: 'dinesh', customerOrderId: 'customer-order-4', title: 'Gold chain', drawG: 10, wasteG: 0.7, closedDaysAgo: 38, dueDaysAgo: 40 },
    { id: 'history-dinesh-earrings', karigarId: 'dinesh', customerOrderId: 'customer-order-6', title: 'Earrings', drawG: 15, wasteG: 1.8, closedDaysAgo: 45, dueDaysAgo: 47 },
  ];
  const orders: DemoOrder[] = [
    ...openOrders.map((order, index) => ({
      ...order,
      allowedPct: DEFAULT_ALLOWED_PCT,
      status: 'open' as const,
      reportedWasteMg: null,
      createdAt: daysFromNow(-index - 1),
      dueDate: daysFromNow(7 + index),
      closedAt: null,
      isNew: false,
      acknowledged: false,
      disputeReason: null,
    })),
    ...historySeeds.map((order) => ({
      id: order.id,
      karigarId: order.karigarId,
      title: order.title,
      customerOrderId: order.customerOrderId,
      drawMg: order.drawG * GRAMS,
      allowedPct: DEFAULT_ALLOWED_PCT,
      status: 'closed' as const,
      reportedWasteMg: Math.round(order.wasteG * GRAMS),
      createdAt: daysFromNow(-order.closedDaysAgo - 10),
      dueDate: daysFromNow(-order.dueDaysAgo),
      closedAt: daysFromNow(-order.closedDaysAgo),
      isNew: false,
      acknowledged: true,
      disputeReason: null,
    })),
  ];
  const activities: DemoActivity[] = [];
  for (const order of openOrders) {
    const ts = orders.find((item) => item.id === order.id)!.createdAt;
    activities.push(
      { id: `${order.id}-issue`, ts, karigarId: order.karigarId, orderId: order.id, type: 'issue', text: `Issued ${order.drawMg / GRAMS} g for ${order.title}.` },
      { id: `${order.id}-notify`, ts: new Date(Date.parse(ts) + 1).toISOString(), karigarId: order.karigarId, orderId: order.id, type: 'notify', text: 'New work slip is ready.' },
    );
  }
  for (const history of historySeeds) {
    const order = orders.find((item) => item.id === history.id)!;
    const reportTs = new Date(Date.parse(order.closedAt!) - 60_000).toISOString();
    activities.push(
      { id: `${order.id}-issue`, ts: order.createdAt, karigarId: order.karigarId, orderId: order.id, type: 'issue', text: `Issued ${order.drawMg / GRAMS} g for ${order.title}.` },
      { id: `${order.id}-report`, ts: reportTs, karigarId: order.karigarId, orderId: order.id, type: 'report', text: `Reported ${order.reportedWasteMg! / GRAMS} g wastage.` },
      { id: `${order.id}-notify`, ts: new Date(Date.parse(reportTs) + 1).toISOString(), karigarId: order.karigarId, orderId: order.id, type: 'notify', text: 'Wastage report is ready for review.' },
      { id: `${order.id}-ack`, ts: order.closedAt!, karigarId: order.karigarId, orderId: order.id, type: 'ack', text: 'Report acknowledged and order closed.' },
    );
  }
  return {
    karigars: karigarSeeds.map((karigar) => ({ ...karigar })),
    orders,
    customers,
    customerOrders,
    activities: activities.sort((first, second) => Date.parse(first.ts) - Date.parse(second.ts)),
    settings: { ...DEFAULT_DEMO_SETTINGS, demoRates: { ...DEFAULT_DEMO_SETTINGS.demoRates } },
  };
}

function isDemoStore(value: unknown): value is DemoStore {
  if (!value || typeof value !== 'object') return false;
  const store = value as Partial<DemoStore>;
  if (!Array.isArray(store.karigars)
    || !Array.isArray(store.orders)
    || !Array.isArray(store.customers)
    || !Array.isArray(store.customerOrders)
    || !Array.isArray(store.activities)) return false;
  const karigars = store.karigars;
  const orders = store.orders;
  const customers = store.customers;
  const customerOrders = store.customerOrders;
  const activities = store.activities;
  const validSettings = store.settings === undefined
    || (Number.isFinite(store.settings.defaultWastagePct)
      && store.settings.defaultWastagePct > 0
      && Number.isFinite(store.settings.lowFloatThresholdG)
      && store.settings.lowFloatThresholdG >= 0
      && Number.isFinite(store.settings.demoRates?.[24])
      && store.settings.demoRates[24] > 0
      && Number.isFinite(store.settings.demoRates?.[22])
      && store.settings.demoRates[22] > 0
      && Number.isFinite(store.settings.demoRates?.[18])
      && store.settings.demoRates[18] > 0
      && typeof store.settings.rateLastUpdated === 'string'
      && Number.isFinite(Date.parse(store.settings.rateLastUpdated)));
  const validRecords = validSettings
    && karigars.every((karigar) =>
      typeof karigar.id === 'string'
      && typeof karigar.name === 'string'
      && Number.isSafeInteger(karigar.floatTotalMg)
      && karigar.floatTotalMg >= 0)
    && orders.every((order) =>
      typeof order.id === 'string'
      && typeof order.karigarId === 'string'
      && typeof order.title === 'string'
      && (order.customerOrderId === null || typeof order.customerOrderId === 'string')
      && typeof order.createdAt === 'string'
      && Number.isFinite(Date.parse(order.createdAt))
      && typeof order.dueDate === 'string'
      && Number.isFinite(Date.parse(order.dueDate))
      && (order.closedAt === null || (typeof order.closedAt === 'string' && Number.isFinite(Date.parse(order.closedAt))))
      && Number.isSafeInteger(order.drawMg)
      && order.drawMg > 0
      && Number.isFinite(order.allowedPct)
      && order.allowedPct > 0
      && ['open', 'reported', 'closed', 'disputed'].includes(order.status)
      && (order.reportedWasteMg === null || (Number.isSafeInteger(order.reportedWasteMg) && order.reportedWasteMg >= 0))
      && (order.status !== 'reported' || order.reportedWasteMg !== null)
      && (order.status !== 'closed' || (order.closedAt !== null && order.reportedWasteMg !== null))
      && (order.status === 'closed' || order.closedAt === null)
      && typeof order.isNew === 'boolean'
      && typeof order.acknowledged === 'boolean'
      && (order.disputeReason === null || typeof order.disputeReason === 'string'))
    && customers.every((customer) =>
      typeof customer.id === 'string'
      && typeof customer.name === 'string'
      && typeof customer.phone === 'string'
      && typeof customer.city === 'string')
    && customerOrders.every((customerOrder) =>
      typeof customerOrder.id === 'string'
      && typeof customerOrder.customerId === 'string'
      && typeof customerOrder.item === 'string'
      && Number.isFinite(customerOrder.expectedWeightG)
      && customerOrder.expectedWeightG > 0
      && typeof customerOrder.dueDate === 'string'
      && Number.isFinite(Date.parse(customerOrder.dueDate))
      && Number.isFinite(customerOrder.advanceINR)
      && customerOrder.advanceINR >= 0
      && Number.isFinite(customerOrder.makingINR)
      && customerOrder.makingINR >= 0
      && ['received', 'with_karigar', 'ready', 'delivered'].includes(customerOrder.status)
      && (customerOrder.customerUpdate === undefined || customerOrder.customerUpdate === null
        || (typeof customerOrder.customerUpdate.orderId === 'string'
          && typeof customerOrder.customerUpdate.preparedAt === 'string'
          && Number.isFinite(Date.parse(customerOrder.customerUpdate.preparedAt))
          && Number.isSafeInteger(customerOrder.customerUpdate.wastageMg)
          && customerOrder.customerUpdate.wastageMg >= 0
          && typeof customerOrder.customerUpdate.verdict === 'string'
          && typeof customerOrder.customerUpdate.text === 'string')))
    && activities.every((activity) =>
      typeof activity.id === 'string'
      && typeof activity.ts === 'string'
      && Number.isFinite(Date.parse(activity.ts))
      && typeof activity.karigarId === 'string'
      && (activity.orderId === undefined || typeof activity.orderId === 'string')
      && (activity.customerOrderId === undefined || typeof activity.customerOrderId === 'string')
      && ['customer-order', 'issue', 'assign', 'top-up', 'report', 'ack', 'recheck', 'dispute', 'notify', 'delivered'].includes(activity.type)
      && typeof activity.text === 'string');
  if (!validRecords) return false;
  const karigarIds = new Set(karigars.map((karigar) => karigar.id));
  const orderIds = new Set(orders.map((order) => order.id));
  const customerIds = new Set(customers.map((customer) => customer.id));
  const customerOrderIds = new Set(customerOrders.map((customerOrder) => customerOrder.id));
  const activityIds = new Set(activities.map((activity) => activity.id));
  return karigarIds.size === karigars.length
    && orderIds.size === orders.length
    && customerIds.size === customers.length
    && customerOrderIds.size === customerOrders.length
    && activityIds.size === activities.length
    && orders.every((order) => karigarIds.has(order.karigarId))
    && orders.every((order) => order.customerOrderId === null || customerOrderIds.has(order.customerOrderId))
    && customerOrders.every((customerOrder) => customerIds.has(customerOrder.customerId))
    && activities.every((activity) =>
      (activity.karigarId === '' && activity.type === 'customer-order' || karigarIds.has(activity.karigarId))
      && (activity.orderId === undefined || orderIds.has(activity.orderId))
      && (activity.customerOrderId === undefined || customerOrderIds.has(activity.customerOrderId)))
    && karigars.every((karigar) => {
      const inOrdersMg = orders
        .filter((order) => order.karigarId === karigar.id && order.status !== 'closed')
        .reduce((total, order) => total + order.drawMg, 0);
      return Number.isSafeInteger(inOrdersMg) && inOrdersMg <= karigar.floatTotalMg;
    });
}

export function readDemoStore(): DemoStore {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === null) {
    const seed = createSeedStore();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return seed;
  }
  const parsed: unknown = JSON.parse(saved);
  if (!isDemoStore(parsed)) throw new Error('Saved demo ledger is invalid. Use Reset demo to restore it.');
  const store = parsed as DemoStore;
  return {
    ...store,
    customers: store.customers.some((customer) => customer.id === 'customer-priya')
      ? store.customers
      : [...store.customers, { id: 'customer-priya', name: 'Priya', phone: '9876543210', city: 'Mysuru' }],
    settings: {
      ...DEFAULT_DEMO_SETTINGS,
      ...store.settings,
      demoRates: {
        ...DEFAULT_DEMO_SETTINGS.demoRates,
        ...store.settings?.demoRates,
      },
    },
    customerOrders: store.customerOrders.map((customerOrder) => ({
      ...customerOrder,
      customerUpdate: customerOrder.customerUpdate ?? null,
    })),
  };
}

function notifyOtherViews(store: DemoStore): void {
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: store }));
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(store);
    channel.close();
  }
}

export function writeDemoStore(store: DemoStore): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  notifyOtherViews(store);
}

export function subscribeDemoStore(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  const onLocalChange = () => onChange();
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, onLocalChange);
  let channel: BroadcastChannel | null = null;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = onChange;
  }
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, onLocalChange);
    channel?.close();
  };
}

export function resetDemoStore(): DemoStore {
  const seed = createSeedStore();
  writeDemoStore(seed);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  return seed;
}

export function appendDemoActivity(
  store: DemoStore,
  activity: Omit<DemoActivity, 'id' | 'ts'>,
): DemoStore {
  return {
    ...store,
    activities: [...store.activities, {
      ...activity,
      id: makeDemoId(),
      ts: new Date().toISOString(),
    }],
  };
}

export function getOrderThresholdMg(order: Pick<DemoOrder, 'drawMg' | 'allowedPct'>): number {
  return Math.round(order.drawMg * order.allowedPct / 100);
}

export function getKarigarBalances(store: DemoStore, karigarId: string) {
  const karigar = store.karigars.find((item) => item.id === karigarId);
  if (!karigar) throw new Error('Karigar was not found in the demo ledger.');
  const inOrdersMg = store.orders
    .filter((order) => order.karigarId === karigarId && order.status !== 'closed')
    .reduce((total, order) => total + order.drawMg, 0);
  return {
    totalMg: karigar.floatTotalMg,
    inOrdersMg,
    untouchedMg: karigar.floatTotalMg - inOrdersMg,
  };
}

export function transactDemoStore(
  update: (current: DemoStore) => DemoStore,
): DemoStore {
  const next = update(readDemoStore());
  writeDemoStore(next);
  return next;
}

export function makeDemoId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
