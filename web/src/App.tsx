import { AudioJobSlot } from './components/AudioJobSlot';
import { WeatherPanel } from './components/WeatherPanel';

export default function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">MULTIMODAL BLOG HELPER / BLOG ASSISTANT</p>
          <h1>多模态博客助手</h1>
          <p className="topbar-description">把音频内容整理成博客草稿，并提供天气辅助信息</p>
        </div>
        <div className="api-status" role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>API 通过本地 /api 代理接入</span>
        </div>
      </header>

      <section className="workbench-grid" aria-label="工作台模块">
        <AudioJobSlot />
        <WeatherPanel />
      </section>

      <footer className="app-footer">
        <span>博客助手工作台 · 真实 API 优先</span>
        <span>不展示密钥、服务器路径或内部异常</span>
      </footer>
    </main>
  );
}
