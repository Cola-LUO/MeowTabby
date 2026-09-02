# 移除提供商编辑面板"功能提供商"栏 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把提供商→功能的"分配"筛选从两处收敛为一处——删掉自定义API 页提供商编辑面板里的 Assignments 区块（API 提供商表单 + 内置 AI 面板两处），功能提供商选择只保留模型选择页一处。

**Architecture:** 纯 UI 层删除。config 的 feature→providerId 存储结构、`buildFeatureProviderPatch`、模型选择页 `FeatureProvidersConfig`（候选 = `getSelectableProvidersForCapability` = 系统提供商 + 启用的本地兼容提供商，添加即可选）全部不动。提供商卡片上的"被 N 个功能使用"徽章（`FeatureCountBadge`）是信息展示不是筛选，保留。

**Tech Stack:** React 19 / jotai / vitest

**Spec:** 用户需求（2026-09-02 对话确认第三版）：两次筛选变一次；自定义API 页只留提供商管理（CRUD + 高级选项）；模型选择页承担所有功能的提供商选择；语言检测/AI 内容感知不变。

## Global Constraints

- 分支：`chore-设置-自定义页默认空白-词典逻辑待理清`；测试命令带 `SKIP_FREE_API=true`
- conventional commit；只 `git add` 目标文件
- 删除 UI 后同步清理死组件与闲置 import（以 `pnpm lint` 的 oxlint --type-check 报告为准）
- 既有失败基线：全量 33 failed / 3 lint errors（9a2c65d 连带，不属本次，不修不扩大）

---

### Task 1: 删两处 Assignments 区块 + 死组件清理

**Files:**

- Modify: `src/entrypoints/options/pages/api-providers/providers-config/provider-config-form/index.tsx`（L158-188 区域：删 `hasAssignments` 变量与 L181-187 的 `<ProviderEditor.Assignments>` 块）
- Modify: `src/entrypoints/options/pages/api-providers/providers-config/index.tsx`（`BuiltInProviderPanel`：删 L437-449 的 `<ProviderEditor.Assignments>` 块；随之闲置的 `getAssignmentStatus`/`useHostedAiStatus`/`getHostedAiTierStatus`/`isDurablyUnusableTier`/`BUILT_IN_FEATURE_KEYS`/`HostedAiFeature` 等按 lint 报告清理）
- Modify: `src/entrypoints/options/pages/api-providers/providers-config/provider-editor.tsx`（从 `ProviderEditor` 导出对象与组件定义中删除 `Assignments`/`AssignmentRow`/`CompatibleFeatureAssignments`/`FeatureAssignment`/`LanguageDetectionAssignment`/`CustomActionAssignments`——删 UI 后无人使用；若 `EntityEditor` 等仅被它们使用的子件也闲置，一并按 lint 清理）
- Modify: `src/entrypoints/options/pages/api-providers/providers-config/__tests__/providers-config.test.tsx`（改断言 Assignments 不再渲染的用例；删除/改写 "renders the Ultra editor with its own attribution and all three feature assignments" 等涉及 Assignments 的用例）

**Interfaces:**

- Produces: `ProviderEditor` 导出对象不再含 Assignments 系列成员（其余成员 `Identity`/`Attribution`/`ConnectionFields`/`ProviderSpecificFields`/`TranslationModelFields`/`AdvancedFields`/`DuplicateButton`/`DeleteButton` 不动）
- 不变: `FeatureCountBadge`、卡片徽章、模型选择页 `FeatureProvidersConfig`、config 结构

- [ ] **Step 1: 改测试（先红）**

在 `providers-config.test.tsx` 中：

1. 找到断言 Assignments 渲染的用例（如 "renders the Ultra editor with its own attribution and all three feature assignments"），改为断言**不渲染**：选中内置 AI 后 `queryByText` 功能分配标题为 null；选中一个 LLM API 提供商后同样为 null。
2. 保留其余用例（卡片徽章计数用例 "counts default assignments..." 不涉及 Assignments 渲染，保留）。

- [ ] **Step 2: 跑测试确认失败**

Run: `SKIP_FREE_API=true pnpm vitest run src/entrypoints/options/pages/api-providers`
Expected: 新断言 FAIL（Assignments 仍渲染）

- [ ] **Step 3: 删除实现**

按 Files 清单删两处 JSX 块与死组件；`provider-config-form/index.tsx` 的 `hasAssignments` 变量与 `FEATURE_KEYS`/`FEATURE_PROVIDER_DEFS` import 若闲置一并删。

- [ ] **Step 4: 跑测试确认通过 + lint**

Run: `SKIP_FREE_API=true pnpm vitest run src/entrypoints/options/pages/api-providers src/entrypoints/options/pages/model-selection && pnpm lint`
Expected: 测试 PASS；lint 错误数 ≤ 3（既有遗留），无新增

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/options/pages/api-providers
git commit -m "refactor(options): remove per-provider feature assignments from the API providers page"
```

---

### Task 2: 回归验证

- [ ] **Step 1: 全量测试对比基线**

Run: `SKIP_FREE_API=true pnpm test 2>&1 | tail -4`
Expected: failed 数 ≤ 33（基线），且失败文件不含本次触碰的文件

- [ ] **Step 2: 手工验收（用户执行）**

重新构建加载后：① 自定义API 页点开任意提供商/内置 AI → 编辑面板无"功能提供商"分配栏，高级选项仍在；② 模型选择页 5 个功能选择器候选含内置 AI/微软/谷歌/所有已添加本地提供商；③ 语言检测、AI 内容感知不变。
