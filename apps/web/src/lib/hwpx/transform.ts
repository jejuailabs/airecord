/**
 * .hwpx(한글 HWPX = OWPML) 안의 글자를 제자리에서 바꾼다.
 *
 * docx와 원리가 완전히 같다: ZIP 안의 XML이고 글자는 `<hp:t>` 안에만 있다.
 * 그 글자만 갈아 끼우면 표·서식·이미지가 손도 대지 않은 채 그대로 남는다.
 *
 * docx와 딱 두 가지만 다르다:
 *   1) 네임스페이스가 hp(한컴)다 — 하지만 **로컬명(p·t)은 docx와 똑같다.**
 *      한글 버전마다 네임스페이스 URI가 미묘하게 달라서, URI로 거르지 않고 **로컬명으로만** 훑는다.
 *      그래야 2014·2018·2020·NEO 어느 파일이 와도 흔들리지 않는다.
 *   2) 본문이 `word/document.xml`이 아니라 `Contents/section0.xml`, `section1.xml` …에 있다.
 *      머리말·꼬리말도 이 섹션 XML 안에 들어 있어 한 번에 처리된다.
 *
 * ⚠ 이 파일은 DOM만 다룬다(브라우저 DOMParser·테스트용 xmldom 공용). CSS 선택자·innerHTML 금지.
 */

export type HwpxMode =
  /** 번역본 — 원문을 번역문으로 갈아 끼운다 */
  | 'replace'
  /** 대조본 — 원문은 그대로 두고 바로 아래에 번역 문단을 끼워 넣는다 */
  | 'bilingual';

export interface HwpxUnit {
  /** 문서 전체를 통틀어 붙는 번호 — 번역 요청·응답의 짝을 맞추는 열쇠 */
  n: number;
  text: string;
}

/** 번역할 글자가 있는가 — 글자가 하나도 없으면 보낼 이유가 없다 */
export function hasTranslatableText(s: string): boolean {
  return /\p{L}/u.test(s);
}

function localName(el: Element): string {
  return el.localName ?? el.nodeName.replace(/^.*:/, '');
}

/**
 * 로컬명이 일치하는 모든 후손 (네임스페이스 URI 무시).
 * getElementsByTagNameNS는 URI가 정확히 맞아야 잡히는데, HWPX는 버전마다 URI가 달라
 * 여기서는 직접 훑어 로컬명만 본다.
 */
function descendants(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Node) => {
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i]!;
      if (c.nodeType === 1) {
        if (localName(c as Element) === local) out.push(c as Element);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}

/** 이 노드를 감싸는 가장 가까운 문단(hp:p) */
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
 * 도형·표 안 텍스트도 각자 문단(hp:p)에 들어 있으므로, "가장 가까운 p가 나인가"로 갈라
 * 바깥 문단이 안쪽 문단 글자를 퍼오지 않게 한다 (docx와 같은 원칙).
 */
export function collectParagraphs(
  doc: Document,
  startN: number,
): { units: HwpxUnit[]; nodes: Element[]; nextN: number } {
  const units: HwpxUnit[] = [];
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
    // 앞뒤 공백이 잘려 단어가 붙는 걸 막는다
    t.setAttribute('xml:space', 'preserve');
  });
}

/**
 * 번역 문단 사본에서 빼야 하는 것들.
 * 그림·표·수식을 그대로 복제하면 두 번 나오고 id가 겹쳐 한글이 파일을 고치려 든다.
 * 줄 배치 캐시(linesegarray)도 지운다 — 번역문은 길이가 달라 캐시가 맞지 않는다(한글이 다시 계산한다).
 */
const DROP_FROM_CLONE = [
  'linesegarray',
  'pic',
  'container',
  'ole',
  'rect',
  'line',
  'ellipse',
  'arc',
  'polygon',
  'curve',
  'connectLine',
  'textart',
  'chart',
  'equation',
  'table',
];

function stripFromClone(clone: Element) {
  for (const local of DROP_FROM_CLONE) {
    for (const el of descendants(clone, local)) el.parentNode?.removeChild(el);
  }
}

/**
 * 번역 결과를 문서에 되쓴다.
 * 번역이 비어 있는 문단(모델이 번호를 빠뜨린 경우)은 건드리지 않는다 — 빈 칸으로 원문을 잃느니 원문이 낫다.
 */
export function applyTranslations(
  nodes: Element[],
  units: HwpxUnit[],
  translations: Map<number, string>,
  mode: HwpxMode,
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

/** 번역해야 하는 XML 편들 — 본문·머리말·꼬리말이 전부 Contents/section*.xml 안에 있다 */
export function translatableParts(names: string[]): string[] {
  return names.filter((n) => /^Contents\/section\d+\.xml$/i.test(n));
}
