/**
 * .docx 안의 글자를 제자리에서 바꾼다.
 *
 * PDF와 근본적으로 다른 점: docx는 ZIP 안의 XML이고 글자는 `<w:t>` 안에만 있다.
 * 그 글자만 갈아 끼우면 **서식은 손도 대지 않은 채** 그대로 남는다 —
 * 제목 스타일, 표, 글머리표, 이미지, 머리말·꼬리말, 쪽 번호가 전부 살아 있다.
 *
 * ⚠ 이 파일은 DOM만 다룬다. 브라우저의 DOMParser와 테스트용 xmldom이 같이 쓰므로
 *   브라우저 전용 API(innerHTML, querySelector의 CSS 선택자 등)를 쓰지 않는다.
 *
 * ⚠ 워드는 한 문장을 여러 `<w:r>` 조각으로 쪼개 둔다(맞춤법 검사·개정 흔적).
 *   실측(2026-07-29, 실문서 20개): 위임장 문서는 문단 29개에 런 298개 — 문단당 10조각.
 *   그래서 번역 단위는 반드시 **문단**이어야 한다. 조각 단위로 번역하면 문장이 박살난다.
 */

/** 번역 결과를 어떤 모양으로 되쓸 것인가 */
export type DocxMode =
  /** 번역본 — 원문을 번역문으로 갈아 끼운다 */
  | 'replace'
  /** 대조본 — 원문은 그대로 두고 바로 아래에 번역 문단을 끼워 넣는다 */
  | 'bilingual';

export interface DocxUnit {
  /** 문서 전체를 통틀어 붙는 번호 — 번역 요청·응답의 짝을 맞추는 열쇠 */
  n: number;
  text: string;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** 번역할 게 있는 문단인가 — 글자가 하나도 없으면 보낼 이유가 없다 */
export function hasTranslatableText(s: string): boolean {
  return /\p{L}/u.test(s);
}

/** 자식 중 이 태그인 것들 (손자는 제외) */
function childrenNamed(el: Element, local: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i] as Element;
    if (c.nodeType === 1 && localName(c) === local) out.push(c);
  }
  return out;
}

function localName(el: Element): string {
  return el.localName ?? el.nodeName.replace(/^.*:/, '');
}

function descendants(root: Element | Document, local: string): Element[] {
  // getElementsByTagNameNS는 xmldom·브라우저 양쪽에 있고 접두사에 흔들리지 않는다
  const list = root.getElementsByTagNameNS(W_NS, local);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i] as Element);
  return out;
}

/** 이 노드를 감싸는 가장 가까운 w:p */
function nearestParagraph(el: Element): Element | null {
  let cur: Node | null = el.parentNode;
  while (cur) {
    if (cur.nodeType === 1 && localName(cur as Element) === 'p') return cur as Element;
    cur = cur.parentNode;
  }
  return null;
}

/**
 * 문단을 모은다.
 *
 * ⚠ 도형 안 텍스트(w:txbxContent)는 **문단 안에 문단이 들어 있는** 구조다.
 *   그래서 바깥 문단의 글자를 모을 때 안쪽 문단의 글자를 같이 퍼오면 안 된다.
 *   "가장 가까운 w:p가 나인가"로 가른다 — 중첩 깊이에 상관없이 정확하다.
 */
export function collectParagraphs(
  doc: Document,
  startN: number,
): { units: DocxUnit[]; nodes: Element[]; nextN: number } {
  const units: DocxUnit[] = [];
  const nodes: Element[] = [];
  let n = startN;

  for (const p of descendants(doc, 'p')) {
    const texts = descendants(p, 't').filter((t) => nearestParagraph(t) === p);
    if (texts.length === 0) continue;
    const text = texts.map((t) => t.textContent ?? '').join('');
    if (!hasTranslatableText(text)) continue;
    units.push({ n, text });
    nodes.push(p);
    n++;
  }
  return { units, nodes, nextN: n };
}

/** 문단의 글자를 통째로 갈아 끼운다 — 첫 조각에 몰아넣고 나머지는 비운다 */
function writeParagraphText(p: Element, text: string) {
  const texts = descendants(p, 't').filter((t) => nearestParagraph(t) === p);
  if (texts.length === 0) return;
  texts.forEach((t, i) => {
    t.textContent = i === 0 ? text : '';
    // 앞뒤 공백이 잘려 단어가 붙어 버리는 걸 막는다
    t.setAttribute('xml:space', 'preserve');
  });
}

/**
 * 번역 문단 사본에서 빼야 하는 것들.
 *
 * 그림·도형을 그대로 복제하면 같은 그림이 두 번 나오고, 도형 id가 겹쳐 워드가 파일을 고치려 든다.
 * 책갈피·주석 표식도 id가 겹치면 안 된다. 번역문에는 어차피 필요 없는 것들이다.
 */
const DROP_FROM_CLONE = [
  'drawing',
  'pict',
  'object',
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'commentReference',
];

function stripFromClone(clone: Element) {
  for (const local of DROP_FROM_CLONE) {
    for (const el of descendants(clone, local)) el.parentNode?.removeChild(el);
  }
  // mc:AlternateContent는 w 네임스페이스가 아니라 따로 훑는다 (도형이 여기 숨어 있다)
  const alt = clone.getElementsByTagName('mc:AlternateContent');
  for (let i = alt.length - 1; i >= 0; i--) alt[i]!.parentNode?.removeChild(alt[i]!);

  /**
   * 번호 매기기는 뺀다.
   * 안 빼면 목록에서 "1. 원문 / 2. 번역 / 3. 원문"처럼 번역문이 번호를 하나씩 차지한다.
   */
  for (const pPr of childrenNamed(clone, 'pPr')) {
    for (const numPr of childrenNamed(pPr, 'numPr')) pPr.removeChild(numPr);
  }
}

/**
 * 번역 결과를 문서에 되쓴다.
 *
 * 번역이 비어 있는 문단(모델이 번호를 빠뜨린 경우)은 **건드리지 않는다** —
 * 빈 칸으로 덮어써 원문을 잃느니 원문이 남는 게 낫다.
 */
export function applyTranslations(
  nodes: Element[],
  units: DocxUnit[],
  translations: Map<number, string>,
  mode: DocxMode,
): { applied: number; missing: number } {
  let applied = 0;
  let missing = 0;

  units.forEach((u, i) => {
    const p = nodes[i];
    const translated = (translations.get(u.n) ?? '').trim();
    if (!p || !translated) {
      missing++;
      return;
    }
    if (mode === 'replace') {
      writeParagraphText(p, translated);
    } else {
      const clone = p.cloneNode(true) as Element;
      stripFromClone(clone);
      writeParagraphText(clone, translated);
      p.parentNode?.insertBefore(clone, p.nextSibling);
    }
    applied++;
  });

  return { applied, missing };
}

/** 번역해야 하는 XML 편들. 본문 · 머리말 · 꼬리말 · 각주 · 미주가 전부 여기 있다. */
export function translatableParts(names: string[]): string[] {
  return names.filter(
    (n) =>
      n === 'word/document.xml' ||
      n === 'word/footnotes.xml' ||
      n === 'word/endnotes.xml' ||
      /^word\/(header|footer)\d*\.xml$/.test(n),
  );
}
