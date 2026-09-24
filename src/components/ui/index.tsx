import React from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Info, XCircle } from 'lucide-react';

// Shared primitives of the TeachFlow design system (styles in
// src/styles/teachflow.css). Status is never carried by colour alone: every
// badge has an icon and a text label.

export type Tone = 'pass' | 'fail' | 'warn' | 'info' | 'neutral';

const TONE_ICON: Record<Tone, React.ComponentType<{ 'aria-hidden'?: boolean }>> = {
  pass: CheckCircle2,
  fail: XCircle,
  warn: AlertTriangle,
  info: Info,
  neutral: CircleDashed,
};

export function StatusBadge({ tone, children, icon }: { tone: Tone; children: React.ReactNode; icon?: 'clock' }) {
  const Icon = icon === 'clock' ? Clock : TONE_ICON[tone];
  return (
    <span className="tf-badge" data-tone={tone}>
      <Icon aria-hidden />
      {children}
    </span>
  );
}

export function Notice({ tone = 'warn', title, children, role }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className="tf-notice" data-tone={tone === 'fail' ? 'error' : tone} role={role}>
      {title && <strong style={{ display: 'block' }}>{title}</strong>}
      {children}
    </div>
  );
}

export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="tf-empty">
      <p style={{ margin: 0 }}>{children}</p>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="tf-page-header">
      <div style={{ minInlineSize: 0 }}>
        {eyebrow && <p className="tf-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="tf-actions">{actions}</div>}
    </header>
  );
}

export function Field({ label, children, error, hint }: { label: string; children: React.ReactNode; error?: string | null; hint?: string }) {
  return (
    <label className="tf-field">
      <span>{label}</span>
      {children}
      {hint && <span>{hint}</span>}
      {error && (
        <span className="tf-field-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export interface Stage {
  id: string;
  label: string;
  state: 'done' | 'current' | 'todo';
}

export function StageBar({ stages, label }: { stages: Stage[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ol className="tf-stages">
        {stages.map((s) => (
          <li key={s.id} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Polite live region: announce outcomes of actions, not every keystroke. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="tf-sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}
