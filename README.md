# ui-workflow

仓库：`davidxiaodev/workflow`。

一个 Claude Code 插件：让 AI 改前端和后端时，先说清楚"做成什么样算对"，按项目的约定去做，
在独立验证之前不能说"做完了"，并且把每次犯过的错变成下次能自动拦住的检查。

人不再逐行读 diff，而是看证据包：验收标准逐条由独立评审标记，机器检查只认真实退出码，合并分档由脚本计算。

## 整套流程

前端（ui）和后端（api）走同一套流程，只是每一步用的约定、检查和评审方式不同。项目里每一块界面或服务叫一个 **lane**。

| 步骤 | 做什么 | ui lane | api lane |
| --- | --- | --- | --- |
| 0 准备 | 每个项目一次：写约定、接检查、加 lint 护栏、标出 `sensitive` 路径 | `docs/design.md` + token 文件 | `docs/backend.md` + 契约文件（OpenAPI 等）+ 迁移目录 |
| 1 澄清 | 只在大改动时：先追问需求、边界、失败时怎么办 | 同左 | 同左 |
| 2 验收标准 | 写 `.verify/acceptance.md`：可观察的结果，每条写明用什么证明；逐项过一遍异常情况清单；可选写明怎么回滚、能否撤回 | 无效输入、键盘、慢请求、双击提交、390 宽…… | 边界值、越权、重复请求、并发写、下游失败…… |
| 3 实现 | 按约定做 | 需要时出 3 个结构不同的原型 | 先改契约，再按验收标准一条条先写测试后写实现 |
| 4 机器检查 | `run-verify.mjs` 按 lane 跑，只认真实退出码，遇到第一个失败就停 | 样式、类型、截图 + 可访问性、用户路径 | 类型、单元、真实数据库的集成测试、**负向检查**、契约、迁移、用户路径 |
| 5 独立评审 | `review-brief.mjs` 写 brief，交给没参与实现的子代理；逐条标记验收标准和触发的清单项；最多 3 轮 | `design-review.md` 看截图 | `code-review.md` 看 diff，按专项逐一检查，并跑一遍证明关键事实 |
| 6 证据和分档 | `make-evidence.mjs` 生成证据包：验收标准和机器检查分开写，算合并分档，写明能否撤回、影响范围、怎么回滚 | 前后对比截图、录屏 | 检查日志、负向检查结果、契约与迁移改动 |
| 7 沉淀 | 评审的 Blocker、回滚、你的纠正，按 `shared/ratchet.md` 变成检查或清单项 | 同左 | 同左 |

改动大小决定流程轻重：改文案、改颜色这类小改动不用追问，验收标准写 1 到 3 条，评审走 quick；
新流程、接口或数据契约变更、迁移、鉴权才走完整流程，评审走 deep。

**负向检查**：把这条 lane 里的源码改动退回到基线、保留新测试，再跑一遍测试，测试必须失败。
测试在没有实现时也能通过，说明它没测到这次改动。

## 合并分档

脚本算，不能手动改。

| 分档 | 条件 | 谁要看 |
| --- | --- | --- |
| 1 | 检查全过、评审通过、验收标准全部满足，且没有下面的情况 | 扫一眼证据包即可合并 |
| 2 | 改了截图基线或共享模块（`shared`）；有验收标准"未验证"；改了源码却没改测试；代码里新增了 `@ts-ignore`、`eslint-disable`、`noqa` 这类关掉检查的注释，或者加了重试 | 你要看前后对比和标出来的部分 |
| 3 | 改了设计约定、后端约定、接口契约或迁移；改了 `sensitive` 路径；**改了检查本身**（见下） | 你确认之后才能合并 |
| 未就绪 | 检查失败、评审未通过、有验收标准未满足或没被评审；运行或评审对应的不是当前磁盘上的内容 | 不合并 |

证据包和 PR 描述里还有一节"合并风险"：能否撤回（有迁移是单向的，改了接口契约对已接入的调用方也是单向的）、
影响范围（碰了哪些 sensitive、契约、共享模块和检查）、怎么回滚（验收标准里写的 `Revert:`，或者默认做法）。

## 检查不会被改动本身绕过

- **改动不能改判它的检查**：检查一律从基线提交（和默认分支的 merge-base，可用 `VERIFY_BASE` 指定）上的
  `.verify/config.json` 读取，工作区里改过的配置不生效。确实要改检查（接新检查、调整 lane）就用
  `run-verify.mjs --config working` 跑，这类改动固定 3 档。算作"改了检查本身"的有：
  - `.verify/config.json`、`docs/checklist.md`；
  - 测试、lint、类型和 CI 的配置：`playwright.config.*`、`eslint.config.*`、`tsconfig*.json`、`.github/workflows/**`、
    `.claude/settings.json` 等（完整清单见 `scripts/lib/verify-config.mjs` 的 `DEFAULT_GUARD`，项目可以在配置的 `guard` 里追加）；
  - 删掉的测试文件；
  - 测试里新增的 `.skip`、`.only`、`xit`、`@pytest.mark.skip`，以及截图对比的 `threshold`、`maxDiffPixels`、`mask`。
- **按内容认，不按时间认**：`run-verify` 记录工作区内容的哈希（`tree`，不含 `.verify/` 和被 `.gitignore` 忽略的文件），
  评审在标题下写 `Tree: <这个哈希>`，证据包也写上它。收尾检查和分档只认哈希对得上的运行和评审；`touch`、`checkout`
  或者评审之后再改文件，都骗不过去。运行期间如果有检查改写了源码（比如格式化工具开了写入模式），这次运行直接判失败。
- **改动范围按基线算**：和 merge-base 比，已提交（包括已推送）、未提交、删除的文件都算。

## 评审

`review-brief.mjs` 给每条 lane 的评审写同一份输入，交给一个新的子代理（能换模型就换），不带任何实现过程：

- **内容哈希**：要评的是哪一份内容，没在 git 里的新文件单独列出。
- **深度**：quick（≤30 行、没碰共享模块）、standard、deep。契约、迁移、`sensitive` 路径、改了检查本身，
  或者超过 400 行，都走 deep；deep 里每个 Blocker 都要先尝试推翻它，推不翻才写。
- **清单项**：`docs/checklist.md` 里被这次 diff 触发的条目（每条写明触发条件、检查什么、来自哪次事故），评审逐条标"成立 / 不成立"。
- **轮次**：从第 2 轮起，附上上一轮的发现，评审只看上次评审之后新增的 diff，旧发现逐条标"已修 / 仍未修 / 延后"，
  不换个说法重复提。第 4 轮直接拒绝，交给你决定。

发现分为 Blocker、Should-fix、Note，以及 `Pre-existing`：这次改动没碰到的代码里的问题照样报告，但不挡合并，
会单独列在证据包里。同一类问题要列出所有出现的地方，让作者一次修完。

## 把犯过的错变成检查

`shared/ratchet.md`：每个 Blocker、每次回滚、每次你纠正 AI，都按"能写成检查就写成检查"的顺序处理：
lint 规则、类型或约束 > 由 diff 触发的清单项 > 写进约定文件。新规则要有证据（至少出现两次，或一次真实事故），
先在整个仓库上跑一遍确认不误报，单独提交（属于改了检查本身，3 档）；旧代码里的同类写法一起清掉，因为 AI 会照抄。
每月清理一次过时的规则。

清单格式：

```markdown
## C1 A retried create does not create twice
- when: diff `/router\.post|@Post\(/` or path `src/**/handlers/create*.ts`
- lanes: api
- check: POST the same body twice with the same Idempotency-Key; one row, the same id both times.
- source: incident 2026-09-14, PR #311
```

## 收尾检查和提交盖章

**Stop 钩子**：这一轮改动了某条 lane 的文件（内容和这一轮开始时不同，由 UserPromptSubmit 钩子记录），而
这条 lane 的 `run-verify` 没通过或对应的不是当前内容，独立评审缺失、未通过或对应的不是当前内容，验收标准或清单项
没有全部标记，或者证据包不是当前内容的，第一次结束会被拦下。仍未通过就结束时，AI 必须写明"未验证"
（钩子只拦一次，避免无限循环）。只聊天、没改内容的一轮不会被拦。

`UI_WORKFLOW_GATE`：`enforce`（默认，拦截）、`observe`（只记录本来会拦什么，用来先看误报）、`off`（关闭）。
每次判断都追加到 `.verify/gate.log`，`ratchet.md` 建议每周看一次。

**提交盖章**（可选）：`node <plugin>/scripts/stamp.mjs --install` 装一个 `prepare-commit-msg` 钩子。每个改了 lane 文件的提交带上
`Verified: tree=… tier=… lanes=…`；没验证，或者提交的内容和验证过的不一致，就写 `Verified: none (原因)`。这个钩子从不拦提交。
查没验证的提交：

```bash
git log --format='%h %s%n  %(trailers:key=Verified,valueonly)' origin/main..
```

## CI

把 `plugins/workflow/shared/verify-ci.yml` 复制到项目的 `.github/workflows/verify.yml`，填上安装依赖和启动服务的步骤。
每个 PR 都会用基线分支的配置在 PR 内容上重跑全部检查，按检查结果和改动范围算出分档（`make-evidence --checks-only`），
写进 job summary；未就绪时 status 为红，可以在分支保护里设为必过。日志和截图作为 artifact 保存。

CI 里目前不跑独立评审，分档会标明"checks only"。评审放进 CI 有两种做法（把 `.verify/review-*.md` 提交进 PR，
或者在 CI 里跑 reviewer），还没定。

## 安装

```bash
/plugin marketplace add davidxiaodev/workflow
/plugin install ui-workflow@ui-workflow
```

仓库已从 `davidxiaodev/ui-workflow` 改名为 `davidxiaodev/workflow`，插件名和 marketplace 名仍是 `ui-workflow`。
之前用旧名字加过 marketplace 的，GitHub 会跳转，但建议 `/plugin marketplace remove ui-workflow` 后用新名字重新加。

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

两者都会写约定文件、接好 `.verify/config.json`、加 lint 护栏、建一个空的 `docs/checklist.md`、和你一起填 `sensitive` 路径；
没有可脚本化的用户路径时生成 `ctl` 控制命令；最后用 `run-verify.mjs --config working` 在未改动的代码上跑一遍全部检查
（配置合进默认分支之后，就不再需要 `--config working`）。之后正常让 Claude 改代码即可。

接着可以做的：装提交盖章钩子、接 CI 模板。

### 从 0.3 升级

- 评审改为先跑 `review-brief.mjs` 生成 brief（`verify.md` 里写了命令）。延后的 Should-fix 写进 `.verify/deferred-<lane>.md`。
- 评审模板多了 `## Checklist` 和 `Pre-existing`；清单项不成立（`- [ ]`）会挡住收尾检查。
- 可选：在 lane 配置里填 `sensitive`，建 `docs/checklist.md`（空的就行），装提交盖章钩子，接 CI 模板。
- `run-verify` 现在遇到第一个失败的检查就停下这条 lane，要跑完全部用 `--keep-going`。检查顺序请按从快到慢排。

### 从 0.2 升级

- 评审文件要在标题下多写一行 `Tree: <last-run.json 里这条 lane 的 tree>`，没有这一行收尾检查不放行（`review-brief.mjs` 的 brief 会写明）。
- 检查改为从基线提交读配置。如果 `.verify/config.json` 还没合进默认分支，先用 `run-verify.mjs --config working`。
- Stop 钩子现在也会检查这一轮里已经提交的改动。
- 没有 remote 的仓库，基线就是当前提交，请设置 `VERIFY_BASE`。

### 从 0.1 升级

0.1 用的是 `.ui-verify/`。在项目里运行 `node <plugin>/scripts/run-verify.mjs --migrate`，它会把目录改成 `.verify/`、
把检查放进 `ui` lane，并列出需要手动做的几步（`.gitignore`、写第一份 `acceptance.md`）。没迁移之前，Stop 钩子会提示迁移。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `VERIFY_BASE` | 基线提交（默认：和 `origin/HEAD`、`origin/main`、`origin/master` 的 merge-base，都没有就是 `HEAD`） |
| `UI_WORKFLOW_GATE` | Stop 钩子：`enforce`（默认）、`observe`、`off` |

## 文件

**技能**

| 路径 | 作用 |
| --- | --- |
| `plugins/workflow/skills/building-consistent-ui/` | 前端：`SKILL.md`（入口）、`setup.md`、`build.md`、`verify.md`、`design-review.md`（截图评审）、`templates/`（design.md、截图测试、页面清单） |
| `plugins/workflow/skills/building-reliable-backend/` | 后端：`SKILL.md`（入口）、`setup.md`、`build.md`、`verify.md`、`code-review.md`（代码评审）、`templates/backend.md` |
| `plugins/workflow/shared/acceptance.md` | 怎么写验收标准、异常情况清单、评审怎么标记 |
| `plugins/workflow/shared/ctl.md` | 生成项目的控制命令（读写分开），以及 `verify-<app>` skill 和用户路径 |
| `plugins/workflow/shared/ratchet.md` | 把犯过的错变成检查：分类、准入、单独提交、清理；清单格式 |
| `plugins/workflow/shared/verify.config.json` | `.verify/config.json` 模板（ui 和 api 两条 lane） |
| `plugins/workflow/shared/verify-ci.yml` | 项目用的 CI 模板 |

**脚本和钩子**

| 路径 | 作用 |
| --- | --- |
| `plugins/workflow/hooks/hooks.json` | 注册 UserPromptSubmit 和 Stop 两个钩子 |
| `plugins/workflow/scripts/run-verify.mjs` | 按 lane 跑检查（含负向检查），记录退出码和内容哈希；`--config working`、`--keep-going`、`--restore`、`--migrate` |
| `plugins/workflow/scripts/review-brief.mjs` | 写评审 brief：内容哈希、深度、触发的清单项、轮次 |
| `plugins/workflow/scripts/make-evidence.mjs` | 生成证据包和合并分档；`--pr` 输出 PR 描述，`--checks-only --exit-code` 给 CI 用 |
| `plugins/workflow/scripts/stop-gate.mjs` | Stop 钩子 |
| `plugins/workflow/scripts/turn-start.mjs` | UserPromptSubmit 钩子：记录这一轮开始时的内容哈希和插件位置 |
| `plugins/workflow/scripts/stamp.mjs` | 提交盖章；`--install` 装 git 钩子 |
| `plugins/workflow/scripts/check-raw-styles.mjs` | 找出写死的颜色、Tailwind 色板类、任意值 |
| `plugins/workflow/scripts/find-tools.mjs` | 找到已安装的 taste-skill、ui-ux-pro-max、baoyu-design |
| `plugins/workflow/scripts/lib/verify-config.mjs` | 读配置（从基线提交）、算改动范围和内容哈希、找出"改了检查本身"的改动 |
| `plugins/workflow/scripts/lib/checklist.mjs` | 解析 `docs/checklist.md`，按 diff 选出触发的条目 |
| `plugins/workflow/scripts/lib/negative.mjs` | 负向检查 |

**本仓库**

| 路径 | 作用 |
| --- | --- |
| `test/` | 脚本自己的测试（Node 20+，无依赖），CI 见 `.github/workflows/test.yml` |
| `evals/` | 评审的 eval：已知 bug 要找到，干净改动不能误报 |
| `docs/adr/` | 关键取舍的决策记录 |
| `vendor.lock.json`、`NOTICE.md` | 调用和改编的第三方工具、版本和许可 |

## 开发

```bash
npm test                                                                    # 脚本的测试
node evals/run.mjs all --reviewer "claude -p --permission-mode acceptEdits" # 改 code-review.md、brief 或换模型之前先跑，和 evals/results/ 里上一次比
```

发版：改 `plugins/workflow/.claude-plugin/plugin.json` 的版本，合并后打同名 tag（如 `v0.4.0`），CI 模板按 tag 锁定插件版本。

升级第三方工具：一次只升一个，读它的改动，在两个项目上各跑一次 `run-verify.mjs`，结果没变差再改 `vendor.lock.json` 里的 commit。

## 思路来源

Anthropic Claude Code 团队关于代码评审和验证的文章，Lauren Tan（poteto）的 pstack 和"倒金字塔"，Matt Pocock 的 skills
（grilling、tdd、code-review、retro、pr），Garry Tan 的 gstack，Damola Akinleye 的 interface-design。改编的文字和许可见 `NOTICE.md`。
