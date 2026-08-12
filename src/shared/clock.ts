/**
 * 时钟端口与系统实现(架构文档 §7.1):时间统一以 ISO 8601 字符串传递,
 * 测试可注入 fake 时钟;生产使用 new Date()。
 */
export interface Clock {
  /** 当前时间, ISO 8601 字符串(new Date().toISOString())。 */
  now(): string;
}

/** 系统时钟:new Date().toISOString()。 */
export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};
