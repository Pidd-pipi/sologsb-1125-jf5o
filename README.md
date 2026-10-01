# 陨石样本编目台（sologsb-1125 / gbmeteorite）

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21825>

停止（镜像保留）：

```bash
docker compose down
```

## 项目简介

面向陨石收藏者与标本室的纯前端单页应用：把样本、发现记录、切片制样与检测数值整理成本地可检索档案。
核心动作是登记样本与发现地坐标、挂接切片、录入电子探针数值并给出分类建议。

- 纯前端 SPA：**无后端、无数据库服务、无外部 API**
- 所有数据保存在浏览器本地：业务数据走 **IndexedDB（Dexie，库名 `gbmeteorite-db`）**，表单草稿走 **localStorage**
- 容器无状态，不挂载任何命名卷；换浏览器即换档案库

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript 5.7 |
| 构建 | Vite 6（`build` 脚本为 `tsc -b && vite build`，类型检查零错误） |
| UI 组件库 | MUI（@mui/material 6 + @mui/icons-material） |
| 状态管理 | Zustand（`sampleStore` 业务数据 / `uiStore` 筛选与提示） |
| 路由 | React Router 6（BrowserRouter + nginx `try_files` 兜底） |
| 本地存储 | Dexie 4（IndexedDB）+ localStorage（草稿） |
| 部署 | 多阶段 Dockerfile：node:20-alpine 构建 → nginx:alpine 托管 |

## 核心页面

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 样本总览：卡片流 + 分类/化学群/重量区间筛选与排序，缺坐标或缺切片显示角标 | MeteoriteSample |
| `/samples/new` | 样本登记：编号生成、分类化学群、重量、存放位置，可补录发现地坐标并即时校验 | MeteoriteSample、FindRecord |
| `/samples/:id` | 样本详情：基本信息 + 发现地摘要 + 切片列表 + 分析记录，可就地新增 | 四个模型 |
| `/sections` | 切片库：按厚度与矿物占比筛选，回跳样本，批量标注质量 | ThinSection、MeteoriteSample |
| `/analysis` | 分析检测：录入 Fa / Fs / Ni / 铁纹石带宽，实时分类建议与阈值命中说明 | AnalysisRecord、MeteoriteSample |
| `/locations` | 发现地分布：SVG 网格按经纬度打点、按分类着色、点选弹出样本清单 | FindRecord、MeteoriteSample |

## 数据模型（`src/types/` 独立文件）

- `types/sample.ts` — **MeteoriteSample**：id、样本编号、总重量 g、分类、化学群、风化等级 W0–W4、发现/坠落、存放位置、`revision` 修订号
- `types/find.ts` — **FindRecord**：id、关联样本、地名、国家地区、经纬度、坐标来源（GPS/文献）、发现环境、发现者、`revision` 修订号
- `types/section.ts` — **ThinSection**：id、切片编号、关联样本、厚度 μm、制样方式、矿物占比、显微照片清单、`revision` 修订号
- `types/analysis.ts` — **AnalysisRecord**：id、关联样本或切片、方法、橄榄石 Fa、辉石 Fs、Ni wt%、铁纹石带宽 mm、检测日期、`revision` 修订号、`confirmed` 有效性（换绑失效/重新确认）

## 目录结构

```
sologsb-1125/
├── docker-compose.yml
├── .env / .env.example
├── README.md
└── frontend/
    ├── Dockerfile          # 多阶段：node:20-alpine → nginx:alpine
    ├── nginx.conf          # try_files + gzip
    ├── index.html
    ├── package.json
    ├── tsconfig*.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── types/{sample,find,section,analysis,revision}.ts
        ├── db/index.ts                 # Dexie 封装与 v1→v4 升级迁移
        ├── db/revision.ts              # 修订号乐观锁守卫、双方改动 diff
        ├── db/sync.ts                  # 多标签页 BroadcastChannel 变更通知
        ├── services/persist.ts         # 统一保存入口：冲突暂存、合并重试
        ├── stores/{sampleStore,uiStore,conflictStore,pendingWrites}.ts
        ├── components/common/{SampleCard,Badge,FieldGroup,EmptyState,CoordinatePicker,AppShell,ReconfirmButton,QuickRebindControl}.tsx
        ├── components/edit/{SampleEditDialog,FindEditDialog,SectionEditDialog,AnalysisEditDialog}.tsx
        ├── components/conflict/ConflictDialog.tsx   # 双方改动对比与逐字段合并
        ├── components/pending/PendingWritesBar.tsx  # 写入失败待恢复条
        ├── hooks/{useSampleFilter,useLocalDraft,useRegionStats}.ts
        ├── pages/{Overview,New,Detail,Sections,Analysis,Locations}.tsx
        ├── router/index.tsx
        └── utils/{classify,format,geo,fields}.ts
```

## 数据存储说明

- **库名**：`gbmeteorite-db`；表：`samples`、`finds`、`sections`、`analysis`
- **版本迁移**：
  - v1 建 `samples` / `finds` / `sections`
  - v2 新增 `analysis` 表并加 `sampleId` 索引
  - v3 为 `samples` 补 `updatedAt` 字段并按 id 回填旧记录
  - v4 为四类记录统一补 `revision` / `updatedAt`（乐观修订号），`analysis` 补 `confirmed` / `confirmedAt` 并加 `confirmed` 索引
- **多标签页并发保护（乐观修订号）**：样本、发现地、切片、检测四类记录均带 `revision`（新建 r1，每次写入 +1）。保存时必须携带打开编辑时的修订号，库内值已更新则**拒绝写入**，弹出「双方改动」对比：仅一方修改的字段自动并入，双方都改的字段逐字段选择采用谁，确认合并后按最新修订号重新入库。一个标签页写入后会经 BroadcastChannel 通知其他标签页自动重拉
- **切片换绑**：切片改挂到其他样本时，事务内将其关联检测记录一并改挂并标记为失效（`confirmed=false`、修订号 +1），必须人工「重新确认」后才能继续作为结论引用；换绑期间被其他标签页改过的检测记录不覆盖、跳过并提示
- **写入失败可恢复**：版本冲突或写入异常时，保存意图（基线记录 + 补丁）落入 localStorage 待恢复队列，页面顶部提示条可「按最新版本重试」（再冲突继续弹合并框）或「丢弃」
- **草稿**：`/samples/new` 与 `/analysis` 的表单草稿写入 localStorage（键前缀 `gbmeteorite:draft:`），切页自动恢复，提交后清理
- 首次打开会灌入 3 份演示样本、2 条发现记录、2 张切片与 2 条检测记录，便于直接体验筛选与打点

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `gbmeteorite` | Compose 项目名与容器名前缀 |
| `FRONTEND_PORT` | `21825` | 宿主端口，映射到容器 80 |
