interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'dot';
}

const statusConfig: Record<string, { color: string; bg: string; glow: string }> = {
  online: { color: '#34d399', bg: 'rgba(34,197,94,0.15)', glow: 'rgba(34,197,94,0.3)' },
  active: { color: '#34d399', bg: 'rgba(34,197,94,0.15)', glow: 'rgba(34,197,94,0.3)' },
  allow: { color: '#34d399', bg: 'rgba(34,197,94,0.15)', glow: 'rgba(34,197,94,0.3)' },
  allowed: { color: '#34d399', bg: 'rgba(34,197,94,0.15)', glow: 'rgba(34,197,94,0.3)' },
  offline: { color: '#f87171', bg: 'rgba(239,68,68,0.15)', glow: 'rgba(239,68,68,0.3)' },
  deny: { color: '#f87171', bg: 'rgba(239,68,68,0.15)', glow: 'rgba(239,68,68,0.3)' },
  denied: { color: '#f87171', bg: 'rgba(239,68,68,0.15)', glow: 'rgba(239,68,68,0.3)' },
  guard_review: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', glow: 'rgba(251,191,36,0.3)' },
  pending: { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', glow: 'rgba(251,191,36,0.3)' },
  expired: { color: '#fb923c', bg: 'rgba(251,146,60,0.15)', glow: 'rgba(251,146,60,0.3)' },
  permanent: { color: '#818cf8', bg: 'rgba(99,102,241,0.15)', glow: 'rgba(99,102,241,0.3)' },
  temporary: { color: '#c084fc', bg: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.3)' },
  inactive: { color: '#64748b', bg: 'rgba(100,116,139,0.15)', glow: 'rgba(100,116,139,0.2)' },
  degraded: { color: '#fb923c', bg: 'rgba(251,146,60,0.15)', glow: 'rgba(251,146,60,0.3)' },
};

const defaultConfig = { color: '#64748b', bg: 'rgba(100,116,139,0.15)', glow: 'rgba(100,116,139,0.2)' };

export default function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  const config = statusConfig[status?.toLowerCase()] || defaultConfig;
  const label = status?.replace(/_/g, ' ') || 'unknown';

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full animate-pulse-slow"
          style={{ backgroundColor: config.color, boxShadow: `0 0 8px ${config.glow}` }}
        />
        <span className="text-xs font-medium capitalize" style={{ color: config.color }}>
          {label}
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider"
      style={{
        color: config.color,
        backgroundColor: config.bg,
        boxShadow: `0 0 12px ${config.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {label}
    </span>
  );
}
