"use client";

/**
 * Floating detail sheet — modern bottom sheet / centered modal.
 */
import { useEffect } from "react";
import { X } from "lucide-react";

export default function OverviewDetailSheet({
  open,
  title,
  subtitle,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="关闭"
        onClick={onClose}
      />
      <div
        className={`ov-sheet ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[90vh] sm:max-h-[86vh]`}
      >
        {/* drag hint on mobile */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-0.5">
          <span className="w-10 h-1 rounded-full bg-border" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-3 sm:pt-5 pb-4 border-b border-border/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground tracking-tight truncate">
              {title}
            </h2>
            {subtitle && (
              <p className="text-xs text-fog mt-1 truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-1 rounded-xl text-fog hover:text-foreground hover:bg-secondary transition-colors shrink-0"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-5 text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
