# Birdora Agent Handoff

Before working in this repository, read:

1. `docs/release-handoff-20260702-v1.5.0.md`
2. `docs/release-handoff-20260702.md`
3. `docs/performance-report.md`
4. `docs/launch-readiness-execution-report-20260702.md`
5. `docs/eight-agent-audit-report-20260701.md`
6. `docs/peak-readiness-handoff-20260701.md`
7. `docs/peak-readiness-report-20260701.md`
8. `docs/backend-handoff.md`
9. `docs/bird-recognition-handoff.md`
10. `docs/mobile-web-adaptation-handoff.md`
11. `docs/production-launch-report-20260629.md`

Current caveat:

- "文案分析" now has a lightweight rule-based MVP with persisted score, summary, tags, and suggestions. It has not been connected to an independent AI analysis / rewrite / moderation model.
- `v1.5.0` adds observation saving and a 50-concurrency load report, but the aggregate API p95 target is still not green because auth register/login tail latency remains high.

Current project path:

```text
C:\Users\Administrator\Documents\逸轩_开发\website\birdora-web
```

Primary development repository:

```text
https://github.com/yuki-liuk/birdora-web.git
```

Temporary deployment repository recorded in production handoff:

```text
https://github.com/muchensu77-create/birdora-web-deploy.git
branch: deploy/birdora-web-20260629
```

Important guardrails:

- Do not treat `public/` as the source of truth. Edit root HTML/CSS/JS/assets first, then run `pnpm sync:public`.
- Do not expose the project root as a static web directory. Only `public/` should be served.
- Do not stop or modify unrelated production services such as `birdora-api`, `birdora-recognition`, `birdora-studio`, or `zhubao-api`.
- Check `git status --short --branch` before editing and do not overwrite unrelated local changes.
- For the current workstream, the target peak date is 2026-07-03 in Asia/Shanghai time.
