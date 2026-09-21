'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { registerCards } from '@/lib/valet';

type ModuleKey = 'gate' | 'community' | 'valet';

const MODULES: { key: ModuleKey; label: string; description: string }[] = [
  { key: 'valet', label: 'DwaarAI Valet', description: 'Valet stand, cards, slots, handover tracking' },
  { key: 'gate', label: 'Nazar — Gate', description: 'Gate automation, guards, visitors, vehicles' },
  { key: 'community', label: 'Basera — Community', description: 'Residents, units, notices, SOS, facilities' },
];

interface Created {
  communityId: string;
  communityName: string;
  adminUsername: string;
  modules: ModuleKey[];
}

/**
 * Standing up a new valet property.
 *
 * This existed as three unrelated screens -- create the community here, make
 * a login there, set what they bought somewhere else -- with nothing saying
 * the three belonged together and nothing noticing when someone stopped after
 * the first. The server does those three as one transaction; this walks the
 * person through them in the order they think about them.
 *
 * Cards are a separate, skippable step on purpose: they are the one thing
 * that needs the property to already exist, they get reprinted and extended
 * for the life of the account, and a stand can open without them.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { user, selectCommunity } = useAuth();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');

  const [modules, setModules] = useState<ModuleKey[]>(['valet']);

  const [adminName, setAdminName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [created, setCreated] = useState<Created | null>(null);

  const [cardPrefix, setCardPrefix] = useState('V');
  const [cardFrom, setCardFrom] = useState('1');
  const [cardTo, setCardTo] = useState('50');
  const [cardsMade, setCardsMade] = useState<number | null>(null);

  if (user && user.role !== 'super_admin') {
    return (
      <div className="glass-panel p-12 text-center max-w-xl">
        <p className="text-sm text-gray-500">
          Onboarding a property is done by Dwaar AI ops.
        </p>
      </div>
    );
  }

  const toggleModule = (key: ModuleKey) => {
    const has = modules.includes(key);
    if (has && modules.length === 1) return;
    setModules(has ? modules.filter((m) => m !== key) : [...modules, key]);
  };

  const step1Ready = name.trim().length > 0;
  const step3Ready =
    adminName.trim().length > 0 && username.trim().length >= 3 && password.length >= 8;

  async function createProperty() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: Created }>('/admin/onboarding/valet', {
        property: {
          name: name.trim(),
          address: address.trim() || undefined,
          contactName: contactName.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
        },
        admin: { name: adminName.trim(), username: username.trim(), password },
        modules,
      });
      setCreated(res.data);
      // Point the rest of the portal at the property that was just made, so
      // the card step and everything after it act on the right one.
      selectCommunity(res.data.communityId, res.data.communityName);
      setStep(4);
    } catch (err) {
      // The server's message is the specific one ("Username already exists");
      // the fallback matters because a failure here rolls everything back, and
      // the person needs to know nothing was half-created.
      setError(
        err instanceof Error && err.message && !/^API error/.test(err.message)
          ? err.message
          : 'Could not create the property. Nothing was saved.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function makeCards() {
    setBusy(true);
    setError(null);
    try {
      const res = await registerCards({
        prefix: cardPrefix.trim(),
        from: Number(cardFrom),
        to: Number(cardTo),
      });
      setCardsMade(res.added.length);
    } catch {
      setError('Could not create the cards. The property is fine — you can do this later from Cards.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New valet property</h1>
        <p className="text-sm text-gray-400 mt-1">
          Creates the property, what it was sold, and the login that will run it.
        </p>
      </div>

      <ol className="flex items-center gap-2 text-xs">
        {['Property', 'Products', 'Login', 'Cards'].map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4;
          const done = step > n;
          const now = step === n;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-bold ${
                  now ? 'bg-glow-primary text-white'
                    : done ? 'bg-teal-50 text-teal-600'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? '✓' : n}
              </span>
              <span className={now ? 'font-bold text-gray-900' : 'text-gray-400'}>{label}</span>
              {n < 4 && <span className="mx-1 text-gray-300">—</span>}
            </li>
          );
        })}
      </ol>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="glass-panel p-6 space-y-4">
          <Field label="Property name" value={name} onChange={setName} placeholder="The Leela Palace" />
          <Field label="Address" value={address} onChange={setAddress} placeholder="Old Airport Road, Bengaluru" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact name" value={contactName} onChange={setContactName} />
            <Field label="Contact phone" value={contactPhone} onChange={setContactPhone} placeholder="9876543210" />
          </div>
          <Actions>
            <Next disabled={!step1Ready} onClick={() => setStep(2)} />
          </Actions>
        </div>
      )}

      {step === 2 && (
        <div className="glass-panel p-6 space-y-4">
          <p className="text-xs text-gray-400">
            Decides which sections this property sees in its own portal. Valet only, unless
            they bought more.
          </p>
          {MODULES.map((m) => {
            const on = modules.includes(m.key);
            const isLast = on && modules.length === 1;
            return (
              <label key={m.key} className={`flex items-start gap-3 ${isLast ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={isLast}
                  onChange={() => toggleModule(m.key)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 disabled:opacity-40"
                />
                <span>
                  <span className="block text-sm font-bold text-gray-900">{m.label}</span>
                  <span className="block text-xs text-gray-400">{m.description}</span>
                </span>
              </label>
            );
          })}
          <Actions>
            <Back onClick={() => setStep(1)} />
            <Next onClick={() => setStep(3)} />
          </Actions>
        </div>
      )}

      {step === 3 && (
        <div className="glass-panel p-6 space-y-4">
          <p className="text-xs text-gray-400">
            The account you hand to the property. They sign in with this.
          </p>
          <Field label="Their name" value={adminName} onChange={setAdminName} placeholder="Asha Rao" />
          <Field label="Username" value={username} onChange={setUsername} placeholder="leela.admin" />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
          {password.length > 0 && password.length < 8 && (
            <p className="text-xs text-amber-600">At least 8 characters.</p>
          )}
          <Actions>
            <Back onClick={() => setStep(2)} />
            <button
              onClick={createProperty}
              disabled={!step3Ready || busy}
              className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create property'}
            </button>
          </Actions>
        </div>
      )}

      {step === 4 && created && (
        <div className="space-y-4">
          <div className="glass-panel p-6 space-y-3">
            <p className="text-sm font-bold text-gray-900">{created.communityName} is set up.</p>
            <dl className="text-sm space-y-1">
              <Row label="Signs in as" value={created.adminUsername} />
              <Row label="Sees" value={created.modules.join(', ')} />
            </dl>
            <p className="text-xs text-gray-400">
              The password is not shown again — pass it on now if you have not already.
            </p>
          </div>

          <div className="glass-panel p-6 space-y-4">
            <p className="text-sm font-bold text-gray-900">Valet cards</p>
            <p className="text-xs text-gray-400">
              The numbered cards handed to guests. Skippable — you can print more any time
              from Cards.
            </p>
            <div className="flex items-end gap-3">
              <Field label="Prefix" value={cardPrefix} onChange={setCardPrefix} width="w-20" />
              <Field label="From" value={cardFrom} onChange={setCardFrom} width="w-24" />
              <Field label="To" value={cardTo} onChange={setCardTo} width="w-24" />
              <button
                onClick={makeCards}
                disabled={busy || cardsMade !== null}
                className="px-4 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50"
              >
                {busy ? 'Creating…' : 'Create cards'}
              </button>
            </div>
            {cardsMade !== null && (
              <p className="text-sm text-teal-600 font-medium">{cardsMade} cards created.</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => router.push('/valet')}
              className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl"
            >
              Go to the valet stand
            </button>
            <button
              onClick={() => router.push('/valet/staff')}
              className="px-5 py-2.5 text-sm font-bold text-gray-600 rounded-xl ring-1 ring-gray-300"
            >
              Add valet staff
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text', width = 'w-full',
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; width?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`input-glow ${width} px-4 py-2.5 text-sm`}
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-gray-400 w-28">{label}</dt>
      <dd className="font-mono text-gray-900">{value}</dd>
    </div>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-3 pt-2">{children}</div>;
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="px-5 py-2.5 text-sm font-bold text-gray-600 rounded-xl ring-1 ring-gray-300">
      Back
    </button>
  );
}

function Next({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50"
    >
      Next
    </button>
  );
}
