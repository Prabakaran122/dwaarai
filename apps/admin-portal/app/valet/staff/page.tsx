'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ValetError, StaffMember, StaffRole, STAFF_ROLE_LABEL,
  listStaff, addStaff, retireStaff, enrolStaffFace,
} from '@/lib/valet';

/**
 * Who works the valet stand.
 *
 * One list rather than a permanent roster and a separate temps tab: surge
 * staff brought in for a banquet are the same kind of record with an end date,
 * and splitting them would mean asking "who is on shift" twice.
 */
export default function ValetStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<StaffRole>('valet_manager');
  const [until, setUntil] = useState('');

  /* The picker is one hidden input reused by every row: which row is being
     enrolled is held here, so a click lands on the person clicked rather than
     whichever row rendered last. */
  const filePicker = useRef<HTMLInputElement>(null);
  const enrolling = useRef<string | null>(null);

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

  function onEnrol(m: StaffMember) {
    enrolling.current = m.id;
    filePicker.current?.click();
  }

  async function onPhotoChosen(file: File | undefined) {
    const id = enrolling.current;
    enrolling.current = null;
    if (filePicker.current) filePicker.current.value = '';
    if (!file || !id) return;

    setBusy(true);
    setError(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        // The data: prefix is metadata for the browser, not part of the image.
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('unreadable'));
        reader.readAsDataURL(file);
      });
      await enrolStaffFace(id, b64);
      await load();
    } catch (err) {
      setError(
        err instanceof ValetError
          ? err.message
          : 'Could not read that photo'
      );
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
      setError(err instanceof ValetError ? err.message : 'Could not retire them');
    } finally {
      setBusy(false);
    }
  }

  const expired = staff.filter((m) => m.expired);
  const unenrolled = staff.filter((m) => !m.faceEnrolled);

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Staff</h1>
      <p className="text-sm text-gray-500 mb-6">
        Everyone who can sign into the valet app at this property.
      </p>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm ring-1 ring-red-200">
          {error}
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

      {unenrolled.length > 0 && (
        /* Worth surfacing here rather than leaving to be discovered at 6am:
           somebody without a face on file cannot start a shift. */
        <div className="mb-4 px-4 py-3 rounded-lg bg-blue-50 text-blue-800 text-sm ring-1 ring-blue-200">
          {unenrolled.length === 1
            ? `${unenrolled[0].name} has no face on file and cannot start a shift.`
            : `${unenrolled.length} people have no face on file and cannot start a shift.`}
        </div>
      )}

      <input
        ref={filePicker}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => onPhotoChosen(e.target.files?.[0])}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Add someone</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-500">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-44 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-gray-500">
            Mobile
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric"
              placeholder="9876543210"
              className="mt-1 block w-36 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono" />
          </label>
          <label className="text-xs text-gray-500">
            PIN
            <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric"
              className="mt-1 block w-24 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm font-mono" />
          </label>
          <label className="text-xs text-gray-500">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}
              className="mt-1 block w-44 rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm">
              <option value="valet_manager">Valet manager</option>
              <option value="temporary_driver">Temporary driver</option>
            </select>
          </label>
          {role === 'temporary_driver' && (
            <label className="text-xs text-gray-500">
              Until
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
                className="mt-1 block rounded-lg ring-1 ring-gray-300 px-3 py-2 text-sm" />
            </label>
          )}
          <button onClick={onAdd} disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40">
            Add
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
                <th className="text-left font-semibold px-4 py-2.5">Name</th>
                <th className="text-left font-semibold px-4 py-2.5">Mobile</th>
                <th className="text-left font-semibold px-4 py-2.5">Role</th>
                <th className="text-left font-semibold px-4 py-2.5">Until</th>
                <th className="text-left font-semibold px-4 py-2.5">Face</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{m.name}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{m.mobile}</td>
                  <td className="px-4 py-2.5 text-gray-600">{STAFF_ROLE_LABEL[m.role]}</td>
                  <td className={`px-4 py-2.5 ${m.expired ? 'text-amber-700 font-semibold' : 'text-gray-500'}`}>
                    {m.until ? new Date(m.until).toISOString().slice(0, 10) : '—'}
                    {m.expired ? ' (past)' : ''}
                  </td>
                  <td className="px-4 py-2.5">
                    {m.faceEnrolled ? (
                      <span className="text-gray-500">On file</span>
                    ) : (
                      <button onClick={() => onEnrol(m)} disabled={busy}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40">
                        Add photo
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onRetire(m)} disabled={busy}
                      className="text-xs font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40">
                      Retire
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
