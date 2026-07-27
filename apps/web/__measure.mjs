/** 화면 하나 뜰 때 서버가 실제로 얼마나 기다리는지 잰다 */
import fs from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const env = Object.fromEntries(
  fs
    .readFileSync('C:/Users/na/Desktop/aiproject/00_airecord_z/apps/web/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
  }),
});
const db = getFirestore();
const auth = getAuth();

const time = async (label, fn) => {
  const t = Date.now();
  try {
    await fn();
  } catch (e) {
    return console.log(`${label.padEnd(38)} ERR ${String(e).slice(0, 60)}`);
  }
  console.log(`${label.padEnd(38)} ${Date.now() - t}ms`);
};

// 첫 호출은 연결 수립이 섞이므로 예열한다
await db.collection('users').limit(1).get();

console.log('── 단일 왕복 ──');
await time('users 문서 1건', () => db.collection('users').limit(1).get());
await time('workspaces 문서 1건', () => db.collection('workspaces').limit(1).get());
await time('sessions 쿼리 20건', () =>
  db.collection('sessions').orderBy('startedAt', 'desc').limit(20).get(),
);

console.log('\n── 대시보드 한 번 뜰 때 (현재 구조: 순차) ──');
const t0 = Date.now();
await db.collection('users').limit(1).get(); // layout: getEntitlement → users
await db.collection('workspaces').limit(1).get(); // layout: getEntitlement → workspace
await db.collection('workspaces').limit(1).get(); // layout: 워크스페이스 이름 재조회
await db.collection('sessions').orderBy('startedAt', 'desc').limit(20).get(); // page: listSessions
await db.collection('users').limit(1).get(); // page: getEntitlement → users (중복)
await db.collection('workspaces').limit(1).get(); // page: getEntitlement → workspace (중복)
console.log(`Firestore 6회 순차 합계                 ${Date.now() - t0}ms`);

const t1 = Date.now();
await Promise.all([
  db.collection('users').limit(1).get(),
  db.collection('workspaces').limit(1).get(),
  db.collection('sessions').orderBy('startedAt', 'desc').limit(20).get(),
]);
console.log(`중복 제거 + 병렬 (3회)                  ${Date.now() - t1}ms`);

console.log('\n── 세션 쿠키 검증 ──');
console.log('verifySessionCookie(cookie, true) 는 checkRevoked=true 라');
console.log('요청마다 Google Identity 왕복이 한 번 더 붙는다 (아래 토큰 발급으로 대략치 측정)');
await time('Google 인증 왕복 1회(추정)', async () => {
  await auth.listUsers(1);
});

console.log('\n── 예열 후 반복 (연결 수립 비용 제외) ──');
for (let i = 0; i < 3; i++) await time(`Identity 왕복 #${i + 2}`, () => auth.listUsers(1));
for (let i = 0; i < 3; i++) await time(`Firestore 왕복 #${i + 2}`, () => db.collection('users').limit(1).get());
