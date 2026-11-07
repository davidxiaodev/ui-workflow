# ui-workflow

一个 Claude Code 插件：让 AI 改前端和后端时，先说清楚"做成什么样算对"，按项目的约定去做，
并且在独立验证之前不能说"做完了"。

## 整套流程

前端（ui）和后端（api）走同一套流程，只是每一步用的约定、检查和评审方式不同。项目里每一块界面或服务叫一个 **lane**。

| 步骤 | 做什么 | ui lane | api lane |
| --- | --- | --- | --- |
| 0 准备 | 每个项目一次：写约定、接检查 | `docs/design.md` + token 文件 | `docs/backend.md` + 契约文件（OpenAPI 等）+ 迁移目录 |
| 1 澄清 | 只在大改动时：先追问需求、边界、失败时怎么办 | 同左 | 同左 |
| 2 验收标准 | 写 `.verify/acceptance.md`：可观察的结果，每条写明用什么证明；逐项过一遍异常情况清单 | 无效输入、键盘、慢请求、双击提交、390 宽…… | 边界值、越权、重复请求、并发写、下游失败…… |
| 3 实现 | 按约定做 | 需要时出 3 个结构不同的原型 | 先改契约，再按验收标准一条条先写测试后写实现 |
| 4 机器检查 | `run-verify.mjs` 按 lane 跑，只认真实退出码 | 样式、类型、截图 + 可访问性、用户路径 | 类型、单元、真实数据库的集成测试、**负向检查**、契约、迁移、用户路径 |
| 5 独立评审 | 没参与实现的子代理评审，逐条标记验收标准 | `design-review.md` 看截图 | `code-review.md` 看 diff，按专项逐一检查，并跑一遍证明关键事实 |
| 6 证据和分档 | `make-evidence.mjs` 生成证据包，验收标准和机器检查分开写，合并分档由脚本算 | 前后对比截图、录屏 | 检查日志、负向检查结果、契约与迁移改动 |

改动大小决定流程轻重：改文案、改颜色这类小改动不用追问，验收标准写 1 到 3 条就行；新流程、接口或数据契约变更、迁移、鉴权才走完整流程。

**负向检查**：把这条 lane 里的源码改动退回到基线、保留新测试，再跑一遍测试，测试必须失败。
测试在没有实现时也能通过，说明它没测到这次改动。

**合并分档**（脚本算，不能手动改）：

| 分档 | 条件 | 谁要看 |
| --- | --- | --- |
| 1 | 检查全过、评审通过、验收标准全部满足，且没有下面的情况 | 扫一眼证据包即可合并 |
| 2 | 改了截图基线或共享模块；有验收标准"未验证"；改了源码却没改测试 | 你要看前后对比和标出来的部分 |
| 3 | 改了设计约定、后端约定、接口契约或迁移 | 你确认之后才能合并 |
| 未就绪 | 检查失败、评审未通过、有验收标准未满足或没被评审 | 不合并 |

**收尾检查**：Stop 钩子。有 lane 的文件被改了，但这条 lane 的 `run-verify` 没通过、独立评审缺失、过期或未通过，
验收标准没有全部在评审里标记，或者证据包比评审旧，第一次结束会被拦下；仍未通过就结束时，AI 必须写明"未验证"
（钩子只拦一次，避免无限循环）。关闭：环境变量 `UI_WORKFLOW_GATE=off`。

## 安装

```bash
/plugin marketplace add davidxiaodev/ui-workflow
/plugin install ui-workflow@ui-workflow
```

可选但推荐（插件会自动找到它们，见 `vendor.lock.json` 里锁定的版本）：

```bash
/plugin marketplace add Leonxlnx/taste-skill
/plugin install taste-skill@taste-skill
/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
/plugin install ui-ux-pro-max@ui-ux-pro-max-skill
```

baoyu-design 是可选的看图调色工具，只在项目仓库外用（它含有未授权的 Anthropic 材料）。

## 在一个项目里开始

- 前端：对 Claude 说"用 building-consistent-ui 给这个项目建立设计约定"。
- 后端：对 Claude 说"用 building-reliable-backend 给这个项目建立后端约定和检查"。

两者都会写约定文件、接好 `.verify/config.json`，没有可脚本化的用户路径时生成 `ctl` 控制命令，最后在未改动的代码上跑一遍全部检查。
之后正常让 Claude 改代码即可。

### 从 0.1 升级

0.1 用的是 `.ui-verify/`。在项目里运行 `node <plugin>/scripts/run-verify.mjs --migrate`，它会把目录改成 `.verify/`、
把检查放进 `ui` lane，并列出需要手动做的几步（`.gitignore`、写第一份 `acceptance.md`）。没迁移之前，Stop 钩子会提示迁移。

## 文件

| 路径 | 作用 |
| --- | --- |
| `plugins/ui-workflow/skills/building-consistent-ui/` | 前端：入口 `SKILL.md`，`setup.md`、`build.md`、`verify.md`、`design-review.md`（截图评审） |
| `plugins/ui-workflow/skills/building-reliable-backend/` | 后端：入口 `SKILL.md`，`setup.md`、`build.md`、`verify.md`、`code-review.md`（独立代码评审），`templates/backend.md` |
| `plugins/ui-workflow/shared/acceptance.md` | 两边共用：怎么写验收标准、异常情况清单、评审怎么标记 |
| `plugins/ui-workflow/shared/ctl.md` | 两边共用：生成项目的控制命令（读写分开），以及 `verify-<app>` skill 和用户路径 |
| `plugins/ui-workflow/shared/verify.config.json` | `.verify/config.json` 模板（ui 和 api 两条 lane） |
| `plugins/ui-workflow/scripts/run-verify.mjs` | 按 lane 跑检查（含内置负向检查），按真实退出码记录；`--restore`、`--migrate` |
| `plugins/ui-workflow/scripts/make-evidence.mjs` | 生成证据包：合并分档、验收标准、机器检查、前后对比截图、录屏；`--pr` 输出 PR 描述 |
| `plugins/ui-workflow/scripts/stop-gate.mjs` | Stop 钩子 |
| `plugins/ui-workflow/scripts/check-raw-styles.mjs` | 找出写死的颜色、Tailwind 色板类、任意值 |
| `plugins/ui-workflow/scripts/find-tools.mjs` | 找到已安装的 taste-skill、ui-ux-pro-max、baoyu-design |
| `docs/adr/` | 关键取舍的决策记录 |

## 升级第三方工具

一次只升一个：读它的改动，在两个项目上各跑一次 `run-verify.mjs`，结果没变差再改 `vendor.lock.json` 里的 commit。
