interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  tone: "obsidian" | "gold" | "emerald" | "ruby";
  onClick?: () => void;
  active?: boolean;
}

export function MetricCard({
  label,
  value,
  detail,
  tone,
  onClick,
  active = false
}: MetricCardProps) {
  const className = `metric-card metric-card--${tone}${onClick ? " is-clickable" : ""}${active ? " is-active" : ""}`;

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span className="metric-card__label">{label}</span>
        <strong className="metric-card__value">{value}</strong>
        <span className="metric-card__detail">{detail}</span>
      </button>
    );
  }

  return (
    <article className={className}>
      <span className="metric-card__label">{label}</span>
      <strong className="metric-card__value">{value}</strong>
      <span className="metric-card__detail">{detail}</span>
    </article>
  );
}
