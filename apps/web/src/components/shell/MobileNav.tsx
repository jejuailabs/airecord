'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';
import { SidebarBody, type SidebarUsage, type SidebarAccount } from './AppSidebar';

/**
 * 모바일 네비게이션 — 상단바의 햄버거 버튼 + 왼쪽 슬라이드 드로어.
 *
 * 데스크톱 사이드바(`lg:flex`)는 좁은 화면에서 숨는다. 그래서 여기서만 보이고(`lg:hidden`),
 * 드로어는 데스크톱과 **같은 SidebarBody**를 그린다 — 메뉴를 두 벌로 두지 않는다.
 *
 * ⚠ 오버레이는 반드시 **document.body에 포털**로 띄운다.
 *   상단바 <header>에 backdrop-blur가 걸려 있어, 그 안에서 `fixed`를 쓰면
 *   화면 전체가 아니라 헤더(72px) 기준으로 갇힌다(실측: 드로어가 헤더만 덮고 뒤가 비쳤다).
 *   backdrop-blur·transform·filter는 fixed의 컨테이닝 블록을 만든다 — 포털로 빠져나가야 한다.
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
  const [mounted, setMounted] = useState(false);

  // 포털은 document가 있어야 한다 — 마운트 후에만 그린다(SSR 안전)
  useEffect(() => setMounted(true), []);

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

  const overlay =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[100] lg:hidden">
            {/* 배경 딤 — 누르면 닫힌다 */}
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setOpen(false)}
              className="absolute inset-0 h-full w-full bg-black/60"
            />
            {/* 드로어 — 데스크톱 사이드바와 같은 폭·색(딥 네이비), 화면 전체 높이 */}
            <div className="absolute inset-y-0 left-0 flex h-full w-72 max-w-[82vw] flex-col border-r border-white/5 bg-caption-bg shadow-2xl">
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
          </div>,
          document.body,
        )
      : null;

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
      {overlay}
    </>
  );
}
