/**
 * 실제 워드 문서로 변환기를 확인한다.
 * 번역은 부르지 않는다 — 여기서 보려는 건 "서식을 안 깨고 글자만 갈아 끼우는가"다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  collectParagraphs,
  applyTranslations,
  translatableParts,
  hasTranslatableText,
  type DocxUnit,
} from './transform';

let failed = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '통과' : '실패'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed++;
};

const DOCS = 'C:/Users/na/Downloads';
const PICK = [
  '브랜드_커넥트_서비스_캠페인사_통합매니저_법인_대리인_위임장.docx', // 런 파편화 최악 (문단당 10조각)
  '[2025제주임팩트챌린지]지원서_챌린저 트랙_팀명.docx', // 머리말 1 · 꼬리말 2 · 표 20
  '모두의복습_사업계획서v4.docx', // 표 16
];

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'text/xml') as unknown as Document;
const ser = (doc: Document) => new XMLSerializer().serializeToString(doc as never);

function run(file: string, mode: 'replace' | 'bilingual') {
  const buf = new Uint8Array(fs.readFileSync(path.join(DOCS, file)));
  const zip = unzipSync(buf);
  const parts = translatableParts(Object.keys(zip));

  let n = 0;
  let totalUnits = 0;
  const out: Record<string, Uint8Array> = { ...zip };

  for (const part of parts) {
    const doc = parse(new TextDecoder().decode(zip[part]!));
    const { units, nodes, nextN } = collectParagraphs(doc, n);
    n = nextN;
    totalUnits += units.length;

    // 가짜 번역 — 원문과 확실히 구분되는 표식
    const fake = new Map<number, string>(units.map((u: DocxUnit) => [u.n, `<<${u.n}>>`]));
    applyTranslations(nodes, units, fake, mode);
    out[part] = new TextEncoder().encode(ser(doc));
  }

  const rezipped = zipSync(out);
  return { parts, totalUnits, rezipped };
}

for (const file of PICK) {
  console.log(`\n── ${file}`);
  const rep = run(file, 'replace');
  const bil = run(file, 'bilingual');

  ok('번역 대상 문단을 찾는다', rep.totalUnits > 0, `${rep.totalUnits}문단`);
  ok('두 모드가 같은 문단을 본다', rep.totalUnits === bil.totalUnits);

  // 머리말·꼬리말·각주까지 잡았는가 — 본문만 훑고 끝내면 표지·쪽 번호 글자가 남는다
  const hdrFtr = rep.parts.filter((n) => /header|footer/.test(n));
  console.log(`   대상 편: ${rep.parts.join(', ')}`);
  if (file.includes('제주임팩트')) {
    ok('머리말·꼬리말도 대상에 든다', hdrFtr.length === 3, `${hdrFtr.length}개`);
  }

  // 다시 열리는가 + XML이 성한가
  for (const [label, r] of [['번역본', rep], ['대조본', bil]] as const) {
    const re = unzipSync(r.rezipped);
    const doc = new TextDecoder().decode(re['word/document.xml']!);
    const reparsed = parse(doc);
    ok(`${label}: 다시 열린다`, Object.keys(re).length === Object.keys(unzipSync(new Uint8Array(fs.readFileSync(path.join(DOCS, file))))).length);
    ok(`${label}: XML이 성하다`, reparsed.getElementsByTagName('parsererror').length === 0);
    ok(`${label}: 표가 그대로다`,
      (doc.match(/<w:tbl[ >]/g) ?? []).length ===
        (new TextDecoder().decode(unzipSync(new Uint8Array(fs.readFileSync(path.join(DOCS, file))))['word/document.xml']!).match(/<w:tbl[ >]/g) ?? []).length);
  }

  // 대조본은 문단이 늘어야 하고, 번역본은 그대로여야 한다
  const orig = unzipSync(new Uint8Array(fs.readFileSync(path.join(DOCS, file))));
  const countP = (b: Uint8Array) => (new TextDecoder().decode(b).match(/<w:p[ >]/g) ?? []).length;
  const p0 = countP(orig['word/document.xml']!);
  const pRep = countP(unzipSync(rep.rezipped)['word/document.xml']!);
  const pBil = countP(unzipSync(bil.rezipped)['word/document.xml']!);
  ok('번역본은 문단 수가 그대로', pRep === p0, `${p0} → ${pRep}`);
  ok('대조본은 번역 문단만큼 늘어난다', pBil > p0, `${p0} → ${pBil}`);

  // 원문이 사라지지 않았는가 (대조본)
  const bilXml = new TextDecoder().decode(unzipSync(bil.rezipped)['word/document.xml']!);
  ok('대조본에 표식이 들어갔다', bilXml.includes('&lt;&lt;0&gt;&gt;') || bilXml.includes('<<0>>'));

  /**
   * 문서를 깨뜨리는 진짜 원인 — 사본이 id를 함께 복제하는 것.
   * 도형 id(wp:docPr)나 책갈피 id가 겹치면 워드가 "복구가 필요합니다"를 띄운다.
   */
  const ids = (xml: string, re: RegExp) => (xml.match(re) ?? []).map((m) => m);
  const dup = (arr: string[]) => arr.length !== new Set(arr).size;
  ok('도형 id가 겹치지 않는다', !dup(ids(bilXml, /<wp:docPr[^>]*\sid="\d+"/g)));
  ok('책갈피 id가 겹치지 않는다', !dup(ids(bilXml, /<w:bookmarkStart[^>]*\sw:id="\d+"/g)));

  // 모든 XML 편이 성한가 — 본문만 확인하면 머리말이 깨진 걸 못 잡는다
  const reAll = unzipSync(bil.rezipped);
  let broken = 0;
  for (const name of Object.keys(reAll)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const d = parse(new TextDecoder().decode(reAll[name]!));
    if (d.getElementsByTagName('parsererror').length > 0 || !d.documentElement) broken++;
  }
  ok('모든 XML 편이 성하다', broken === 0, `${broken}편 깨짐`);

  // 그림은 사본에서 빠졌는가
  const drawOrig = (new TextDecoder().decode(orig['word/document.xml']!).match(/<w:drawing[ >]/g) ?? []).length;
  const drawBil = (bilXml.match(/<w:drawing[ >]/g) ?? []).length;
  ok('대조본이 그림을 복제하지 않는다', drawBil === drawOrig, `${drawOrig} → ${drawBil}`);
}

console.log('\n── 문단 선별');
ok('숫자·기호만 있는 줄은 거른다', !hasTranslatableText('1. ※ -- 2,300'));
ok('글자가 있으면 번역한다', hasTranslatableText('제1조 (목적)'));
ok('빈 줄은 거른다', !hasTranslatableText('   '));

console.log(failed === 0 ? '\n전체 통과' : `\n${failed}건 실패`);
if (failed > 0) process.exitCode = 1;
