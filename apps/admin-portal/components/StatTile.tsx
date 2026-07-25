'use client';

import { ReactNode } from 'react';
import { Sparkline } from './charts/Charts';

/**
 * A KPI tile that answers three questions at once: how much (the value),
 * which way (the delta vs the same period yesterday), and what shape (a week
 * of sparkline). The old tiles showed only a bare number, which tells an RWA
 * manager nothing about whether 128 entries is a busy day or a quiet one.
 */

interface StatTileProps {
  label: string;
  value: number | string;
  prev?: number;               // same measure, previous period — drives the delta
  /** For a rising value: is that good news, bad news, or neither? Denials going
   *  up is bad; entries going up is just traffic. */
  polarity?: 'up-good' | 'up-bad' | 'neutral';
  spark?: number[];
  icon: ReactNode;
  href?: string;
  footnote?: string;
  emphasis?: 'default' | 'alert';
}

export default function StatTile({
  label, value, prev, polarity = 'neutral', spark, icon, href, footnote, emphasis = 'default',
}: StatTileProps) {
  const numeric = typeof value === 'number' ? value : null;
  const hasDelta = prev !== undefined && numeric !== null;
  const diff = hasDelta ? numeric - prev : 0;
  const pct = hasDelta && prev > 0 ? Math.round((diff / prev) * 100) : null;

  // A change is "good" or "bad" only where the measure has a direction. Where
  // it doesn't, the delta stays ink-coloured — colour would imply a judgement.
  const tone =
    !hasDelta || diff === 0 || polarity === 'neutral' ? 'neutral'
      : (diff > 0) === (polarity === 'up-good') ? 'good' : 'bad';

  const toneClass =
    tone === 'good' ? 'text-emerald-700 bg-emerald-50'
      : tone === 'bad' ? 'text-red-700 bg-red-50'
        : 'text-gray-500 bg-gray-100';

  const body = (
    <div
      className={`glass-panel glass-panel-hover p-5 h-full transition-all duration-300 ${
        emphasis === 'alert' && numeric ? 'ring-1 ring-red-200' : ''
      } ${href ? 'hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-gray-500 truncate">{label}</p>
          <p className="text-[28px] leading-tight font-bold text-gray-900 mt-0.5">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
        </div>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            emphasis === 'alert' && numeric ? 'bg-red-50 text-red-600' : 'bg-teal-50 text-teal-600'
          }`}
        >
          {icon}
        </div>
      </div>

      <div className="flex items-end justify-between gap-2 mt-3 min-h-[30px]">
        <div className="flex items-center gap-2 flex-wrap">
          {hasDelta && (
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-semibold ${toneClass}`}>
              {/* An arrow as well as colour — the delta never rests on hue alone. */}
              {diff === 0 ? '—' : diff > 0 ? '▲' : '▼'}
              {diff !== 0 && (pct !== null ? `${Math.abs(pct)}%` : Math.abs(diff))}
            </span>
          )}
          {(footnote || hasDelta) && (
            <span className="text-[11px] text-gray-400">{footnote || 'vs yesterday'}</span>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </div>
    </div>
  );

  return href ? <a href={href} className="block h-full">{body}</a> : body;
}
