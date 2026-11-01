# ui-workflow

一个 Claude Code 插件：让 AI 在一个项目里只用一套风格做界面，并且在界面没验证过之前不能说"做完了"。

## 它做什么

- **一份设计约定。** 每个项目有 `docs/design.md` 和一个 token 文件（CSS 变量）。所有页面都按它做；
  某个页面要"不一样"时，AI 会先说明代价并让你决定，而不是直接给那个页面另做一套风格。
- **三个阶段。** 没有设计约定时走 `setup.md`（定方向、写约定、接检查）；改界面走 `build.md`
  （需要时出 3 种结构不同的原型让你选）；最后走 `verify.md`（截图、可访问性、视觉检查、一致性评审）。
- **收尾检查。** Stop 钩子：项目里改了界面文件，但 `run-verify` 没有通过、或截图评审没写，
  AI 就不能结束这一轮。

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

对 Claude 说："用 building-consistent-ui 给这个项目建立设计约定。" 它会按 `setup.md`：

1. 盘点技术栈和已有 token；
2. 用 taste-skill 抽 3 个方向让你选；
3. 用 ui-ux-pro-max 取 UX 规则；
4. 写 `docs/design.md`，接好 `.ui-verify/config.json`、截图测试和样式检查；
5. 生成第一批截图基线，给你确认后再提交。

之后正常让 Claude 改界面即可。

## 文件

| 路径 | 作用 |
| --- | --- |
| `plugins/ui-workflow/skills/building-consistent-ui/SKILL.md` | 入口：按项目状态分流、风格变更请求怎么回、红线 |
| `.../setup.md`、`build.md`、`verify.md` | 三个阶段的步骤 |
| `.../templates/` | `design.md` 模板、Playwright 截图+axe 测试、检查配置 |
| `plugins/ui-workflow/scripts/check-raw-styles.mjs` | 找出写死的颜色、Tailwind 色板类、任意值 |
| `plugins/ui-workflow/scripts/run-verify.mjs` | 跑项目的全部界面检查，按真实退出码记录结果 |
| `plugins/ui-workflow/scripts/stop-gate.mjs` | Stop 钩子 |
| `plugins/ui-workflow/scripts/find-tools.mjs` | 找到已安装的 taste-skill、ui-ux-pro-max、baoyu-design |

关闭收尾检查：在环境变量里设 `UI_WORKFLOW_GATE=off`。

## 升级第三方工具

一次只升一个：读它的改动，在两个项目上各跑一次 `run-verify.mjs`，结果没变差再改 `vendor.lock.json` 里的 commit。
