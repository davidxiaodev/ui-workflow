# dx-workflow

仓库：`davidxiaodev/workflow`。

一个 Claude Code 插件：把一个需求从"说清楚要什么"一路带到"可以合并"，每一步之间都有能真正执行的关卡。
AI 先说清楚"做成什么样算对"，按项目的约定去做，在独立验证之前不能说"做完了"，并且把每次犯过的错变成下次能自动拦住的检查。

人不再逐行读 diff，而是看证据包：验收标准逐条由独立评审标记，机器检查只认真实退出码，合并分档由脚本计算。

## 整套流程

前端（frontend：用户直接接触的客户端，Web 和 React Native / Expo 移动端）和后端（backend）走同一套流程，只是每一步用的约定、检查和评审方式不同。
项目里每一个客户端或服务叫一个 **lane**，一个仓库可以有多条，比如 `web`、`app`、`api`，各自标明 `kind` 是 `frontend` 还是 `backend`。

| 步骤 | 做什么 | frontend lane | backend lane |
| --- | --- | --- | --- |
| 0 准备 | 每个项目一次：写约定、接检查、加 lint 护栏、标出 `sensitive` 路径 | `docs/design.md` + token 文件 | `docs/backend.md` + 契约文件（OpenAPI 等）+ 迁移目录 |
| 1 定义（L） | 写规格 `docs/specs/<名字>.md`：问题、目标 `S1…`、不做什么、决定、未决问题，以及整个功能的验收标准；你同意（`Status: agreed`）后才往下走 | 同左 | 同左 |
| 2 验收标准 | 每条可观察、写明用什么证明，L 的写在规格里并标注对应哪个目标；逐项过一遍异常情况清单；可选写明怎么回滚、能否撤回 | 无效输入、键盘、慢请求、双击提交、390 宽；移动端：大字号、断网、切后台…… | 边界值、越权、重复请求、并发写、下游失败…… |
| 3 拆任务（L） | `docs/specs/<名字>.tasks.md`：每个任务一个 PR（S 或 M），写明 lane、负责哪几条验收标准、依赖、预估风险档；开工时由脚本生成这个任务的 `.verify/acceptance.md` | 同左 | 同左 |
| 4 实现 | 按约定做，先写测试；没有依赖关系的任务可以各开一个 worktree 并行做 | 需要时出 3 个结构不同的原型 | 先改契约，再按验收标准一条条先写测试后写实现 |
| 4′ 调试 | 同一个检查连续两次失败，`run-verify` 就要求停下来先找根因（`shared/debug.md`），根因写进 `.verify/debug.md`，再修 | 同左 | 同左 |
| 5 机器检查 | `run-verify.mjs` 按 lane 跑，只认真实退出码，遇到第一个失败就停 | 样式、类型、截图 + 可访问性、用户路径（Web 用 Playwright；移动端用模拟器截图 `rn-look.mjs` 和 Maestro） | 类型、单元、真实数据库的集成测试、**负向检查**、契约、迁移、用户路径 |
| 6 独立评审 | `review-brief.mjs` 写 brief，交给没参与实现的子代理；逐条标记验收标准和触发的清单项；最多 3 轮 | `design-review.md` 看截图，再用前端版 `code-review.md` 看代码（状态、请求竞态、错误态、XSS、可访问性） | `code-review.md` 看 diff，按专项逐一检查，并跑一遍证明关键事实 |
| 7 证据和分档 | `make-evidence.mjs` 生成证据包：验收标准和机器检查分开写，算合并分档，写明能否撤回、影响范围、怎么回滚 | 前后对比截图、录屏 | 检查日志、负向检查结果、契约与迁移改动 |
| 8 沉淀 | 评审的 Blocker、回滚、你的纠正，按 `shared/ratchet.md` 变成检查或清单项 | 同左 | 同左 |

入口是 `flow` 技能（`dx-workflow:flow`），它先给改动定大小，再决定走哪些步骤：

| 大小 | 什么时候 | 步骤 |
| --- | --- | --- |
| S | 改文案、颜色、一行修复、配置值；不碰契约、迁移、鉴权、原生 | 验收标准 1–3 条 → 实现 → 验证，评审一般是 quick |
| M | 一两条 lane 内、一个 PR 放得下（约 400 行）的功能或修复，不改契约 | 验收标准 + 异常情况 → 实现 → 验证 |
| L | 新流程；接口、数据或设计契约变更；迁移；鉴权或支付；原生改动；超过一个 PR；或者还说不清怎样算做完 | 定义 → 规格里的验收标准 → 拆任务 → 每个任务按 M 走 |

步骤之间的关卡是能执行的命令：

```bash
node <plugin>/scripts/flow-check.mjs spec docs/specs/x.md                 # 规格：你已同意、没有未决问题、每个目标都有验收标准
node <plugin>/scripts/flow-check.mjs tasks docs/specs/x.tasks.md          # 任务：每条验收标准都有任务负责、没有循环依赖、没有超过 M 的任务
node <plugin>/scripts/flow-check.mjs next docs/specs/x.tasks.md --done T1 # 现在可以开工的任务
node <plugin>/scripts/flow-check.mjs acceptance docs/specs/x.md T2 --write # 生成这个任务的 .verify/acceptance.md
```

生成的验收文件会带上 `Spec:` 和 `Task:`，证据包和 PR 描述里也会写明，所以评审的每一条标记都能追溯到你同意过的目标。

上线（部署、灰度、监控、回滚）这一步还没做：目前按合并分档决定谁批准合并，之后的流程按你们团队现有的做法。

**移动端（React Native / Expo）**：lane 写 `"kind": "frontend", "platform": "react-native"`，默认覆盖全部 JS/TS 代码和
`app.json`、`ios/`、`android/` 等原生配置。和 Web 的区别：

- 截图用 `rn-look.mjs`：在 iOS 模拟器和 Android 模拟器上，用 Maestro 按深链接打开每个页面，固定状态栏，
  分默认、暗色、大字号三种各截一张，和基线逐像素比较（内置 PNG 比较，不需要依赖），差异图和报告进证据包；
- 样式检查加 `--platform react-native`：样式和属性里写死的颜色、字号字体、不在间距刻度上的数值；
- 用户路径用 Maestro flow（用 testID 定位）；
- 原生改动（`app.json`、`ios/`、`android/`、`package.json` 新增原生模块）只能随新的商店版本发出，旧版本用户会一直用旧原生代码，
  所以固定 3 档、标为不可撤回，评审走 deep；
- 验收标准和评审多一组移动端情况：大字号、最小机型、暗色、断网、切后台、权限被拒、Android 返回键、键盘遮挡、读屏、旧版本 App。
- 模拟器在 CI 里需要 macOS 或模拟器 runner；跑不了的检查标 `"ci": false`，只在本地跑，CI 里记为未运行。

详见 `skills/frontend/mobile.md`。

**负向检查**：把这条 lane 里的源码改动退回到基线、保留新测试，再跑一遍测试，测试必须失败。
测试在没有实现时也能通过，说明它没测到这次改动。

## 和其他 skill 包一起用

装了 Matt Pocock 的 skills、superpowers 或 agent-skills 的话，`flow` 会把某些步骤里的具体工作交给它们，
关卡和作为记录的文件仍以 dx-workflow 为准（详见 `shared/skill-packs.md`）：

| 步骤 | 交给（装了才用） |
| --- | --- |
| 定义、访谈 | `mattpocock-skills:grilling` / `grill-with-docs`，`agent-skills:interview-me` / `spec-driven-development`，`superpowers:brainstorming` |
| 拆任务 | `agent-skills:planning-and-task-breakdown`，`superpowers:writing-plans`，`mattpocock-skills:to-tickets` |
| 先写测试 | `mattpocock-skills:tdd`，`superpowers:test-driven-development`，`agent-skills:test-driven-development` |
| 并行 | `superpowers:using-git-worktrees` / `dispatching-parallel-agents` |
| 调试 | `mattpocock-skills:diagnosing-bugs`，`superpowers:systematic-debugging`，`agent-skills:debugging-and-error-recovery` |
| 浏览器排查 | `agent-skills:browser-testing-with-devtools` |
| 架构和清理 | `mattpocock-skills:improve-codebase-architecture` / `codebase-design`，`agent-skills:code-simplification` |

冲突时以 dx-workflow 为准：
- 规格和任务以 `docs/specs/` 下的文件为准，别的 skill 写到 `docs/superpowers/`、`SPEC.md`、`tasks/todo.md` 或 issue 里的只算草稿；
- "做完"以 Stop 钩子放行为准，别的 skill 的"测试过了就算完"只是其中一部分；
- 独立评审以 `review-brief.mjs` 派出的为准，它们的评审只能作为额外的检查；
- 合并按分档来，证据包出来之前不在本地 merge，也不开可以直接合并的 PR。

安装命令和锁定的版本见 `vendor.lock.json` 的 `routed`。

## 合并分档

脚本算，不能手动改。

| 分档 | 条件 | 谁要看 |
| --- | --- | --- |
| 1 | 检查全过、评审通过、验收标准全部满足，且没有下面的情况 | 扫一眼证据包即可合并 |
| 2 | 改了截图基线或共享模块（`shared`）；有验收标准"未验证"；改了源码却没改测试；代码里新增了 `@ts-ignore`、`eslint-disable`、`noqa` 这类关掉检查的注释，或者加了重试 | 你要看前后对比和标出来的部分 |
| 3 | 改了设计约定、后端约定、接口契约或迁移；改了 `sensitive` 路径；移动端的原生改动；**改了检查本身**（见下） | 你确认之后才能合并 |
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
- lanes: backend
- check: POST the same body twice with the same Idempotency-Key; one row, the same id both times.
- source: incident 2026-09-14, PR #311
```

## 收尾检查和提交盖章

**Stop 钩子**：这一轮改动了某条 lane 的文件（内容和这一轮开始时不同，由 UserPromptSubmit 钩子记录），而
这条 lane 的 `run-verify` 没通过或对应的不是当前内容，独立评审缺失、未通过或对应的不是当前内容，验收标准或清单项
没有全部标记，或者证据包不是当前内容的，第一次结束会被拦下。仍未通过就结束时，AI 必须写明"未验证"
（钩子只拦一次，避免无限循环）。只聊天、没改内容的一轮不会被拦。

`DX_WORKFLOW_GATE`：`enforce`（默认，拦截）、`observe`（只记录本来会拦什么，用来先看误报）、`off`（关闭）。
每次判断都追加到 `.verify/gate.log`，`ratchet.md` 建议每周看一次。

**提交盖章**（可选）：`node <plugin>/scripts/stamp.mjs --install` 装一个 `prepare-commit-msg` 钩子。每个改了 lane 文件的提交带上
`Verified: tree=… tier=… lanes=…`；没验证，或者提交的内容和验证过的不一致，就写 `Verified: none (原因)`。这个钩子从不拦提交。
查没验证的提交：

```bash
git log --format='%h %s%n  %(trailers:key=Verified,valueonly)' origin/main..
```

## CI

把 `plugins/dx-workflow/shared/verify-ci.yml` 复制到项目的 `.github/workflows/verify.yml`，填上安装依赖和启动服务的步骤。
每个 PR 都会用基线分支的配置在 PR 内容上重跑全部检查，按检查结果和改动范围算出分档（`make-evidence --checks-only`），
写进 job summary；未就绪时 status 为红，可以在分支保护里设为必过。日志和截图作为 artifact 保存。

CI 里目前不跑独立评审，分档会标明"checks only"。评审放进 CI 有两种做法（把 `.verify/review-*.md` 提交进 PR，
或者在 CI 里跑 reviewer），还没定。

## 安装

```bash
/plugin marketplace add davidxiaodev/workflow
/plugin install dx-workflow@dx-workflow
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

- 前端：对 Claude 说"用 dx-workflow 的 frontend 技能给这个项目建立设计约定和检查"。
- 后端：对 Claude 说"用 dx-workflow 的 backend 技能给这个项目建立后端约定和检查"。

两者都会写约定文件、接好 `.verify/config.json`、加 lint 护栏、建一个空的 `docs/checklist.md`、和你一起填 `sensitive` 路径；
没有可脚本化的用户路径时生成 `ctl` 控制命令；最后用 `run-verify.mjs --config working` 在未改动的代码上跑一遍全部检查
（配置合进默认分支之后，就不再需要 `--config working`）。之后正常提需求即可：`flow` 技能会先给改动定大小，
大的改动先和你一起写规格、拆任务，再一个任务一个 PR 地做。

接着可以做的：装提交盖章钩子、接 CI 模板。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `VERIFY_BASE` | 基线提交（默认：和 `origin/HEAD`、`origin/main`、`origin/master` 的 merge-base，都没有就是 `HEAD`） |
| `DX_WORKFLOW_GATE` | Stop 钩子：`enforce`（默认）、`observe`、`off` |

## 文件

**技能**

| 路径 | 作用 |
| --- | --- |
| `plugins/dx-workflow/skills/flow/` | 入口：给改动定大小，按步骤和关卡走完整个流程，按步骤分派给其他 skill 包 |
| `plugins/dx-workflow/skills/frontend/` | 前端：`SKILL.md`（入口）、`setup.md`、`build.md`、`verify.md`、`mobile.md`（React Native / Expo）、`design-review.md`（截图评审）、`code-review.md`（前端代码评审）、`templates/`（design.md、Web 截图测试、页面清单、`rn-look.json`、Maestro journey） |
| `plugins/dx-workflow/skills/backend/` | 后端：`SKILL.md`（入口）、`setup.md`、`build.md`、`verify.md`、`code-review.md`（代码评审）、`templates/backend.md` |
| `plugins/dx-workflow/shared/acceptance.md` | 怎么写验收标准、异常情况清单、评审怎么标记 |
| `plugins/dx-workflow/shared/ctl.md` | 生成项目的控制命令（读写分开），以及 `verify-<app>` skill 和用户路径 |
| `plugins/dx-workflow/shared/spec.md`、`tasks.md`、`debug.md` | 定义、拆任务、调试三步的做法和文件格式 |
| `plugins/dx-workflow/shared/skill-packs.md` | 和 Matt Pocock、superpowers、agent-skills 一起用：谁做哪一步，冲突时以谁为准 |
| `plugins/dx-workflow/shared/ratchet.md` | 把犯过的错变成检查：分类、准入、单独提交、清理；清单格式 |
| `plugins/dx-workflow/shared/verify.config.json` | `.verify/config.json` 模板（frontend 和 backend 两条 lane） |
| `plugins/dx-workflow/shared/verify-ci.yml` | 项目用的 CI 模板 |

**脚本和钩子**

| 路径 | 作用 |
| --- | --- |
| `plugins/dx-workflow/hooks/hooks.json` | 注册 UserPromptSubmit 和 Stop 两个钩子 |
| `plugins/dx-workflow/scripts/run-verify.mjs` | 按 lane 跑检查（含负向检查），记录退出码和内容哈希；`--config working`、`--keep-going`、`--restore` |
| `plugins/dx-workflow/scripts/flow-check.mjs` | 步骤之间的关卡：规格、任务、下一步可做的任务、生成任务的验收文件 |
| `plugins/dx-workflow/scripts/lib/flow.mjs` | 解析规格和任务文件 |
| `plugins/dx-workflow/scripts/review-brief.mjs` | 写评审 brief：内容哈希、深度、触发的清单项、轮次 |
| `plugins/dx-workflow/scripts/make-evidence.mjs` | 生成证据包和合并分档；`--pr` 输出 PR 描述，`--checks-only --exit-code` 给 CI 用 |
| `plugins/dx-workflow/scripts/stop-gate.mjs` | Stop 钩子 |
| `plugins/dx-workflow/scripts/turn-start.mjs` | UserPromptSubmit 钩子：记录这一轮开始时的内容哈希和插件位置 |
| `plugins/dx-workflow/scripts/stamp.mjs` | 提交盖章；`--install` 装 git 钩子 |
| `plugins/dx-workflow/scripts/check-raw-styles.mjs` | 找出写死的颜色、Tailwind 色板类、任意值；`--platform react-native` 加查 RN 样式 |
| `plugins/dx-workflow/scripts/rn-look.mjs` | 移动端截图：模拟器 + Maestro，按设备和默认/暗色/大字号比较基线 |
| `plugins/dx-workflow/scripts/lib/png.mjs` | 无依赖的 PNG 解码、比较和差异图 |
| `plugins/dx-workflow/scripts/find-tools.mjs` | 找到已安装的 taste-skill、ui-ux-pro-max、baoyu-design |
| `plugins/dx-workflow/scripts/lib/verify-config.mjs` | 读配置（从基线提交）、算改动范围和内容哈希、找出"改了检查本身"的改动 |
| `plugins/dx-workflow/scripts/lib/checklist.mjs` | 解析 `docs/checklist.md`，按 diff 选出触发的条目 |
| `plugins/dx-workflow/scripts/lib/negative.mjs` | 负向检查 |

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

发版：改 `plugins/dx-workflow/.claude-plugin/plugin.json` 的版本，合并后打同名 tag（如 `v0.6.0`），CI 模板按 tag 锁定插件版本。

升级第三方工具：一次只升一个，读它的改动，在两个项目上各跑一次 `run-verify.mjs`，结果没变差再改 `vendor.lock.json` 里的 commit。

## 思路来源

Anthropic Claude Code 团队关于代码评审和验证的文章，Lauren Tan（poteto）的 pstack 和"倒金字塔"，Matt Pocock 的 skills
（grilling、tdd、code-review、retro、pr），Jesse Vincent 的 superpowers，Addy Osmani 的 agent-skills，Garry Tan 的 gstack，
Damola Akinleye 的 interface-design。改编的文字和许可见 `NOTICE.md`；分派给其他 skill 包的步骤见 `shared/skill-packs.md`。
