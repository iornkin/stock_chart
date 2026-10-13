"use client";
import { useState } from "react";
import NavLinks from "./NavLinks";
import SymbolSearch from "./SymbolSearch";

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="메뉴 열기"
        className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto border-b border-line bg-surface p-4 shadow-xl">
          <div className="mb-3">
            <SymbolSearch onDone={() => setOpen(false)} />
          </div>
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
