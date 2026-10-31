'use client';

import { useCallback, useEffect, useState } from 'react';
import FaceCapture from '@/components/FaceCapture';
import {
  ValetError, StaffMember, StaffRole, STAFF_ROLE_LABEL, Shift, SHIFT_REASON_LABEL,
  listStaff, addStaff, retireStaff, enrolStaffFace, faceStatus, listShifts, editStaff, resetStaffPin,
  downloadShiftsCsv, dayRangeToInstants,
} from '@/lib/valet';

/**
 * Who works the valet stand, and who is on it right now.
 *
 * One list rather than a permanent roster and a separate temps tab: surge
 * staff brought in for a banquet are the same kind of record with an end date,
 * and splitting them would mean asking "who is on shift" twice.
 *
 * The shift half of this screen is new, and it is the half that makes the
 * other half honest. Face verification has run at every shift start for weeks
 * and the result was handed to the app and dropped, so "who was on duty when
 * that car went missing" had no answer anywhere. It does now.
 */

/** "8:58 AM" — how an attendant reads a clock, not an ISO string. */
function clock(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "6:04 PM, yesterday" — the day only when it is not today. */
function clockWithDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const time = clock(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return time;

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `${time}, yesterday`;

  return `${time}, ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
}

/** "4h 32m" — a length somebody can act on, never raw seconds. */
function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-3 min-w-[110px]">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
    </div>
  );
}

/**
 * What the Today column says about one person.
 *
 * Three states, kept apart on purpose: on duty now, off duty, and on the
 * roster with no Face ID. The third is not a worse version of the second —
 * it means their shifts are recorded without anyone verifying who signed in,
 * which is a gap in the audit trail rather than a gap in the rota.
 */
function TodayCell({ member }: { member: StaffMember }) {
  // On duty wins, always, and is checked first.
  //
  // The redesign's third state is "Can't start shift", on the assumption that
  // Face ID gates sign-in. It does not -- /shift/start never blocks, because
  // stranding a real attendant in bad light is the worse failure -- and
  // checking enrolment first put "Can't start shift" against somebody who was
  // on shift at that moment. A badge that contradicts the shift log is worse
  // than no badge.
  if (member.onShift) {
    return (
      <>
        <span className="inline-block rounded-full bg-teal-100 text-teal-800 text-xs font-semibold px-2.5 py-1">
          ● On shift
        </span>
        <p className="text-xs text-gray-500 mt-1">In at {clock(member.shiftStartedAt)}</p>
      </>
    );
  }
  if (!member.faceEnrolled) {
    // Not "can't work" -- they can, and the shift is recorded unverified.
    // What a manager needs to know is that the audit trail will be thin.
    return (
      <>
        <span className="inline-block rounded-full bg-amber-100 text-amber-800 text-xs font-semibold px-2.5 py-1">
          ● No Face ID
        </span>
        <p className="text-xs text-gray-500 mt-1">Shifts start unverified</p>
      </>
    );
  }
  return (
    <>
      <span className="inline-block rounded-full bg-gray-100 text-gray-600 text-xs font-semibold px-2.5 py-1">
        ● Off shift
      </span>
      <p className="text-xs text-gray-500 mt-1">
        {member.lastEndedAt ? `Last out ${clockWithDay(member.lastEndedAt)}` : 'No shifts yet'}
      </p>
    </>
  );
}

function ShiftLog({ staff }: { staff: StaffMember[] }) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [days, setDays] = useState(7);
  // The design's two narrowings. "Who was on the banquet entrance last
  // Saturday" is what this screen is opened to answer, and a rolling window
  // cannot be bent into a date.
  const [staffId, setStaffId] = useState('');
  const [day, setDay] = useState('');
  const range = dayRangeToInstants(day, day);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listShifts(days, staffId, range)
      .then((r) => { if (!cancelled) { setShifts(r.shifts); setError(null); } })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ValetError ? err.message : 'Could not load the shift log');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `range` is rebuilt every render, so the day string is the dependency.
  }, [days, staffId, day]);

  return (
    <div>
      <div className="flex gap-2 mb-4 items-center">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => { setDay(''); setDays(d); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
              days === d && !range
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            Last {d} days
          </button>
        ))}

        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="A single day"
          className="input-glow px-2.5 py-1.5 text-xs"
        />

        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          aria-label="Staff member"
          className="input-glow px-2.5 py-1.5 text-xs"
        >
          <option value="">Everyone</option>
          {staff.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <button
          onClick={() => { downloadShiftsCsv(days, staffId, range).catch(() => {}); }}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 border border-gray-200 bg-white"
        >
          Download CSV
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">
            {/* A filtered-to-nothing result is not the same as a quiet week,
                and reading it as one is how somebody concludes a valet never
                turned up. */}
            {staffId || range
              ? 'No shifts match those filters.'
              : 'No shifts recorded in this period.'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            A shift is recorded when somebody signs in to the valet app.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Name and role</th>
                <th className="text-left font-semibold px-4 py-2.5">In time</th>
                <th className="text-left font-semibold px-4 py-2.5">Out time</th>
                <th className="text-left font-semibold px-4 py-2.5">Time on shift</th>
                <th className="text-left font-semibold px-4 py-2.5">Valet point</th>
                <th className="text-left font-semibold px-4 py-2.5">Verified by</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-gray-900">{s.name}</p>
                    <p className="text-xs text-gray-500">{STAFF_ROLE_LABEL[s.role] ?? s.role}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{clockWithDay(s.startedAt)}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {s.endedAt ? clockWithDay(s.endedAt) : (
                      <span className="text-teal-700 font-semibold">Still on shift</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {duration(s.secondsOnShift)}{s.endedAt ? '' : ' so far'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {s.valetPoint ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {s.verifiedBy === 'face_id' ? (
                      <span className="text-gray-600">Face ID</span>
                    ) : (
                      /* Amber, not blank. A shift that began without a verified
                         face is the row somebody needs to see, and the reason
                         decides whether it is about the person or the setup. */
                      <span className="text-amber-700 text-xs font-semibold">
                        {/* Never the raw value. An unlabelled reason is a
                            code we forgot to translate, and "low_light" in a
                            venue's shift log reads as a fault in the product.
                            The code stays in the tooltip for support. */}
                        <span title={s.reason ?? undefined}>
                          {(s.reason && SHIFT_REASON_LABEL[s.reason]) || 'Not verified'}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* The design's second attendance prompt, and it belongs on this tab
          rather than only on Team: a manager who has just read a shift log is
          the one thinking about late marks and monthly totals. Lighter than the
          Team panel on purpose -- the same pitch twice at full weight is an
          advert, not a suggestion. */}
      <div className="mt-6 rounded-xl bg-sky-50 ring-1 ring-sky-200 p-4 flex items-center justify-between gap-5">
        <p className="text-sm text-sky-900">
          Need late marks, overtime, monthly totals, or attendance for housekeeping and front
          office too? That&apos;s <span className="font-semibold">Dwaar AI Attendance</span>.
        </p>
        <a
          href="https://dwaarai.com/book-a-demo.html"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-[#0D2535]"
        >
          See what&apos;s included
        </a>
      </div>
    </div>
  );
}

export default function ValetStaffPage() {
  const [tab, setTab] = useState<'team' | 'log'>('team');

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<StaffRole>('valet');
  const [until, setUntil] = useState('');

  /* Who is being edited inline. Null means nobody. */
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<StaffRole>('valet_manager');
  const [editUntil, setEditUntil] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinNotice, setPinNotice] = useState<string | null>(null);

  /* Who the camera is open for. Null means it is closed. */
  const [enrolling, setEnrolling] = useState<StaffMember | null>(null);
  /* Whether a recogniser exists at all. Null while we are still asking. */
  const [faceReady, setFaceReady] = useState<boolean | null>(null);

  useEffect(() => {
    faceStatus()
      .then((s) => setFaceReady(s.configured))
      .catch(() => setFaceReady(false));
  }, []);

  const load = useCallback(async () => {
    try {
      setStaff((await listStaff()).staff);
      setError(null);
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not reach the valet service');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onAdd() {
    setBusy(true);
    setError(null);
    try {
      await addStaff({
        name: name.trim(), mobile: mobile.trim(), password: pin.trim(), role,
        until: role === 'temporary_driver' && until ? new Date(until).toISOString() : undefined,
      });
      setName(''); setMobile(''); setPin(''); setUntil('');
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not add them');
    } finally {
      setBusy(false);
    }
  }

  async function onCaptured(base64: string) {
    const member = enrolling;
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await enrolStaffFace(member.id, base64);
      setEnrolling(null);
      await load();
    } catch (err) {
      setEnrolling(null);
      setError(err instanceof ValetError ? err.message : 'Could not enrol that photo');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m: StaffMember) {
    setEditing(m);
    setEditName(m.name);
    setEditRole(m.role);
    setEditUntil(m.until ? new Date(m.until).toISOString().slice(0, 10) : '');
    setNewPin('');
    setPinNotice(null);
  }

  async function onResetPin() {
    if (!editing) return;
    setBusy(true); setError(null); setPinNotice(null);
    try {
      await resetStaffPin(editing.id, newPin.trim());
      setNewPin('');
      setPinNotice(`New PIN saved. ${editing.name} signs in with their mobile number and this PIN.`);
    } catch (err) {
      setPinNotice(err instanceof ValetError ? err.message : 'Could not set that PIN');
    } finally {
      setBusy(false);
    }
  }

  async function onSaveEdit() {
    if (!editing) return;
    setBusy(true); setError(null);
    try {
      await editStaff(editing.id, {
        name: editName.trim(),
        role: editRole,
        // Explicit null clears it; the field being empty is a deliberate
        // "no end date", not an omission.
        until: editUntil ? new Date(editUntil).toISOString() : null,
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not save those changes');
    } finally {
      setBusy(false);
    }
  }

  async function onRetire(m: StaffMember) {
    setBusy(true);
    try {
      await retireStaff(m.id);
      await load();
    } catch (err) {
      setError(err instanceof ValetError ? err.message : 'Could not remove their access');
    } finally {
      setBusy(false);
    }
  }

  const expired = staff.filter((m) => m.expired);
  const unenrolled = staff.filter((m) => !m.faceEnrolled);
  const onShiftNow = staff.filter((m) => m.onShift).length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between gap-6 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Staff and shifts</h1>
          <p className="text-sm text-gray-500">
            People who can use the valet app at this property, and who is on duty right now.
          </p>
        </div>
        <div className="flex gap-3 shrink-0">
          <StatCard label="On shift now" value={onShiftNow} />
          <StatCard label="Active staff" value={staff.length} />
        </div>
      </div>

      <div className="flex gap-6 border-b border-gray-200 mb-6">
        {([['team', 'Team'], ['log', 'Shift log']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2.5 text-sm font-semibold border-b-2 -mb-px ${
              tab === key
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'log' ? <ShiftLog staff={staff} /> : (
        <>
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
              {error}
            </div>
          )}

          {unenrolled.length > 0 && faceReady !== false && (
            /* Named, because "4 people" sends a manager hunting down the table
               for who. Worded as what is actually true: they can work, and the
               record of who was on duty will not be verified. */
            <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 flex items-center gap-3">
              <span className="text-amber-600 text-base leading-none shrink-0" aria-hidden>&#9888;</span>
              <span className="text-amber-800 text-sm flex-1">
                <strong>
                  {unenrolled.length} {unenrolled.length === 1 ? 'person has' : 'people have'} no Face ID.
                </strong>{' '}
                {unenrolled.map((m) => m.name).join(', ')} can still work, but their shifts are
                recorded without verifying who signed in.
              </span>
              <button
                onClick={() => setEnrolling(unenrolled[0])}
                disabled={busy || faceReady === null}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 text-xs font-semibold disabled:opacity-40"
              >
                Set up Face ID
              </button>
            </div>
          )}

          {expired.length > 0 && (
            /* Shown rather than filtered away: a temp still on the list after the
               event is exactly the thing somebody needs to notice. */
            <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 text-amber-800 text-sm ring-1 ring-amber-200">
              {expired.length} temporary {expired.length === 1 ? 'driver is' : 'drivers are'} past
              their end date and can still sign in.
            </div>
          )}

          {faceReady === false && (
            /* The button used to be offered whatever the deployment looked like,
               and every press ended in a 503. Saying so once is kinder than
               letting somebody discover it per person. */
            <div className="mb-4 px-4 py-3 rounded-lg bg-gray-50 text-gray-600 text-sm ring-1 ring-gray-200">
              Face recognition is not configured on this deployment, so nobody can be
              enrolled and shift-start checks will be skipped.
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
            <p className="text-sm font-semibold text-gray-900 mb-3">Add a staff member</p>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Full name</label>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ravi Kumar" className="input-glow w-full px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mobile number</label>
                <input value={mobile} onChange={(e) => setMobile(e.target.value)}
                  placeholder="10-digit mobile" className="input-glow w-full px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">4-digit app PIN</label>
                <input value={pin} onChange={(e) => setPin(e.target.value)} type="password"
                  className="input-glow w-full px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}
                  className="input-glow w-full px-3 py-2 text-sm">
                  {Object.entries(STAFF_ROLE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Access ends (optional)</label>
                <input value={until} onChange={(e) => setUntil(e.target.value)} type="date"
                  className="input-glow w-full px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-gray-500">
                After adding, set up their Face ID. The valet app uses it to start and end every shift.
              </p>
              <button onClick={onAdd} disabled={busy || !name.trim() || !mobile.trim() || !pin.trim()}
                className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
                Add staff
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : staff.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <p className="text-sm text-gray-500">Nobody can sign into the valet app yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2.5">Name and role</th>
                    <th className="text-left font-semibold px-4 py-2.5">Mobile</th>
                    <th className="text-left font-semibold px-4 py-2.5">Today</th>
                    <th className="text-left font-semibold px-4 py-2.5">Face ID</th>
                    <th className="text-left font-semibold px-4 py-2.5">Access ends</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((m) => (
                    <tr key={m.id} className="border-t border-gray-100 align-top">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{m.name}</p>
                        <p className="text-xs text-gray-500">{STAFF_ROLE_LABEL[m.role]}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600">{m.mobile}</td>
                      <td className="px-4 py-3"><TodayCell member={m} /></td>
                      <td className="px-4 py-3">
                        {m.faceEnrolled ? (
                          <span className="text-teal-700 text-xs font-semibold">✓ Enrolled</span>
                        ) : faceReady === false ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <button onClick={() => setEnrolling(m)} disabled={busy || faceReady === null}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold disabled:opacity-40">
                            Set up Face ID
                          </button>
                        )}
                      </td>
                      <td className={`px-4 py-3 ${m.expired ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>
                        {m.until ? new Date(m.until).toLocaleDateString([], {
                          day: 'numeric', month: 'short', year: 'numeric',
                        }) : 'No end date'}
                        {m.expired ? ' (past)' : ''}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={() => startEdit(m)} disabled={busy}
                          className="text-xs font-semibold text-gray-600 hover:text-gray-900 disabled:opacity-40 mr-3">
                          Edit
                        </button>
                        <button onClick={() => onRetire(m)} disabled={busy}
                          className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-40">
                          Remove access
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* The design's closing panel. It sits under the roster rather than
              beside it: a manager who has just read "nobody has Face ID" is in
              exactly the frame of mind where attendance for the rest of the
              property is a real thought, and nowhere earlier on the page is. */}
          <div className="mt-6 rounded-xl bg-[#17364a] p-6 flex items-start gap-5">
            <div className="flex-1">
              <p className="text-base font-bold text-white">
                Track attendance for your whole property, not just valets
              </p>
              <p className="text-sm text-white/70 mt-1 max-w-xl">
                This page shows valet sign-ins only. Dwaar AI Attendance adds face-based
                check-in for every department, shift rosters, late and overtime rules, leave,
                and payroll-ready monthly reports.
              </p>
            </div>
            <a
              href="https://dwaarai.com/book-a-demo.html"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 px-4 py-2 rounded-lg border border-white/30 text-white text-sm font-semibold hover:bg-white/10"
            >
              Book a demo
            </a>
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <p className="text-base font-bold text-gray-900 mb-1">Edit {editing.name}</p>
            <p className="text-xs text-gray-500 mb-4">
              Their mobile number is how they sign in and cannot be changed here.
            </p>

            <label className="block text-xs text-gray-500 mb-1">Full name</label>
            <input value={editName} onChange={(e) => setEditName(e.target.value)}
              className="input-glow w-full px-3 py-2 text-sm mb-4" />

            <label className="block text-xs text-gray-500 mb-1">Role</label>
            <select value={editRole} onChange={(e) => setEditRole(e.target.value as StaffRole)}
              className="input-glow w-full px-3 py-2 text-sm mb-4">
              {Object.entries(STAFF_ROLE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>

            <label className="block text-xs text-gray-500 mb-1">Access ends</label>
            <input value={editUntil} onChange={(e) => setEditUntil(e.target.value)} type="date"
              className="input-glow w-full px-3 py-2 text-sm" />
            <p className="text-xs text-gray-400 mt-1 mb-5">
              Leave blank for no end date.
            </p>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-5">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Forgot their PIN?</label>
              <p className="text-xs text-gray-500 mb-2">
                PINs are stored scrambled, so the old one can&apos;t be shown. Set a new one and tell them.
              </p>
              <div className="flex gap-2">
                <input value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\s/g, ''))}
                  inputMode="numeric" maxLength={12} placeholder="New 4-digit PIN"
                  className="input-glow flex-1 px-3 py-2 text-sm" />
                <button onClick={onResetPin} disabled={busy || newPin.trim().length < 4}
                  className="px-4 py-2 text-sm font-semibold border border-gray-300 bg-white rounded-lg disabled:opacity-40">
                  Reset PIN
                </button>
              </div>
              {pinNotice && <p className="text-xs text-gray-600 mt-2">{pinNotice}</p>}
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setEditing(null)} disabled={busy}
                className="px-4 py-2 text-sm font-semibold text-gray-600">
                Cancel
              </button>
              <button onClick={onSaveEdit} disabled={busy || !editName.trim()}
                className="px-5 py-2 text-sm font-bold bg-amber-500 text-white rounded-lg disabled:opacity-40">
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {enrolling && (
        <FaceCapture
          name={enrolling.name}
          busy={busy}
          onCapture={onCaptured}
          onCancel={() => setEnrolling(null)}
        />
      )}
    </div>
  );
}
