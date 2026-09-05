import { useRef, useState } from 'react';
import { AudioJobPanel } from './components/AudioJobPanel';
import { WeatherPanel } from './components/WeatherPanel';

type WorkbenchTab = 'audio' | 'weather';

const tabs: Array<{
  id: WorkbenchTab;
  index: string;
  label: string;
  description: string;
}> = [
  { id: 'audio', index: '01', label: '音频任务', description: '上传、轮询与转录下载' },
  { id: 'weather', index: '02', label: '天气查询', description: '获取地点实时天气' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('audio');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectTab(tab: WorkbenchTab, index: number) {
    setActiveTab(tab);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab !== undefined) selectTab(nextTab.id, nextIndex);
  }

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

      <section className="workbench" aria-label="博客助手工作台">
        <div className="workbench-tabs" role="tablist" aria-label="选择工作台功能">
          {tabs.map((tab, index) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                id={`${tab.id}-tab`}
                className={`workspace-tab${isActive ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`${tab.id}-tabpanel`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id, index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                <span className="tab-index" aria-hidden="true">
                  {tab.index}
                </span>
                <span className="tab-copy">
                  <strong>{tab.label}</strong>
                  <small>{tab.description}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div
          id="audio-tabpanel"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="audio-tab"
          hidden={activeTab !== 'audio'}
        >
          <AudioJobPanel />
        </div>
        <div
          id="weather-tabpanel"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="weather-tab"
          hidden={activeTab !== 'weather'}
        >
          <WeatherPanel />
        </div>
      </section>

      <footer className="app-footer">
        <span>博客助手工作台 · 真实 API 优先</span>
        <span>不展示密钥、服务器路径或内部异常</span>
      </footer>
    </main>
  );
}
