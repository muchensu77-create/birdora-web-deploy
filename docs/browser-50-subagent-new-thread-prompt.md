# Birdora 50 Sub-Agent / 50 Browser Page Stress Prompt

Copy the prompt below into a new Codex thread.

```text
你是 Birdora 50 子代理 + 50 浏览器页面压力测试的主控线程。

真实仓库路径：
C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web

硬性要求：
1. 先准备，后测试。先读 AGENTS.md，并运行 git status --short --branch。
2. 不能写生产数据。只能启动本地隔离 API、隔离 SQLite、隔离上传目录、本地静态站。
3. 必须是真浏览器压力测试，不能只打接口。
4. 必须覆盖 50 个用户，每个用户至少完成：注册、退出后登录、发言、图像识别。
5. 必须是同时，至少在同一个明确时间窗内。不能把 50 个用户顺序跑完冒充压力测试。
6. 最终结论必须基于文件证据：50 个 agent JSON、runner JSON、汇总报告，而不是只看子代理口头汇报。

推荐执行方式：

第一优先使用严格同步浏览器 harness，它会一次性启动 50 个真实浏览器 worker/page，并设置同一个 start gate，让 50 个用户在同一时间窗开始动作：

powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 start
$env:BIRDORA_BROWSER_START_DELAY_MS='20000'
powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 run-50-pages
powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 report
powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 stop

同时，尝试开启 50 个子代理做监督/分片执行：
- 如果当前 multi_agent 工具允许 50 个子代理并发，则每个子代理运行：
  powershell -ExecutionPolicy Bypass -File scripts\browser-50-agent-harness.ps1 run-one -UserIndex N
- 如果工具层限制子代理并发数量，必须明确说明限制；不要把滚动批次说成“同时 50 子代理”。
- 在这种情况下，以 run-50-pages 的 50 页面同步压力结果作为“同时压力”的权威证据，再用可用子代理审计结果文件和失败样本。

通过条件：
- docs/browser-50-agent-flow-report.json 中 allPassed=true。
- observedCount=50、passed=50、failed=0、missing=[]。
- register/logout/login/publishPost/recognition 五个阶段均为 50/50。
- docs/browser-50-agent-results/<runId>/runner-50-pages.json 存在，并记录 launchWindowMs、startGateAt、workerStartWindowMs。
- 识别 Top 1 应统计在报告中；如出现 Failed to fetch 或临时 Chrome profile EPERM，必须区分：
  - 业务/页面/网络实质失败；
  - 测试收尾清理警告；
  - 单次偶发失败是否补跑通过。

最终输出：
1. runId、结果目录、报告路径。
2. 50 页面同步压力窗口：launchWindowMs、startGateAt、workerStartWindowMs。
3. 50 用户五阶段通过率和 p95。
4. 浏览器诊断：console errors、exceptions、network failures、crashes。
5. 失败/补跑情况与结论。
6. 是否需要用户介入。
```

Harness files:

- `scripts/browser-50-agent-harness.ps1`
- `scripts/run-browser-50-page-flow.js`
- `scripts/test-browser-user-flow-worker.js`
- `scripts/summarize-browser-agent-results.js`
