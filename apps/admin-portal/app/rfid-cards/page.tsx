'use client';

import { useState, useEffect } from 'react';
import { apiFetch, apiPost, apiPut, apiDelete } from '@/lib/api';

interface RFIDCard {
  id: string;
  community_id: string;
  uid_hash: string;
  card_number: string | null;
  issued_to_unit: string | null;
  card_type: string;
  is_active: boolean;
  issued_at: string;
  expires_at: string | null;
  unit_number: string | null;
  community_name: string | null;
}

interface Community {
  id: string;
  name: string;
}

interface Unit {
  id: string;
  unit_number: string;
}

export default function RFIDCardsPage() {
  const [cards, setCards] = useState<RFIDCard[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editCard, setEditCard] = useState<RFIDCard | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('active');

  // Form state
  const [formCommunity, setFormCommunity] = useState('');
  const [formUidHash, setFormUidHash] = useState('');
  const [formCardNumber, setFormCardNumber] = useState('');
  const [formUnit, setFormUnit] = useState('');
  const [formType, setFormType] = useState('resident');
  const [formExpires, setFormExpires] = useState('');

  const fetchCards = async () => {
    try {
      const active = filter === 'all' ? 'false' : filter === 'active' ? 'true' : 'false';
      const res = await apiFetch<{ data: { cards: RFIDCard[] } }>(`/admin/rfid-cards?active=${active}`);
      let fetched = res.data?.cards || [];
      if (filter === 'inactive') {
        fetched = fetched.filter(c => !c.is_active);
      }
      setCards(fetched);
    } catch { setCards([]); }
    finally { setLoading(false); }
  };

  const fetchCommunities = async () => {
    try {
      const res = await apiFetch<{ data: { communities: Community[] } }>('/admin/communities');
      setCommunities(res.data?.communities || []);
    } catch { setCommunities([]); }
  };

  useEffect(() => { fetchCards(); }, [filter]);
  useEffect(() => { fetchCommunities(); }, []);

  const fetchUnits = async (communityId: string) => {
    if (!communityId) { setUnits([]); return; }
    try {
      const res = await apiFetch<{ data: { units: Unit[] } }>(`/units?community_id=${communityId}`);
      setUnits(res.data?.units || []);
    } catch { setUnits([]); }
  };

  const openCreateForm = () => {
    setEditCard(null);
    setFormCommunity(communities[0]?.id || '');
    setFormUidHash('');
    setFormCardNumber('');
    setFormUnit('');
    setFormType('resident');
    setFormExpires('');
    setShowForm(true);
    if (communities[0]?.id) fetchUnits(communities[0].id);
  };

  const openEditForm = (card: RFIDCard) => {
    setEditCard(card);
    setFormCommunity(card.community_id);
    setFormUidHash(card.uid_hash);
    setFormCardNumber(card.card_number || '');
    setFormUnit(card.issued_to_unit || '');
    setFormType(card.card_type);
    setFormExpires(card.expires_at ? card.expires_at.slice(0, 16) : '');
    setShowForm(true);
    fetchUnits(card.community_id);
  };

  const handleSubmit = async () => {
    try {
      if (editCard) {
        await apiPut(`/admin/rfid-cards/${editCard.id}`, {
          card_number: formCardNumber.trim() || undefined,
          issued_to_unit: formUnit || null,
          card_type: formType,
          expires_at: formExpires ? new Date(formExpires).toISOString() : null,
        });
      } else {
        if (!formUidHash.trim() || formUidHash.trim().length !== 64) {
          alert('UID hash must be exactly 64 hex characters');
          return;
        }
        await apiPost('/admin/rfid-cards', {
          community_id: formCommunity,
          uid_hash: formUidHash.trim(),
          card_number: formCardNumber.trim() || undefined,
          issued_to_unit: formUnit || undefined,
          card_type: formType,
          expires_at: formExpires ? new Date(formExpires).toISOString() : undefined,
        });
      }
      setShowForm(false);
      fetchCards();
    } catch (err) {
      alert(editCard ? 'Failed to update card' : 'Failed to create card. UID may already exist.');
    }
  };

  const handleDeactivate = async (card: RFIDCard) => {
    if (!confirm(`Deactivate card ${card.card_number || card.uid_hash.slice(0, 12)}...?`)) return;
    try {
      await apiDelete(`/admin/rfid-cards/${card.id}`);
      fetchCards();
    } catch {
      alert('Failed to deactivate card');
    }
  };

  const handleReactivate = async (card: RFIDCard) => {
    try {
      await apiPut(`/admin/rfid-cards/${card.id}`, { is_active: true });
      fetchCards();
    } catch {
      alert('Failed to reactivate card');
    }
  };

  const typeColors: Record<string, string> = {
    resident: 'bg-emerald-500/20 text-emerald-400',
    visitor: 'bg-purple-500/20 text-purple-400',
    staff: 'bg-amber-500/20 text-amber-400',
    master: 'bg-red-500/20 text-red-400',
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">RFID Cards</h1>
        <div className="text-center text-gray-400 py-12">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">RFID Cards</h1>
        <div className="flex items-center gap-3">
          {/* Filter tabs */}
          <div className="flex glass-panel rounded-xl overflow-hidden">
            {(['active', 'inactive', 'all'] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setLoading(true); setFilter(f); }}
                className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all ${
                  filter === f ? 'bg-glow-primary text-white' : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={openCreateForm}
            className="px-4 py-2 text-sm font-bold bg-glow-primary text-white rounded-xl hover:shadow-lg hover:shadow-teal-600/10 transition-all duration-300"
          >
            + Add Card
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="glass-panel p-12 text-center text-gray-400">
          No {filter === 'all' ? '' : filter} RFID cards found.
        </div>
      ) : (
        <div className="glass-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Card #</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">UID Hash</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Type</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Community</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Unit</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Status</th>
                <th className="text-left text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Expires</th>
                <th className="text-right text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr key={card.id} className="border-b border-white/5 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-800 font-medium">{card.card_number || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{card.uid_hash.slice(0, 16)}...</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-bold uppercase ${typeColors[card.card_type] || 'text-gray-500'}`}>
                      {card.card_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{card.community_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{card.unit_number || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${card.is_active ? 'text-emerald-400' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${card.is_active ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                      {card.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {card.expires_at ? new Date(card.expires_at).toLocaleDateString() : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEditForm(card)}
                        className="text-xs text-teal-600 hover:text-white transition-colors"
                      >
                        Edit
                      </button>
                      {card.is_active ? (
                        <button
                          onClick={() => handleDeactivate(card)}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Revoke
                        </button>
                      ) : (
                        <button
                          onClick={() => handleReactivate(card)}
                          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-panel gradient-border p-6 w-full max-w-md">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editCard ? 'Edit RFID Card' : 'Register RFID Card'}
            </h2>
            <div className="space-y-3">
              {!editCard && (
                <>
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">Community *</label>
                    <select
                      className="input-glow w-full px-4 py-3 text-sm bg-transparent"
                      value={formCommunity}
                      onChange={(e) => { setFormCommunity(e.target.value); setFormUnit(''); fetchUnits(e.target.value); }}
                    >
                      {communities.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">UID Hash (64 hex chars) *</label>
                    <input
                      className="input-glow w-full px-4 py-3 text-sm font-mono"
                      placeholder="SHA-256 hash of card UID"
                      value={formUidHash}
                      onChange={(e) => setFormUidHash(e.target.value)}
                      maxLength={64}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">{formUidHash.length}/64 characters</p>
                  </div>
                </>
              )}
              <div>
                <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">Card Number</label>
                <input
                  className="input-glow w-full px-4 py-3 text-sm"
                  placeholder="e.g. CARD-001"
                  value={formCardNumber}
                  onChange={(e) => setFormCardNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">Card Type</label>
                <select
                  className="input-glow w-full px-4 py-3 text-sm bg-transparent"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                >
                  <option value="resident">Resident</option>
                  <option value="visitor">Visitor</option>
                  <option value="staff">Staff</option>
                  <option value="master">Master</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">Assign to Unit</label>
                <select
                  className="input-glow w-full px-4 py-3 text-sm bg-transparent"
                  value={formUnit}
                  onChange={(e) => setFormUnit(e.target.value)}
                >
                  <option value="">— Not assigned —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.unit_number}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.15em] text-gray-400 font-bold mb-1.5">Expires At</label>
                <input
                  type="datetime-local"
                  className="input-glow w-full px-4 py-3 text-sm"
                  value={formExpires}
                  onChange={(e) => setFormExpires(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 text-sm text-gray-500 glass-panel hover:bg-gray-50 rounded-xl transition-all">Cancel</button>
              <button
                onClick={handleSubmit}
                disabled={!editCard && (!formUidHash.trim() || formUidHash.trim().length !== 64)}
                className="flex-1 py-2.5 text-sm font-bold bg-glow-primary text-white rounded-xl disabled:opacity-50 transition-all hover:shadow-lg hover:shadow-teal-600/10"
              >
                {editCard ? 'Update' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
