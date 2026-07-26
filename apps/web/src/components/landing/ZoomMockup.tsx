'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bot, MessageSquare, Volume2, VolumeX } from 'lucide-react';
import { useDemoPlayback } from '@/hooks/useDemoPlayback';

const TILE_COLORS = ['#3B5BDB', '#B23B72', '#8A6D1F'] as const;

/**
 * 화상회의 목업 — 직접 체험하기 어려운 "줌 회의 실시간 번역"을
 * 랜딩에서 그대로 보여준다: 봇 참가자, 채팅에 게시된 자막 링크, 하단 실시간 자막 바.
 */
export function ZoomMockup() {
  const t = useTranslations('landing.zoom');
  const [voiceOn, setVoiceOn] = useState(false);
  const segments = useDemoPlayback(voiceOn);
  const current = segments[segments.length - 1];

  const speakers = [
    { name: '김민준', initial: 'K' },
    { name: 'Sarah', initial: 'S' },
    { name: '田中', initial: 'T' },
  ];

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-caption-bg shadow-token">
      {/* 창 크롬 */}
      <div className="flex h-10 items-center gap-2 border-b border-white/5 px-4">
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger opacity-70" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warn opacity-70" />
        <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-accent opacity-70" />
        <span className="ml-2 text-[12px] text-caption-source">{t('windowTitle')}</span>
        <span className="tabular ml-auto text-[12px] text-caption-source">42:10</span>
      </div>

      <div className="relative p-4">
        {/* 참가자 타일 */}
        <div className="grid grid-cols-2 gap-2">
          {speakers.map((sp, i) => {
            const speaking = current?.line.speaker === sp.name && !current.done;
            return (
              <div
                key={sp.name}
                className={`relative flex aspect-video items-center justify-center rounded-md bg-white/5 transition-shadow duration-150 ${
                  speaking ? 'ring-2 ring-[color:var(--accent)]' : ''
                }`}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[15px] font-bold text-white/90 sm:h-11 sm:w-11 sm:text-[17px]"
                  style={{ backgroundColor: TILE_COLORS[i % TILE_COLORS.length] }}
                >
                  {sp.initial}
                </span>
                <span className="absolute bottom-1.5 left-2 max-w-[80%] truncate text-[10px] text-caption-source sm:text-[11px]">
                  {sp.name}
                </span>
                {speaking ? (
                  <span
                    aria-hidden
                    className="live-dot absolute right-2 top-2 h-2 w-2 rounded-full bg-accent"
                  />
                ) : null}
              </div>
            );
          })}
          {/* 통역 봇 타일 — 봇의 존재를 숨기지 않는다 (docs/08 §2.2) */}
          <div className="relative flex aspect-video flex-col items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent-weak/20">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent sm:h-11 sm:w-11">
              <Bot size={18} aria-hidden className="text-accent-text" />
            </span>
            <span className="text-[10px] font-semibold text-accent sm:text-[11px]">
              {t('botName')}
            </span>
          </div>
        </div>

        {/* 채팅 말풍선 — 봇이 자막 링크를 자동 게시 (docs/04 §4).
            좁은 화면에서는 타일 위에 겹치지 않고 아래로 내려온다. */}
        <div className="mt-2 rounded-md bg-white/[.07] px-3 py-2 md:absolute md:right-6 md:top-6 md:mt-0 md:max-w-[240px] md:backdrop-blur">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-caption-target">
            <MessageSquare size={11} aria-hidden />
            {t('botName')}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-caption-source">
            🌐 {t('chatMessage')}{' '}
            <span className="break-all text-accent">interlive.app/v/x7f3…</span>
          </p>
        </div>

        {/* 하단 실시간 자막 바 */}
        <div className="mt-3 rounded-md bg-black/50 px-4 py-3">
          <p className="min-h-[28px] text-[17px] font-semibold leading-snug text-caption-target">
            {current ? (
              <span className={current.done ? '' : 'caption-caret'}>{current.tgtShown}</span>
            ) : (
              ' '
            )}
          </p>
          <p className="min-h-[18px] text-[12px] text-caption-source">{current?.srcShown ?? ' '}</p>
        </div>

        <button
          onClick={() => setVoiceOn((v) => !v)}
          aria-pressed={voiceOn}
          className={`mt-3 flex h-9 items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-colors duration-150 ${
            voiceOn ? 'bg-accent text-accent-text' : 'bg-white/5 text-caption-source'
          }`}
        >
          {voiceOn ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />}
          {t('voiceToggle')}
        </button>
      </div>
    </div>
  );
}
