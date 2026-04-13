interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'dot';
}

const statusConfig: Record<string, { color: string; bg: string }> = {
  online: { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  active: { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  allow: { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  allowed: { color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  offline: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)' },
  deny: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)' },
  denied: { color: '#dc2626', bg: 'rgba(220,38,38,0.06)' },
  guard_review: { color: '#d97706', bg: 'rgba(217,119,6,0.06)' },
  pending: { color: '#d97706', bg: 'rgba(217,119,6,0.06)' },
  expired: { color: '#9a3412', bg: 'rgba(154,52,18,0.06)' },
  permanent: { color: '#0d9488', bg: 'rgba(13,148,136,0.06)' },
  temporary: { color: '#7c3aed', bg: 'rgba(124,58,237,0.06)' },
  inactive: { color: '#6b7280', bg: 'rgba(107,114,128,0.06)' },
  degraded: { color: '#d97706', bg: 'rgba(217,119,6,0.06)' },
};

const defaultConfig = { color: '#6b7280', bg: 'rgba(107,114,128,0.06)' };

export default function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  const config = statusConfig[status?.toLowerCase()] || defaultConfig;
  const label = status?.replace(/_/g, ' ') || 'unknown';

  if (variant === 'dot') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: config.color }}
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
      }}
    >
      {label}
    </span>
  );
}
