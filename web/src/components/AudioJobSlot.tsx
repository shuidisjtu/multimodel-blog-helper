export function AudioJobSlot() {
  return (
    <section className="panel audio-slot" aria-labelledby="audio-slot-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AUDIO PIPELINE</p>
          <h2 id="audio-slot-title">异步音频任务</h2>
        </div>
        <span className="module-tag">待接入</span>
      </div>

      <div className="pipeline">
        <div className="pipeline-step active">
          <span>01</span>
          <strong>上传受理</strong>
          <small>创建 Job</small>
        </div>
        <div className="pipeline-connector" aria-hidden="true" />
        <div className="pipeline-step">
          <span>02</span>
          <strong>异步转录</strong>
          <small>后台处理</small>
        </div>
        <div className="pipeline-connector" aria-hidden="true" />
        <div className="pipeline-step">
          <span>03</span>
          <strong>摘要与下载</strong>
          <small>结果展示</small>
        </div>
      </div>

      <div className="slot-note">
        <p>音频上传、Job 轮询和转录下载将由音频主流程模块接入。</p>
        <p>当前槽位仅定义页面布局与状态视觉，不代表音频功能已可用。</p>
      </div>
    </section>
  );
}
