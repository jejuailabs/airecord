/**
 * Recall.ai 클라이언트.
 *
 * ⚠ 구현은 packages/shared/src/meeting/recall.ts 하나뿐이다.
 *   웹(봇 생성·퇴장)과 워커(웹훅 해석)가 같은 규격을 봐야 하므로 두 벌 두지 않는다.
 */
export { createBot, leaveBot, botLifecycleOf } from '@sotong/shared/meeting/recall';
export type { CreateBotOptions, BotLifecycle } from '@sotong/shared/meeting/recall';
