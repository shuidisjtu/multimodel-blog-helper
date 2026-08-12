/**
 * ID 生成端口与系统实现(架构文档 §7.1:jobId/requestId 由服务生成,不信任客户端)。
 * 测试可注入 fake 实现;生产使用 crypto.randomUUID()。
 */
import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  nextId(): string;
}

/** 生产实现: crypto.randomUUID()(node:crypto)。 */
export const systemIdGenerator: IdGenerator = {
  nextId: () => randomUUID(),
};
