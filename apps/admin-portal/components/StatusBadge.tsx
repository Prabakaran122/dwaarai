interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'dot';
}

const colorMap: Record<string, string> = {
  online: 'bg-green-100 text-green-800',
  offline: 'bg-red-100 text-red-800',
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
  allow: 'bg-green-100 text-green-800',
  allowed: 'bg-green-100 text-green-800',
  deny: 'bg-red-100 text-red-800',
  denied: 'bg-red-100 text-red-800',
  guard_review: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-yellow-100 text-yellow-800',
  expired: 'bg-orange-100 text-orange-800',
  permanent: 'bg-blue-100 text-blue-800',
  temporary: 'bg-purple-100 text-purple-800',
};

const dotColorMap: Record<string, string> = {
  online: 'bg-green-500',
  offline: 'bg-red-500',
  active: 'bg-green-500',
  inactive: 'bg-gray-400',
};

export default function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  if (!status) return <span className="text-xs text-gray-400">-</span>;
  const key = status.toLowerCase();
  const colors = colorMap[key] || 'bg-gray-100 text-gray-800';

  if (variant === 'dot') {
    const dotColor = dotColorMap[key] || 'bg-gray-400';
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className="text-sm capitalize">{status}</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${colors}`}>
      {status}
    </span>
  );
}
