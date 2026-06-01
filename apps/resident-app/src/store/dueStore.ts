import { create } from 'zustand';
import * as api from '../api/client';

export interface Due {
  id: string;
  period: string;
  description: string | null;
  baseAmount: number;
  penaltyAmount: number;
  totalAmount: number;
  dueDate: string | null;
  status: 'pending' | 'paid';
  isOverdue: boolean;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  gateway: string;
  receiptNo: string | null;
  period: string;
  description: string | null;
  paidAt: string | null;
}

export interface PayOrder {
  paymentId: string;
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string | null;
  testMode: boolean;
}

interface DueState {
  dues: Due[];
  outstanding: number;
  history: PaymentRecord[];
  loading: boolean;
  fetch: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  startPayment: (dueId: string) => Promise<PayOrder>;
  checkPayment: (paymentId: string) => Promise<{ status: string; receiptNo: string | null }>;
}

function mapDue(raw: any): Due {
  return {
    id: raw.id,
    period: raw.period,
    description: raw.description ?? null,
    baseAmount: Number(raw.base_amount) || 0,
    penaltyAmount: Number(raw.penalty_amount) || 0,
    totalAmount: Number(raw.total_amount) || 0,
    dueDate: raw.due_date ?? null,
    status: raw.status,
    isOverdue: !!raw.is_overdue,
  };
}

function mapPayment(raw: any): PaymentRecord {
  return {
    id: raw.id,
    amount: Number(raw.amount) || 0,
    gateway: raw.gateway,
    receiptNo: raw.receipt_no ?? null,
    period: raw.period,
    description: raw.description ?? null,
    paidAt: raw.paid_at ?? null,
  };
}

export const useDueStore = create<DueState>((set) => ({
  dues: [],
  outstanding: 0,
  history: [],
  loading: false,
  fetch: async () => {
    set({ loading: true });
    try {
      const res = await api.getDues();
      const data = res.data.data || {};
      set({
        dues: Array.isArray(data.dues) ? data.dues.map(mapDue) : [],
        outstanding: Number(data.outstanding) || 0,
      });
    } finally {
      set({ loading: false });
    }
  },
  fetchHistory: async () => {
    const res = await api.getDuesHistory();
    const raw = res.data.data;
    set({ history: Array.isArray(raw) ? raw.map(mapPayment) : [] });
  },
  startPayment: async (dueId) => {
    const res = await api.payDue(dueId);
    const d = res.data.data;
    return {
      paymentId: d.payment_id,
      orderId: d.order_id,
      amount: d.amount,
      currency: d.currency,
      keyId: d.key_id ?? null,
      testMode: !!d.test_mode,
    };
  },
  checkPayment: async (paymentId) => {
    const res = await api.getPaymentStatus(paymentId);
    const d = res.data.data;
    return { status: d.status, receiptNo: d.receipt_no ?? null };
  },
}));
