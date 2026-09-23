import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'pass' | 'warn' | 'fail' | 'demo' | 'info' | 'neutral' | 'superseded';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  let variantClasses = 'bg-gray-100 text-gray-700 border-gray-200';

  switch (variant) {
    case 'pass':
      variantClasses = 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium';
      break;
    case 'warn':
      variantClasses = 'bg-amber-50 text-amber-800 border-amber-200 font-medium';
      break;
    case 'fail':
      variantClasses = 'bg-rose-50 text-rose-800 border-rose-200 font-medium';
      break;
    case 'demo':
      variantClasses = 'bg-indigo-50 text-indigo-800 border-indigo-200 font-semibold tracking-wide';
      break;
    case 'superseded':
      variantClasses = 'bg-amber-100 text-amber-900 border-amber-300 italic';
      break;
    case 'info':
      variantClasses = 'bg-blue-50 text-blue-800 border-blue-200';
      break;
    case 'neutral':
    default:
      variantClasses = 'bg-gray-100 text-gray-700 border-gray-200';
      break;
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border ${sizeClasses} ${variantClasses} ${className}`}
    >
      {children}
    </span>
  );
};
