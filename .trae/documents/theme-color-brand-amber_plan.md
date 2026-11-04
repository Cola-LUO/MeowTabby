# MeowTabby 主题色替换：金色 → 深橙（方案 A + accent-blue 染橙）

## Repository Research

**当前状态**（改的全部变量都只在 `theme.css` / `host-theme.css` 里定义，消费端全是 CSS 变量或 Tailwind 类——零硬编码 hex）：

| 变量                                                 | 当前值                           | 作用                                                                                                    |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--rf-brand` (亮/暗)                                 | `oklch(76.034% 0.12361 82.191)`  | Button variant="brand"/outline/soft、输入翻译 spinner 顶框、侧边栏 animated-indicator、Ultra plan badge |
| `--rf-brand-foreground` (亮)                         | `oklch(0.985 0 0)`               | brand 按钮文字（近白）                                                                                  |
| `--rf-brand-foreground` (暗)                         | `oklch(0.205 0 0)`               | brand 按钮文字（近黑）                                                                                  |
| `--rf-chart-1..5`                                    | hue 82° 金色阶梯                 | 图表数据色                                                                                              |
| `--rf-ring`                                          | 冷灰 286°                        | Focus 环（**不动**）                                                                                    |
| `--rf-accent-blue` (亮)                              | `oklch(69.256% 0.16062 265.19)`  | Switch track、checkbox 激活态、dashed "add" 按钮描边/底色                                               |
| `--rf-accent-blue-hover` (亮)                        | `oklch(64.859% 0.16447 264.759)` | Switch hover、dashed 按钮 hover                                                                         |
| `--rf-accent-blue` (暗)                              | `oklch(58% 0.18 265.19)`         | 暗色下较深的蓝                                                                                          |
| `--rf-accent-blue-hover` (暗)                        | `oklch(62.5% 0.175 264.759)`     | 暗色下较亮的蓝                                                                                          |
| `--rf-link` (亮)                                     | `oklch(54.6% 0.245 262.881)`     | 翻译结果链接色                                                                                          |
| `--rf-link` (暗)                                     | `oklch(70.7% 0.165 254.624)`     | 暗色链接色                                                                                              |
| 中性色整套（primary/secondary/muted/border/sidebar） | 冷灰 286°                        | **不动**                                                                                                |

**host-theme.css** 是 content script 独立覆盖层，必须同步改 `--read-frog-brand`。

**消费端全是 CSS 变量 / Tailwind 类引用**：`switch.tsx` 用 `bg-accent-blue` / `bg-accent-blue-hover`，`providers-config` / `custom-actions` 用 `border-accent-blue bg-accent-blue/8`，`glass-badge.css` 用 `var(--rf-brand)`。改 CSS 变量即可全部跟随——**零 TSX / TS / Tailwind 配置改动**。

## Files and Modules

- `MeowTabby/src/assets/styles/theme.css`：改 `:root {}` 和 `.dark {}` 中的 `--rf-brand`、`--rf-brand-foreground`、`--rf-chart-1..5`、`--rf-accent-blue`、`--rf-accent-blue-hover`、`--rf-link`
- `MeowTabby/src/assets/styles/host-theme.css`：同步改 `--read-frog-brand`（亮暗）
- `MeowTabby/theme-compare.html`：**不动**（参考页）

## Implementation Steps

### 1. `theme.css :root {}`（亮主题）

```css
--rf-brand: oklch(53% 0.14 62); /* ← 深橙 ≈ #A67127 */
--rf-brand-foreground: oklch(1 0 0); /* ← 纯白 */
--rf-chart-1: oklch(89% 0.09 62); /* hue 62° 橙棕阶梯 */
--rf-chart-2: oklch(81% 0.12 62);
--rf-chart-3: oklch(72% 0.14 62);
--rf-chart-4: oklch(62% 0.15 62);
--rf-chart-5: oklch(53% 0.14 62);

--rf-accent-blue: oklch(88% 0.14 62); /* ← 染橙：浅橙 ≈ THEME.md soft 悬停 #FFD597 */
--rf-accent-blue-hover: oklch(82% 0.14 62); /* ← 染橙：深一档 ≈ THEME.md soft 按下 #FFC674 */

--rf-link: oklch(55% 0.16 62); /* ← 染橙：深橙链接，保 contrast */
/* --rf-ring 保持冷灰 286° 不变 */
```

### 2. `theme.css .dark {}`（暗主题）

```css
--rf-brand: oklch(53% 0.14 62); /* 亮暗共用深橙 */
--rf-brand-foreground: oklch(1 0 0); /* 深橙 + 白字 */
--rf-chart-1: oklch(89% 0.09 62); /* 阶梯反转（与亮同值，L 高者先画）*/
--rf-chart-2: oklch(81% 0.12 62);
--rf-chart-3: oklch(72% 0.14 62);
--rf-chart-4: oklch(62% 0.15 62);
--rf-chart-5: oklch(53% 0.14 62);

--rf-accent-blue: oklch(75% 0.14 62); /* 暗下较亮的橙 */
--rf-accent-blue-hover: oklch(70% 0.14 62); /* hover 更深 */

--rf-link: oklch(82% 0.14 62); /* 暗下较亮的橙链接 */
```

### 3. `host-theme.css`

```css
:root {
  --read-frog-brand: oklch(53% 0.14 62); /* ← 同步改 */
  /* foreground / muted 等不动 */
}
@media (prefers-color-scheme: dark) {
  --read-frog-brand: oklch(53% 0.14 62); /* ← 亮暗共用 */
}
```

## Dependencies and Considerations

- **accent-blue 染橙后的语义变化**：原来是蓝色（Switch track 激活态、checkbox 激活、dashed "add" 按钮），染橙后变成 brand 色系的浅色——视觉上"次要强调色"的角色从蓝色变成浅橙。
- **link 染橙**：原来链接是蓝色，染橙后变成橙色。如果后续觉得橙色链接不够明显，可以保留蓝色 link 不动——但那样 brand/accent/link 三色会不统一。本次一并染橙。
- **oklch 精确性**：`oklch(53% 0.14 62)` 是 `#A67127` 近似，浏览器间可能 ±2% 色差，可接受。
- **CSS 注释里提到的旧色名**：theme.css 里 accent-blue 上方有一段注释（"The one chromatic colour in an otherwise neutral UI..."），内容描述的是蓝色背景。需要**更新注释**。

## Validation

1. `pnpm build` 确保 CSS 编译通过
2. Chrome 扩展页面（options + 触发一次输入翻译 content script）亮暗两档肉眼确认：
   - Button variant="brand" / outline / soft：橙色
   - Switch track 激活态：浅橙色
   - dashed "add" 按钮（API Provider / Custom Action）：浅橙描边
   - 侧边栏 animated-indicator ping：橙色
   - 输入翻译 spinner 顶框：橙色
   - Ultra plan badge：橙色边框
   - 图表色板：橙色阶梯
   - 链接：橙色
   - 中性色（按钮、边框、背景）：**冷灰不变**

## Risks

- **Chrome 缓存**：改 CSS 后需 `chrome://extensions` → 重新加载 + 关闭重开所有扩展页面。
- **后续可能想换中性色基调**：当前冷灰 286° + 橙色 brand 在色轮上有一定距离（286 - 62 = 224°），可能不够统一。方案 C（中性色也换暖灰）是独立后一步。
- **如果以后想恢复 accent-blue 蓝色**：直接把 theme.css 里的 `--rf-accent-blue` / `--rf-accent-blue-hover` / `--rf-link` 改回当前值即可，零组件改动。
