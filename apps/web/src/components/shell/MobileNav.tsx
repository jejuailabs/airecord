'use client';

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { SidebarBody, type SidebarUsage, type SidebarAccount } from './AppSidebar';

/**
 * 모바일 네비게이션 — 상단바의 햄버거 버튼 + 슬라이드 드로어.
 *
 * 데스크톱 사이드바(`lg:flex`)는 좁은 화면에서 숨는다. 그래서 여기서만 보이고(`lg:hidden`),
 * 드로어는 데스크톱과 **같은 SidebarBody**를 그린다 — 메뉴를 두 벌로 두지 않는다.
 *
 * 닫힘: 항목 클릭 · 배경 클릭 · X · Esc.
 */
export function MobileNav({
  usage,
  account,
  isAdmin,
}: {
  usage?: SidebarUsage;
  account?: SidebarAccount;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // 열려 있는 동안 배경 스크롤을 막고, Esc로 닫는다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="메뉴 열기"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-bg-sunken lg:hidden"
      >
        <Menu size={20} aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* 배경 — 누르면 닫힌다 */}
          <button
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          {/* 드로어 — 데스크톱 사이드바와 같은 폭·색 */}
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-white/5 bg-caption-bg shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="메뉴 닫기"
              className="absolute right-3 top-5 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-caption-source hover:bg-white/[.06]"
            >
              <X size={18} aria-hidden />
            </button>
            <SidebarBody
              usage={usage}
              account={account}
              isAdmin={isAdmin}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
