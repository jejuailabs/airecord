'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Pencil, X } from 'lucide-react';

/** 세션 제목 인라인 편집 — AI가 붙인 가안도 여기서 고친다 */
export function EditableTitle({
  sessionId,
  initialTitle,
  fromAi,
  placeholder,
}: {
  sessionId: string;
  initialTitle: string;
  fromAi: boolean;
  placeholder: string;
}) {
  const t = useTranslations('sessionDetail');
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/title`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.trim() }),
      });
      if (res.ok) {
        setTitle(draft.trim());
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') {
              setDraft(title);
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          className="h-12 min-w-0 flex-1 rounded-lg border border-border bg-bg-sunken px-3 text-[22px] font-bold"
        />
        <button
          onClick={save}
          disabled={saving}
          aria-label={t('titleSave')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-text"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
        </button>
        <button
          onClick={() => {
            setDraft(title);
            setEditing(false);
          }}
          aria-label={t('titleCancel')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-text-muted"
        >
          <X size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <h1 className="min-w-0 break-keep text-[26px] font-bold leading-tight tracking-tight sm:text-[30px]">
        {title || placeholder}
      </h1>
      <button
        onClick={() => setEditing(true)}
        aria-label={t('titleEdit')}
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-bg-sunken hover:text-text"
      >
        <Pencil size={15} />
      </button>
      {fromAi && title ? (
        <span className="mt-1.5 shrink-0 rounded-sm bg-accent-weak px-1.5 py-0.5 text-[11px] font-semibold text-accent">
          {t('titleAi')}
        </span>
      ) : null}
    </div>
  );
}
