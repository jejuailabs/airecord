'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Volume2, VolumeX } from 'lucide-react';
import { useDemoPlayback } from '@/hooks/useDemoPlayback';

/**
 * 히어로 자막 데모 — 체험 버튼을 누르기 전에 이미 제품이 돌아가는 모습이 보인다.
 * 실제 자막 패널 규격(docs/05 §4)을 그대로 축소 재현: 번역문 크게, 원문 흐리게, 타임 레일.
 */
export function LiveCaptionDemo() {
  const t = useTranslations('landing.demo');
  const [voiceOn, setVoiceOn] = useState(false);
  const segments = useDemoPlayback(voiceOn);

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-caption-bg shadow-token">
      {/* 상태 바 */}
      <div className="flex h-11 items-center gap-2 border-b border-white/5 px-4">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-accent">
          <span aria-hidden className="live-dot inline-block h-2 w-2 rounded-full bg-accent" />
          LIVE
        </span>
        <span className="text-[13px] text-caption-source">{t('langPair')}</span>
        <button
          onClick={() => setVoiceOn((v) => !v)}
          aria-pressed={voiceOn}
          className={`ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-colors duration-150 ${
            voiceOn ? 'bg-accent text-accent-text' : 'bg-white/5 text-caption-source'
          }`}
        >
          {voiceOn ? <Volume2 size={13} aria-hidden /> : <VolumeX size={13} aria-hidden />}
          {t('voiceToggle')}
        </button>
      </div>

      {/* 자막 영역 + 타임 레일 */}
      <div className="min-h-[300px] px-5 py-4">
        <div className="relative ml-4 border-l border-[color:var(--caption-source)]/30 pl-4">
          {segments.map((s, i) => (
            <div key={`${s.line.speaker}-${i}`} className="flex flex-col gap-1 py-2.5">
              <span className="text-[11px] font-medium text-caption-source">
                {s.line.speaker} · {s.line.srcLang.toUpperCase()}
              </span>
              <p
                className={`text-[19px] font-semibold leading-snug text-caption-target ${
                  s.done ? '' : 'caption-caret'
                }`}
              >
                {s.tgtShown || ' '}
              </p>
              <p className="text-[13px] leading-snug text-caption-source">{s.srcShown}</p>
            </div>
          ))}
          <span
            aria-hidden
            className="live-dot absolute -left-[5px] bottom-1 h-2 w-2 rounded-full bg-accent"
          />
        </div>
      </div>

      <p className="border-t border-white/5 px-4 py-2 text-[11px] text-caption-source">
        {t('autoDetectNote')}
      </p>
    </div>
  );
}
