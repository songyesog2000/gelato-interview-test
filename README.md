# 轨迹标注工具

## 用途

配合"AI Agent 编码笔试"的人工复核环节使用：把 Claude Code CLI（或 Codex CLI）导出的原始会话
`.jsonl` 文件载入网页，按"一次实际指令对应一条记录"的粒度浏览整条轨迹，并为每条记录填写核查结论
与问题标注（编号 P01/P02…、错误类型 E01-E08/ENV/USER/OTHER、问题现象、判断理由、影响与恢复、
改进建议），最终导出为可粘贴进交付表格的 CSV。

## 项目结构（三部分）

- `server/` — 后端：Express 服务，负责解析 `.jsonl`、读写标注数据、导出 CSV。
  - `lib/jsonlParser.js` 把原始行按"真实用户输入 vs. 工具返回"拆分为一条条记录。
  - `lib/annotationSchema.js` 集中定义阶段/结论/错误类型等枚举，避免前后端各写一份。
  - `storage/fileStore.js` 文件系统读写，做了路径穿越防护。
  - `routes/api.js` REST 接口。
- `public/` — 前端：纯静态页面（无构建步骤），加载会话、逐条标注、保存、导出。
- `data/` — 面试者自己的数据：
  - `data/trajectories/*.jsonl` 存放本人这次笔试产生的原始会话文件（不入库，见 `.gitignore`）。
  - `data/annotations/*.json` 存放页面保存的标注结果（不入库）。

## 功能

- 列出 `data/trajectories/` 下的会话文件。
- 解析选中的会话：按"是否为真实用户输入"切分记录，其余助手回复/工具调用/工具返回归入对应记录，
  可展开查看每条事件的摘要文本。
- 为每条记录填写：阶段、本次输入（可编辑）、核查结论、若干条问题标注、异常与疑点。
- 顶部一次性填写整份会话的作答人、使用工具、模型配置、最终代码链接。
- 保存标注到本地 JSON 文件；导出为 UTF-8 BOM CSV，列顺序对应交付表字段。

## 输入 / 输出

- 输入：放入 `data/trajectories/` 的 Claude Code CLI 会话 `.jsonl` 文件（一行一个 JSON 事件）。
- 输出：`data/annotations/<会话文件名>.json`（结构化标注数据），以及导出的
  `<会话文件名>.annotations.csv`。

## 运行

```bash
npm install
npm start
# 打开 http://localhost:4173
```

把待标注的 `.jsonl` 复制进 `data/trajectories/` 后，点击页面左侧"刷新列表"即可看到。

## 限制

- JSONL 解析针对 Claude Code CLI 的会话事件格式（`type: user/assistant/system`，
  工具调用与返回内嵌在 `message.content` 数组里）。Codex CLI 的 `rollout-*.jsonl` 事件结构不同，
  未知/不匹配的行会被保留展示为"未分类事件"，不会丢失，但不会像 Claude Code 的记录那样按真实用户
  输入正确切分。
- 单用户本地工具，未做鉴权、多人协作或并发写入保护。
- 标注数据以单个 JSON 文件持久化，不适合非常大量并发写入；本工具面向单次笔试的人工复核场景，
  数据量与使用方式决定了这一取舍足够。
