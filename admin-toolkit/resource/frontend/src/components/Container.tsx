import type { ReactNode } from 'react';

interface ContainerProps {
  children: ReactNode;
  className?: string;
  ultraWide?: boolean;
}

export function Container({ children, className = '', ultraWide = false }: ContainerProps) {
  const maxWidthClass = ultraWide ? 'max-w-[2200px]' : 'max-w-[1600px]';

  return (
    <div className={`w-full ${maxWidthClass} mx-auto px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}
