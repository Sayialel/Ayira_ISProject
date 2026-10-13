import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { Card } from '@/components/ui';
import { formatCurrency } from '@/lib/format';
import type { FundResponse } from '@/types';

interface FundEscrowProps {
  gigId: string;
  workerId: string;
  workerName: string;
  /** Pre-fills the amount with what the worker asked for. */
  suggestedAmount: number | null;
  onFunded: () => void;
}

/**
 * Opens an escrow and sends the employer an M-Pesa prompt.
 *
 * The payment is not complete when this returns — Safaricom pushes a prompt to
 * the phone and confirms separately — so the panel says so rather than
 * implying the money has moved.
 */
export default function FundEscrow({
  gigId,
  workerId,
  workerName,
  suggestedAmount,
  onFunded,
}: FundEscrowProps) {
  const toast = useToast();
  const [amount, setAmount] = useState(suggestedAmount ? String(suggestedAmount) : '');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [awaiting, setAwaiting] = useState<FundResponse | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const value = Number(amount);
    if (!amount || !Number.isFinite(value) || value <= 0) {
      toast.error('Enter the amount you are paying.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<FundResponse>('/escrow/fund', {
        method: 'POST',
        body: JSON.stringify({
          gig_id: gigId,
          worker_id: workerId,
          amount: value,
          ...(phone.trim() && { phone: phone.trim() }),
        }),
      });
      setAwaiting(result);
      toast.info(result.message);
      onFunded();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (awaiting) {
    return (
      <Card className="p-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-gold-50 text-gold-600">
          <Smartphone size={24} aria-hidden />
        </div>
        <h3 className="font-semibold text-slate-900">Check your phone</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
          We have sent an M-Pesa request for{' '}
          <span className="font-semibold text-slate-700">{formatCurrency(awaiting.amount)}</span>.
          Enter your PIN to complete it. The gig stays unpaid until you do.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Already paid but nothing changed?{' '}
          <Link to="/app/escrow" className="font-medium text-ayira-700 hover:underline">
            Check the payment
          </Link>{' '}
          on the payments page.
        </p>
      </Card>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-slate-200 px-3.5 py-2.5 text-sm shadow-card transition-colors focus:border-ayira-500 focus:outline-none';

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-50 text-gold-600">
          <ShieldCheck size={19} aria-hidden />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900">Fund escrow</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Your money is held safely and released to {workerName} only when you say the work is
            done.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="escrow_amount" className="mb-1.5 block text-sm font-medium text-slate-700">
            Amount (KES)
          </label>
          <input
            id="escrow_amount"
            type="number"
            min={1}
            step={100}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
          {suggestedAmount !== null && (
            <p className="mt-1.5 text-xs text-slate-400">
              {workerName} proposed {formatCurrency(suggestedAmount)}.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="escrow_phone" className="mb-1.5 block text-sm font-medium text-slate-700">
            M-Pesa number <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="escrow_phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Leave blank to use your profile number"
            className={inputClass}
          />
        </div>

        <Button type="submit" variant="money" loading={submitting} icon={<Smartphone size={16} />}>
          Send M-Pesa request
        </Button>
      </form>
    </Card>
  );
}
