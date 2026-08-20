import { payWithRazorpay, confirmPayment } from './checkout';
import * as api from '../api/client';

jest.mock('../api/client');

// The real module is a native one: present as a JS wrapper under jest, absent
// at runtime in Expo Go. Mocked here so both states can be exercised.
const mockOpen = jest.fn();
jest.mock('react-native-razorpay', () => ({ default: { open: (...a: any[]) => mockOpen(...a) } }));

const order = {
  orderId: 'order_test_1', paymentOrderId: 'po1', amount: 206000,
  currency: 'INR', keyId: 'rzp_test_key', testMode: true,
};
const payer = { name: 'Asha', phone: '9876543210' };

beforeEach(() => jest.clearAllMocks());

describe('payWithRazorpay', () => {
  it('FR-STL-05: opens checkout and reports success on a payment id', async () => {
    mockOpen.mockResolvedValue({ razorpay_payment_id: 'pay_1' });
    await expect(payWithRazorpay(order, payer, 'Stall A1')).resolves.toEqual({ ok: true });
  });

  it('FR-STL-05: passes the order and prefills the payer', async () => {
    mockOpen.mockResolvedValue({ razorpay_payment_id: 'pay_1' });
    await payWithRazorpay(order, payer, 'Stall A1');
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({
      order_id: 'order_test_1', amount: 206000, key: 'rzp_test_key',
      prefill: { name: 'Asha', contact: '9876543210' },
    }));
  });

  it('FR-STL-05: reports unavailable when the server sent no gateway key', async () => {
    const res = await payWithRazorpay({ ...order, keyId: null }, payer, 'Stall A1');
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
    expect(mockOpen).not.toHaveBeenCalled();
  });

  // The SDK throws on user cancellation as well as on real errors, and the
  // two must not read the same to the person holding the phone.
  it('FR-STL-05: tells a cancellation apart from a failure', async () => {
    mockOpen.mockRejectedValue({ code: 0, description: 'Payment cancelled by user' });
    expect((await payWithRazorpay(order, payer, 'Stall A1'))).toEqual({ ok: false, reason: 'cancelled' });

    mockOpen.mockRejectedValue({ code: 2, description: 'Network error' });
    expect((await payWithRazorpay(order, payer, 'Stall A1'))).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('FR-STL-05: treats a sheet that returns no payment id as cancelled', async () => {
    mockOpen.mockResolvedValue({});
    await expect(payWithRazorpay(order, payer, 'Stall A1')).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('confirmPayment', () => {
  it('FR-STL-07: resolves paid once the webhook has settled the order', async () => {
    (api.getPaymentOrder as jest.Mock)
      .mockResolvedValueOnce({ data: { data: { status: 'created' } } })
      .mockResolvedValueOnce({ data: { data: { status: 'paid' } } });

    await expect(confirmPayment('po1', { attempts: 3, delayMs: 0 })).resolves.toBe('paid');
  });

  // Claiming success for a booking the server never confirmed is the one
  // outcome worth avoiding — the money may not have moved.
  it('FR-STL-07: gives up as pending rather than claiming success', async () => {
    (api.getPaymentOrder as jest.Mock).mockResolvedValue({ data: { data: { status: 'created' } } });
    await expect(confirmPayment('po1', { attempts: 2, delayMs: 0 })).resolves.toBe('pending');
  });

  it('FR-STL-07: surfaces an outright failure immediately', async () => {
    (api.getPaymentOrder as jest.Mock).mockResolvedValue({ data: { data: { status: 'failed' } } });
    await expect(confirmPayment('po1', { attempts: 3, delayMs: 0 })).resolves.toBe('failed');
  });

  it('FR-STL-07: keeps polling through a transient network error', async () => {
    (api.getPaymentOrder as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { data: { status: 'paid' } } });

    await expect(confirmPayment('po1', { attempts: 3, delayMs: 0 })).resolves.toBe('paid');
  });

  it('FR-STL-07: stops after the configured number of attempts', async () => {
    (api.getPaymentOrder as jest.Mock).mockResolvedValue({ data: { data: { status: 'created' } } });
    await confirmPayment('po1', { attempts: 4, delayMs: 0 });
    expect(api.getPaymentOrder).toHaveBeenCalledTimes(4);
  });
});
